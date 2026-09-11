// =============================================================================
// POST /api/meta/analyze-fast { id }  — el motor rápido (Gemini, servidor).
//
// Toma UN anuncio de la cola (meta_ads.id), baja el creativo del lado del
// servidor, se lo manda entero a Gemini y guarda el resultado exactamente donde
// lo guarda el barrido del navegador: creatives (+ ad_dimension), meta_ads
// (creative_id / queue_status) y el Cerebro. ~30–90 s por video, sin techo de
// 12 min ni descargas por el proxy.
//
// Respuesta: { ok, creative_id, hook, headline, seconds }.
// Fallo:     queue_status 'error', queue_attempts+1, queue_error; 502/500 {error}.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { openMetaAsset, readBodyCapped, META_ASSET_COLUMNS, type MetaAssetRow } from '@/lib/meta-asset';
import { getGeminiKey, GeminiError } from '@/lib/gemini';
import { analyzeCreativeWithGemini, type CreativeKind } from '@/lib/gemini-analysis';
import { saveCreative } from '@/lib/creatives-save';
import { ingestCreative } from '@/lib/brain-ingest-run';
import { DIMENSIONS, durationBucket } from '@/lib/agents/taxonomy';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_BYTES = 100 * 1024 * 1024;
const ENGINE_VERSION = 'gemini-fast/1';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = (body.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  const sb = getSupabase();
  const started = Date.now();

  const { data: rowData } = await sb
    .from('meta_ads')
    .select(META_ASSET_COLUMNS)
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!rowData) return NextResponse.json({ error: 'Anuncio no encontrado' }, { status: 404 });
  const row = rowData as unknown as MetaAssetRow;

  const apiKey = await getGeminiKey(sb, user.id);
  if (!apiKey) return NextResponse.json({ error: 'Falta la clave de Gemini: guárdala en la tarjeta de conexión' }, { status: 400 });

  const now = () => new Date().toISOString();

  async function fallar(reason: string, status: number) {
    const { data: prev } = await sb.from('meta_ads').select('queue_attempts').eq('id', row.id).maybeSingle();
    await sb.from('meta_ads').update({
      queue_status: 'error',
      queue_error: reason.slice(0, 300),
      queue_attempts: ((prev?.queue_attempts as number | null) ?? 0) + 1,
      updated_at: now(),
    }).eq('id', row.id);
    return NextResponse.json({ error: reason }, { status });
  }

  try {
    await sb.from('meta_ads').update({ queue_status: 'procesando', queue_error: null, updated_at: now() }).eq('id', row.id);

    // 1 · Bytes del creativo (misma lógica que el proxy /api/meta/asset) -------
    const opened = await openMetaAsset(sb, row);
    if (!opened.upstream) {
      return fallar(`No se pudo descargar el creativo desde Meta${opened.error ? `: ${opened.error}` : ''}`, 502);
    }
    const bytes = await readBodyCapped(opened.upstream, MAX_BYTES);

    // Un anuncio de catálogo / Advantage+ no tiene UN creativo descargable:
    // llega un archivo vacío. No es un fallo; se marca y no se reintenta.
    if (bytes.byteLength < 1024) {
      const msg = 'Anuncio de catálogo / Advantage+: no tiene un creativo único que analizar';
      await sb.from('meta_ads').update({ queue_status: 'omitido', queue_error: msg, updated_at: now() }).eq('id', row.id);
      return NextResponse.json({ ok: false, omitido: true, error: msg });
    }

    const headerMime = (opened.upstream.headers.get('content-type') ?? '').split(';')[0].trim();
    // A CDN answering with a page instead of the media is an expired/blocked
    // URL that still said 200. Gemini would fail on it in seconds.
    const head = Buffer.from(bytes.subarray(0, 64)).toString('latin1').trimStart();
    if (headerMime.startsWith('text/') || headerMime.includes('json') || head.startsWith('<') || head.startsWith('{')) {
      await sb.from('meta_ads').update({ asset_url: null, asset_error: `El CDN devolvió ${headerMime || 'texto'} en vez del archivo (URL caducada)`, updated_at: now() }).eq('id', row.id);
      return fallar('La URL del creativo caducó y Meta devolvió una página en vez del archivo; se volverá a resolver en la próxima sincronización', 502);
    }
    const kind: CreativeKind = row.asset_kind === 'image' || headerMime.startsWith('image/') ? 'image' : 'video';
    const mime = headerMime && (headerMime.startsWith('image/') || headerMime.startsWith('video/'))
      ? headerMime
      : kind === 'image' ? 'image/jpeg' : 'video/mp4';

    // 2 · Gemini --------------------------------------------------------------
    let result: Awaited<ReturnType<typeof analyzeCreativeWithGemini>>;
    let partial: string | null = null;
    try {
      result = await analyzeCreativeWithGemini({
        bytes, mime, kind, apiKey, adName: row.name, durationHint: row.duration ?? null,
      });
    } catch (e) {
      // A video Gemini cannot decode still has a cover frame. Analyzing the
      // thumbnail is what ScaleBot does in this case — flagged as partial so
      // nobody mistakes it for a full read of the video.
      const thumb = row.thumbnail_url;
      if (kind !== 'video' || !thumb) throw e;
      const t = await fetch(thumb, { cache: 'no-store' }).catch(() => null);
      if (!t || !t.ok) throw e;
      const tBytes = await readBodyCapped(t, 15 * 1024 * 1024);
      const tMime = (t.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
      result = await analyzeCreativeWithGemini({ bytes: tBytes, mime: tMime, kind: 'image', apiKey, adName: row.name, durationHint: null });
      partial = e instanceof Error ? e.message : 'video no decodificable';
    }
    if (partial) {
      const a = result.analysis as Record<string, unknown>;
      a.engine = { ...(a.engine as Record<string, unknown> | undefined), partial: 'solo portada', reason: partial };
      a.summary = `[ANÁLISIS PARCIAL: solo la portada del video; Gemini no pudo leer el archivo] ${String(a.summary ?? '')}`;
    }

    // 3 · creatives (igual que POST /api/creatives desde el barrido) ------------
    const saved = await saveCreative(sb, user.id, row.brand_id, {
      name: row.name,
      type: kind,
      previewUrl: row.thumbnail_url ?? null,
      duration: result.durationSeconds ?? row.duration ?? null,
      transcript: result.transcript || null,
      analysis: result.analysis,
      adName: row.name,
      metaAdId: row.ad_id,
      metaVideoId: row.video_id ?? null,
      source: 'auto',
      videoUrlDirect: opened.ownBucket ? row.asset_url : null,
    });

    // 4 · ad_dimension (mismas filas y claves que el clasificador) -------------
    const own = { user_id: user.id, brand_id: row.brand_id };
    const keyCols = row.ad_id ? { ad_id: row.ad_id, creative_id: saved.id } : { ad_id: null, creative_id: saved.id };
    const stamp = now();
    const dimRows: Array<Record<string, unknown>> = [];
    for (const d of DIMENSIONS) {
      if (d === 'hook') {
        const title = result.hook || result.headline;
        if (title) dimRows.push({ ...own, ...keyCols, dimension: 'hook', value: title.slice(0, 200), confidence: 0.8, hook_id: null, source: 'gemini', version: ENGINE_VERSION, updated_at: stamp });
        continue;
      }
      if (d === 'duration_bucket') {
        dimRows.push({ ...own, ...keyCols, dimension: d, value: durationBucket(result.durationSeconds, kind === 'image'), confidence: 1, source: 'gemini', version: ENGINE_VERSION, updated_at: stamp });
        continue;
      }
      const v = result.dimensions[d];
      if (v) dimRows.push({ ...own, ...keyCols, dimension: d, value: v, confidence: 0.8, source: 'gemini', version: ENGINE_VERSION, updated_at: stamp });
    }
    if (dimRows.length) {
      // Partial unique indexes: replace-by-delete, like the classifier.
      const q = sb.from('ad_dimension').delete().eq('brand_id', row.brand_id);
      await (row.ad_id ? q.eq('ad_id', row.ad_id) : q.eq('creative_id', saved.id).is('ad_id', null));
      const { error: dimErr } = await sb.from('ad_dimension').insert(dimRows);
      if (dimErr) console.warn('[analyze-fast] ad_dimension:', dimErr.message);
    }

    // 5 · meta_ads: listo ------------------------------------------------------
    await sb.from('meta_ads').update({
      creative_id: saved.id,
      analyzed_at: stamp,
      queue_status: 'listo',
      queue_error: null,
      updated_at: stamp,
    }).eq('id', row.id);

    // 6 · Cerebro (best-effort; nunca truena) ----------------------------------
    try {
      await ingestCreative({ userId: user.id, creativeId: saved.id, brandId: row.brand_id, sb });
    } catch { /* el cerebro es best-effort */ }

    return NextResponse.json({
      ok: true,
      creative_id: saved.id,
      hook: result.hook,
      headline: result.headline,
      seconds: Math.round((Date.now() - started) / 1000),
      model: result.model,
      kind,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Error analizando con Gemini';
    const status = e instanceof GeminiError ? 502 : 500;
    return fallar(reason, status);
  }
}
