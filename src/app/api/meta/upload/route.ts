// =============================================================================
// POST /api/meta/upload — ingest of the Ads Manager CSV export (fallback path
// for accounts without API access). Writes ad_daily with source = 'csv'.
//
// The export has no ad_id. Each name is resolved against meta_ads: if exactly
// one ad carries that name the row gets its ad_id; if the name is shared by
// several ads the row is stored as legacy_ambiguous (it can only be summed at
// account level, never attributed to one creative). API rows always win: a CSV
// row never overwrites a row the sync already wrote for the same ad and day.
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

const pos = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 ? n : null);

/** Counts from a CSV row (the export carries rates; counts are what we store). */
function countsFrom(r: DailyRow) {
  const spend = r.spend ?? 0;
  const purchases = pos(r.cpa) ? spend / r.cpa! : (r.revenue != null && r.revenue === 0 ? 0 : null);
  const impressions = pos(r.cpm) ? (spend / r.cpm!) * 1000
    : (pos(r.v3s) && pos(r.hook_rate) ? (r.v3s! / r.hook_rate!) * 100 : null);
  const atc = pos(r.cost_atc) ? spend / r.cost_atc! : null;
  return {
    spend,
    revenue: r.revenue ?? (r.roas != null ? r.roas * spend : null),
    purchases,
    atc,
    impressions,
    freq: r.freq,
    link_clicks: r.link_clicks,
    v3s: r.v3s,
    v25: r.v25,
    v50: r.v50,
    v75: r.v75,
  };
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { brandId, rows: rawRows } = (await request.json()) as Body;
  if (!brandId || !Array.isArray(rawRows) || rawRows.length === 0) {
    return NextResponse.json({ error: 'Missing brandId or rows' }, { status: 400 });
  }
  const sb = getSupabase();
  const { data: brand } = await sb.from('brands').select('id').eq('id', brandId).eq('user_id', user.id).maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  // Never two rows with the same key in one upsert.
  const rows = mergeDuplicateDays(rawRows);

  // Name → ad_id, only when unambiguous.
  const { data: metaAds } = await sb.from('meta_ads').select('ad_id,name').eq('brand_id', brandId);
  const idsByName = new Map<string, Set<string>>();
  for (const m of metaAds ?? []) {
    (idsByName.get(m.name) ?? idsByName.set(m.name, new Set()).get(m.name)!).add(m.ad_id as string);
  }
  const resolve = (name: string): { adId: string | null; ambiguous: boolean } => {
    const set = idsByName.get(name);
    if (!set || set.size === 0) return { adId: null, ambiguous: false };
    if (set.size === 1) return { adId: [...set][0], ambiguous: false };
    return { adId: null, ambiguous: true };
  };

  const dates = rows.map((r) => r.date).sort();
  const from = dates[0], to = dates[dates.length - 1];

  // API rows for the same (ad, day) win.
  const { data: apiRows } = await sb
    .from('ad_daily').select('ad_id,date').eq('brand_id', brandId).eq('source', 'api').gte('date', from).lte('date', to);
  const apiKeys = new Set((apiRows ?? []).map((r) => `${r.ad_id}|${r.date}`));

  const withId: Record<string, unknown>[] = [];
  const legacy: Record<string, unknown>[] = [];
  let skippedApi = 0;
  for (const r of rows) {
    const { adId, ambiguous } = resolve(r.ad_name);
    if (adId && apiKeys.has(`${adId}|${r.date}`)) { skippedApi++; continue; }
    const row = {
      user_id: user.id,
      brand_id: brandId,
      ad_id: adId,
      ad_name: r.ad_name,
      date: r.date,
      source: 'csv',
      metrics_version: 1,
      legacy_ambiguous: ambiguous,
      status: r.status,
      ...countsFrom(r),
      updated_at: new Date().toISOString(),
    };
    (adId ? withId : legacy).push(row);
  }

  for (let i = 0; i < withId.length; i += 500) {
    const { error } = await sb.from('ad_daily').upsert(withId.slice(i, i + 500), { onConflict: 'brand_id,ad_id,date' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (legacy.length) {
    // Partial unique index (ad_id is null) cannot be targeted by upsert: replace.
    const names = [...new Set(legacy.map((r) => r.ad_name as string))];
    await sb.from('ad_daily').delete().eq('brand_id', brandId).is('ad_id', null).in('ad_name', names).gte('date', from).lte('date', to);
    for (let i = 0; i < legacy.length; i += 500) {
      const { error } = await sb.from('ad_daily').insert(legacy.slice(i, i + 500));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Ad dimension (status + seen range) for the resolved ads.
  const byAd = new Map<string, { name: string; first: string; last: string; status: string | null; created: string | null }>();
  for (const r of withId as Array<{ ad_id: string; ad_name: string; date: string; status: string | null }>) {
    const src = rows.find((x) => x.ad_name === r.ad_name && x.date === r.date);
    const cur = byAd.get(r.ad_id);
    if (!cur) byAd.set(r.ad_id, { name: r.ad_name, first: r.date, last: r.date, status: r.status, created: src?.created_date ?? null });
    else {
      if (r.date < cur.first) cur.first = r.date;
      if (r.date >= cur.last) { cur.last = r.date; cur.status = r.status; }
      if (!cur.created && src?.created_date) cur.created = src.created_date;
    }
  }
  const { data: existing } = await sb.from('meta_ads').select('ad_id,first_seen,last_seen').eq('brand_id', brandId);
  const prevById = new Map((existing ?? []).map((e) => [e.ad_id as string, e]));
  const upserts = [...byAd.entries()].map(([adId, info]) => {
    const prev = prevById.get(adId);
    return {
      user_id: user.id,
      brand_id: brandId,
      ad_id: adId,
      name: info.name,
      status: info.status,
      created_date: info.created,
      first_seen: prev?.first_seen && prev.first_seen < info.first ? prev.first_seen : info.first,
      last_seen: prev?.last_seen && prev.last_seen > info.last ? prev.last_seen : info.last,
      updated_at: new Date().toISOString(),
    };
  });
  for (let i = 0; i < upserts.length; i += 200) {
    const { error } = await sb.from('meta_ads').upsert(upserts.slice(i, i + 200), { onConflict: 'brand_id,ad_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    days: withId.length + legacy.length,
    ads: upserts.length,
    resolved: withId.length,
    unresolved: legacy.length,
    skippedApiRows: skippedApi,
  });
}
