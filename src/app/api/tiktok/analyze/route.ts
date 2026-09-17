// =============================================================================
// POST /api/tiktok/analyze { videoId } — desmenuza UN video con Gemini.
//
// Baja el archivo del bucket (no del CDN de nadie: aquí el archivo ES nuestro
// desde que se subió), lo manda a analizar y guarda la receta en la fila:
// hook, headline, framework, por qué funcionó y los beats con su segundo.
//
// El resultado NO sobreescribe lo que el humano ya corrigió a mano: si él
// reescribió el framework porque el modelo se equivocó, esa corrección gana.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { getGeminiKey } from '@/lib/gemini';
import { analyzeTikTokVideo } from '@/lib/tiktok-analysis';
import { tiktokEnabled } from '@/lib/tiktok-server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BUCKET = 'creative-videos';

const mimeDe = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() ?? 'mp4';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  return 'video/mp4';
};

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tiktokEnabled(user.id))) return NextResponse.json({ error: 'Modo no disponible' }, { status: 403 });

  const { videoId, force } = (await request.json()) as { videoId?: string; force?: boolean };
  if (!videoId) return NextResponse.json({ error: 'Falta videoId' }, { status: 400 });

  const sb = getSupabase();
  const { data: row } = await sb.from('tt_video')
    .select('id,title,storage_path,duration,analyzed_at,hook,headline,framework,why_worked')
    .eq('id', videoId).eq('user_id', user.id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
  const v = row as {
    id: string; title: string | null; storage_path: string | null; duration: number | null;
    analyzed_at: string | null; hook: string | null; headline: string | null;
    framework: string | null; why_worked: string | null;
  };
  if (!v.storage_path) return NextResponse.json({ error: 'Este video no tiene archivo guardado' }, { status: 400 });
  if (v.analyzed_at && !force) return NextResponse.json({ ok: true, skipped: 'ya_analizado' });

  const apiKey = await getGeminiKey(sb, user.id);
  if (!apiKey) return NextResponse.json({ error: 'Falta la clave de Gemini. Guárdala en la tarjeta de conexión.' }, { status: 400 });

  const dl = await sb.storage.from(BUCKET).download(v.storage_path);
  if (dl.error || !dl.data) {
    return NextResponse.json({ error: `No se pudo leer el archivo: ${dl.error?.message ?? 'vacío'}` }, { status: 502 });
  }
  const bytes = new Uint8Array(await dl.data.arrayBuffer());

  let out;
  try {
    out = await analyzeTikTokVideo({
      bytes,
      mime: mimeDe(v.storage_path),
      apiKey,
      title: v.title ?? 'video',
      durationHint: v.duration,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falló el análisis' }, { status: 502 });
  }

  // Lo que el humano ya escribió manda sobre lo que el modelo propone.
  const conserva = (actual: string | null, nuevo: string) => (actual && actual.trim() ? actual : nuevo || null);

  const patch = {
    transcript: out.transcript || null,
    hook: conserva(v.hook, out.hook),
    headline: conserva(v.headline, out.headline),
    framework: conserva(v.framework, out.framework),
    why_worked: conserva(v.why_worked, out.whyWorked),
    beats: out.beats.length ? out.beats : null,
    analysis: {
      framework_how: out.frameworkHow,
      objection: out.objection,
      retention_hook: out.retentionHook,
      avatar: out.avatar,
      product_claim: out.productClaim,
      model: out.model,
    },
    duration: out.durationSeconds ?? v.duration,
    analyzed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb.from('tt_video').update(patch).eq('id', v.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: data, model: out.model });
}
