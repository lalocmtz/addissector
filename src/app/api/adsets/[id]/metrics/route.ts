import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import { checkHeaders } from '@/lib/ad-scoring';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// POST /api/adsets/[id]/metrics — sube el export CSV de Meta y rellena las
// métricas de cada anuncio por coincidencia de nombre. Guarda la fila cruda.
// ---------------------------------------------------------------------------

/** Parser CSV mínimo con soporte de comillas (los exports de Meta las usan). */
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

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isSupabaseConfigured() || !isAuthConfigured()) {
      return NextResponse.json({ error: 'Supabase no configurado' }, { status: 501 });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const { id } = await params;
    const body = (await request.json()) as { csv: string };
    if (!body.csv?.trim()) return NextResponse.json({ error: 'Falta el CSV' }, { status: 400 });

    const rows = parseCsv(body.csv);
    if (rows.length < 2) return NextResponse.json({ error: 'CSV sin datos' }, { status: 400 });

    const headers = rows[0];
    // Columna del nombre del anuncio (Meta: "Ad name" / "Nombre del anuncio")
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
    const { data: ads } = await sb
      .from('ads')
      .select('id,name')
      .eq('ad_set_id', id)
      .eq('user_id', user.id);

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

    const check = checkHeaders(headers);
    return NextResponse.json({ matched, unmatched: unmatchedCsv.slice(0, 10), missingRequired: check.missingRequired, ignoredExtras: check.ignoredExtras });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error procesando métricas';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
