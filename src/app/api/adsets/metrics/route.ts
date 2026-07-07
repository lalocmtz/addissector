import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import { checkHeaders } from '@/lib/ad-scoring';
import { parseAdName } from '@/lib/ad-angles';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /api/adsets/metrics — sube el export de Meta UNA vez.
// AUTO-INGESTA: el reporte es la fuente. Cada anuncio del CSV:
//   - si ya existe (por nombre) -> actualiza métricas
//   - si NO existe -> lo crea (y crea el conjunto/batch si hace falta),
//     infiriendo etapa/ángulo/formato de la nomenclatura del nombre.
// Body: { csv: string, brandId?: string }
// ---------------------------------------------------------------------------

const MAX_ROWS = 800;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export async function POST(request: NextRequest) {
  try {
    if (!isSupabaseConfigured() || !isAuthConfigured()) {
      return NextResponse.json({ error: 'Supabase no configurado' }, { status: 501 });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const body = (await request.json()) as { csv: string; brandId?: string };
    if (!body.csv?.trim()) return NextResponse.json({ error: 'Falta el CSV' }, { status: 400 });

    const rows = parseCsv(body.csv);
    if (rows.length < 2) {
      return NextResponse.json({ error: 'El CSV no tiene filas de datos (solo encabezados o está vacío).' }, { status: 400 });
    }

    const headers = rows[0];
    const nameIdx = headers.findIndex((h) =>
      /ad name|nombre del anuncio|anuncio$/i.test(norm(h)) || norm(h) === 'ad'
    );
    if (nameIdx === -1) {
      return NextResponse.json(
        { error: 'No encontré la columna del nombre del anuncio ("Ad name" / "Nombre del anuncio"). Sin ella no puedo empatar ni crear anuncios.' },
        { status: 400 }
      );
    }

    const sb = getSupabase();
    const nowIso = new Date().toISOString();

    // Universo de conjuntos de la marca (o del usuario) para crear/empatar.
    let setsQuery = sb.from('ad_sets').select('id,name').eq('user_id', user.id);
    if (body.brandId) setsQuery = setsQuery.eq('brand_id', body.brandId);
    const { data: setsData } = await setsQuery;
    const setByName = new Map<string, string>();
    (setsData ?? []).forEach((s) => setByName.set(norm(s.name), s.id));

    // Anuncios existentes en esos conjuntos.
    const setIds = (setsData ?? []).map((s) => s.id);
    const adByName = new Map<string, string>();
    if (setIds.length) {
      const { data: adsData } = await sb.from('ads').select('id,name,ad_set_id').eq('user_id', user.id).in('ad_set_id', setIds);
      (adsData ?? []).forEach((a) => adByName.set(norm(a.name), a.id));
    }

    let updated = 0;
    let created = 0;
    let setsCreated = 0;
    let skippedNoName = 0;
    const dataRows = rows.slice(1, 1 + MAX_ROWS);

    for (const r of dataRows) {
      const adName = (r[nameIdx] ?? '').trim();
      if (!adName) { skippedNoName++; continue; }

      const metrics: Record<string, string> = {};
      headers.forEach((h, i) => { if (h && r[i] !== undefined && r[i] !== '') metrics[h] = r[i]; });

      const existingId = adByName.get(norm(adName));
      if (existingId) {
        await sb.from('ads').update({ metrics, metrics_updated_at: nowIso }).eq('id', existingId).eq('user_id', user.id);
        updated++;
        continue;
      }

      // No existe: crear (con su conjunto si hace falta), infiriendo la maqueta.
      const meta = parseAdName(adName);
      const batchKey = norm(meta.batch);
      let setId = setByName.get(batchKey);
      if (!setId) {
        const { data: newSet } = await sb.from('ad_sets')
          .insert({ user_id: user.id, brand_id: body.brandId ?? null, name: meta.batch })
          .select('id').single();
        if (!newSet) continue;
        setId = newSet.id;
        setByName.set(batchKey, setId as string);
        setsCreated++;
      }
      if (!setId) continue;
      const { data: newAd } = await sb.from('ads')
        .insert({
          ad_set_id: setId,
          user_id: user.id,
          name: adName,
          funnel_stage: meta.stage ?? 'tofu',
          angle: meta.angle ?? null,
          format: meta.format ?? null,
          metrics,
          metrics_updated_at: nowIso,
        })
        .select('id').single();
      if (newAd) { adByName.set(norm(adName), newAd.id); created++; }
    }

    const check = checkHeaders(headers);
    const processed = updated + created;

    let reason: string | null = null;
    if (processed === 0) {
      if (skippedNoName === dataRows.length) reason = 'Ninguna fila trae nombre de anuncio: revisa que exportaste la columna "Nombre del anuncio" con valores.';
      else reason = 'No se pudo actualizar ni crear ningún anuncio. Revisa el formato del export.';
    }

    return NextResponse.json({
      updated, created, setsCreated, skippedNoName,
      rows: dataRows.length,
      lastUpdated: nowIso,
      missingRequired: check.missingRequired,
      ignoredExtras: check.ignoredExtras,
      reason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error procesando métricas';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
