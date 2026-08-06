// =============================================================================
// POST /api/meta/upload — ingesta idempotente del export del socio.
// Upsert por (brand, ad_name, fecha): re-subir un periodo no duplica; un
// periodo nuevo EXTIENDE la memoria.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { mergeDuplicateDays, type DailyRow } from '@/lib/meta';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface Body {
  brandId: string;
  rows: DailyRow[];
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { brandId, rows: rawRows } = (await request.json()) as Body;
  if (!brandId || !Array.isArray(rawRows) || rawRows.length === 0) {
    return NextResponse.json({ error: 'Faltan brandId o filas' }, { status: 400 });
  }
  // Defensa extra: nunca mandar dos filas con la misma llave al upsert.
  const rows = mergeDuplicateDays(rawRows);

  const sb = getSupabase();

  // 1. Upsert de hechos diarios (en lotes)
  const daily = rows.map((r) => ({
    user_id: user.id,
    brand_id: brandId,
    ad_name: r.ad_name,
    date: r.date,
    status: r.status,
    spend: r.spend ?? 0,
    revenue: r.revenue,
    roas: r.roas,
    cpa: r.cpa,
    cpc: r.cpc,
    cpm: r.cpm,
    v3s: r.v3s,
    hook_rate: r.hook_rate,
    v25: r.v25,
    v50: r.v50,
    v75: r.v75,
    freq: r.freq,
    cost_atc: r.cost_atc,
    link_clicks: r.link_clicks,
    cvr: r.cvr,
    result_rate: r.result_rate,
  }));
  for (let i = 0; i < daily.length; i += 500) {
    const { error } = await sb
      .from('meta_daily')
      .upsert(daily.slice(i, i + 500), { onConflict: 'brand_id,ad_name,date' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 2. Upsert de la dimensión de anuncios (status y rango visto)
  const byAd = new Map<string, { first: string; last: string; status: string | null; created: string | null }>();
  for (const r of rows) {
    const cur = byAd.get(r.ad_name);
    if (!cur) byAd.set(r.ad_name, { first: r.date, last: r.date, status: r.status, created: r.created_date });
    else {
      if (r.date < cur.first) cur.first = r.date;
      if (r.date >= cur.last) { cur.last = r.date; cur.status = r.status; }
      if (!cur.created && r.created_date) cur.created = r.created_date;
    }
  }
  const { data: existing } = await sb
    .from('meta_ads')
    .select('id,name,first_seen,last_seen')
    .eq('brand_id', brandId);
  const existingMap = new Map((existing ?? []).map((e) => [e.name, e]));

  const upserts = Array.from(byAd.entries()).map(([name, info]) => {
    const prev = existingMap.get(name);
    return {
      ...(prev ? { id: prev.id } : {}),
      user_id: user.id,
      brand_id: brandId,
      name,
      status: info.status,
      created_date: info.created,
      first_seen: prev?.first_seen && prev.first_seen < info.first ? prev.first_seen : info.first,
      last_seen: prev?.last_seen && prev.last_seen > info.last ? prev.last_seen : info.last,
      updated_at: new Date().toISOString(),
    };
  });
  for (let i = 0; i < upserts.length; i += 200) {
    const { error } = await sb
      .from('meta_ads')
      .upsert(upserts.slice(i, i + 200), { onConflict: 'brand_id,name' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, days: daily.length, ads: upserts.length });
}
