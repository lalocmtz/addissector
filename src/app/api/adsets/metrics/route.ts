import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// POST /api/adsets/metrics — sube el export de Meta UNA vez y rellena las
// métricas de TODOS los anuncios de la marca (o del usuario) por nombre.
// Body: { csv: string, brandId?: string }
// ---------------------------------------------------------------------------

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
    if (rows.length < 2) return NextResponse.json({ error: 'CSV sin datos' }, { status: 400 });

    const headers = rows[0];
    const nameIdx = headers.findIndex((h) =>
      /ad name|nombre del anuncio|anuncio$/i.test(norm(h)) || norm(h) === 'ad'
    );
    if (nameIdx === -1) {
      return NextResponse.json(
        { error: 'No encontré la columna del nombre del anuncio ("Ad name" / "Nombre del anuncio").' },
        { status: 400 }
      );
    }

    const sb = getSupabase();

    // Conjuntos de la marca (si se pasó brandId) para acotar el universo de anuncios.
    let setIds: string[] | null = null;
    if (body.brandId) {
      const { data: sets } = await sb
        .from('ad_sets')
        .select('id')
        .eq('user_id', user.id)
        .eq('brand_id', body.brandId);
      setIds = (sets ?? []).map((s) => s.id);
      if (setIds.length === 0) return NextResponse.json({ matched: 0, totalAds: 0, unmatched: [] });
    }

    let adsQuery = sb.from('ads').select('id,name').eq('user_id', user.id);
    if (setIds) adsQuery = adsQuery.in('ad_set_id', setIds);
    const { data: ads } = await adsQuery;

    let matched = 0;
    const unmatchedCsv: string[] = [];
    for (const r of rows.slice(1)) {
      const adName = r[nameIdx];
      if (!adName) continue;
      const ad = (ads ?? []).find((a) => norm(a.name) === norm(adName));
      if (!ad) { unmatchedCsv.push(adName); continue; }
      const metrics: Record<string, string> = {};
      headers.forEach((h, i) => { if (h && r[i] !== undefined && r[i] !== '') metrics[h] = r[i]; });
      await sb.from('ads').update({ metrics }).eq('id', ad.id).eq('user_id', user.id);
      matched++;
    }

    return NextResponse.json({ matched, totalAds: (ads ?? []).length, unmatched: unmatchedCsv.slice(0, 10) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error procesando métricas';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
