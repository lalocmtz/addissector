// =============================================================================
// GET /api/library?brand=&window= — the Library screen in one call.
//
// Every ad that delivered inside the reporting window (plus the active ads
// that did not) as one row: what it cost and returned in the window, its daily
// spend series, the asset, its tags and whether an AI analysis exists. Totals
// for the window across the whole account come along, so the page can compare
// any slice against the account baseline. Dates are days in America/Mexico_City
// (ad_daily.date is a plain date). The window is anchored on the LAST DAY WITH
// DATA for the brand (yesterday or today, whichever the sync has landed), never
// on the wall clock, so a late sync never shows an empty window.
//
// window ∈ last_7d | last_14d | last_30d | last_90d | this_month | last_month
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { fetchAll } from '@/lib/fetch-all';
import { resolveEconomics, verdictFor } from '@/lib/meta';
import { aggregateByAd, rollupAggregates, AD_DAILY_COLUMNS, type AdDailyRow } from '@/lib/metrics';

export const runtime = 'nodejs';
export const maxDuration = 60;

const LIBRARY_WINDOWS = ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'] as const;
type LibraryWindow = (typeof LIBRARY_WINDOWS)[number];

const TZ = 'America/Mexico_City';

/** Today's calendar date in Mexico City as [y, m, d]. */
function todayInMexico(): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return [get('year'), get('month'), get('day')];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/**
 * from/to (inclusive, YYYY-MM-DD) for a window, anchored on `anchor` (the last
 * day with data, capped at today in Mexico City). "Last N days" = the N days
 * ending on the anchor, like Ads Manager when yesterday is the last full day.
 */
function windowRange(w: LibraryWindow, anchor: string | null): { from: string; to: string } {
  const [ty, tm, td] = todayInMexico();
  const today = iso(utc(ty, tm, td));
  const end = anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor) && anchor < today ? anchor : today;
  const [y, m, d] = end.split('-').map(Number);
  switch (w) {
    case 'this_month': return { from: iso(utc(y, m, 1)), to: end };
    case 'last_month': return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) };
    default: {
      const n = Number(w.replace(/\D/g, ''));
      return { from: iso(utc(y, m, d - (n - 1))), to: end };
    }
  }
}

type AdStatus = 'active' | 'paused' | 'adset_paused' | 'campaign_paused' | 'with_issues' | 'disapproved' | 'unknown';

function normalizeStatus(raw: string | null | undefined): AdStatus {
  const s = (raw ?? '').toLowerCase().trim();
  if (!s) return 'unknown';
  if (s === 'active' || s === 'activo') return 'active';
  if (s.includes('campaign')) return 'campaign_paused';
  if (s.includes('adset') || s.includes('ad_set') || s.includes('conjunto')) return 'adset_paused';
  if (s.includes('paused') || s.includes('pausado') || s === 'inactive') return 'paused';
  if (s.includes('issue') || s.includes('problem')) return 'with_issues';
  if (s.includes('disapproved') || s.includes('rechazado')) return 'disapproved';
  return 'unknown';
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const brandId = sp.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Missing brand' }, { status: 400 });
  const wParam = sp.get('window');
  const window: LibraryWindow = (LIBRARY_WINDOWS as readonly string[]).includes(wParam ?? '') ? (wParam as LibraryWindow) : 'last_30d';
  const sb = getSupabase();

  // Anchor = the last day the brand has data for (see header).
  let range: { from: string; to: string };
  let brandRes: { data: { economics: unknown } | null };
  try {
    const [b, last] = await Promise.all([
      sb.from('brands').select('economics').eq('id', brandId).eq('user_id', user.id).single(),
      sb.from('ad_daily').select('date').eq('brand_id', brandId).not('ad_id', 'is', null).order('date', { ascending: false }).limit(1).maybeSingle(),
    ]);
    brandRes = b;
    range = windowRange(window, (last.data as { date?: string } | null)?.date ?? null);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Query failed' }, { status: 500 });
  }
  if (!brandRes.data) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  let daily: AdDailyRow[], metaAds: Record<string, unknown>[], dims: Record<string, unknown>[], creatives: Record<string, unknown>[];
  let accountRes: { data: { currency: string | null } | null };
  let personas: { id: string; name: string }[], angles: { id: string; code: string | null; name: string }[], concepts: { id: string; code: string | null; name: string }[];
  let variants: Record<string, unknown>[];
  try {
    [accountRes, daily, metaAds, dims, creatives, personas, angles, concepts, variants] = await Promise.all([
      sb.from('ad_account').select('currency').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle(),
      fetchAll(() => sb.from('ad_daily').select(AD_DAILY_COLUMNS).eq('brand_id', brandId).not('ad_id', 'is', null).gte('date', range.from).lte('date', range.to).order('date').order('ad_id')) as unknown as Promise<AdDailyRow[]>,
      fetchAll(() => sb.from('meta_ads').select('id,ad_id,name,status,asset_kind,asset_url,thumbnail_url,media_url,media_type,video_id,duration,creative_id,dossier_video,dossier_meta,persona_id,angle_id,concept_id').eq('brand_id', brandId).not('ad_id', 'is', null).order('ad_id')),
      fetchAll(() => sb.from('ad_dimension').select('ad_id,creative_id,dimension,value').eq('brand_id', brandId).order('id')),
      fetchAll(() => sb.from('creatives').select('id,meta_ad_id,type,preview_url').eq('user_id', user.id).eq('brand_id', brandId).order('id')),
      fetchAll(() => sb.from('personas').select('id,name').eq('brand_id', brandId).order('id')),
      fetchAll(() => sb.from('angles').select('id,code,name').eq('brand_id', brandId).order('id')),
      fetchAll(() => sb.from('concepts').select('id,code,name').eq('brand_id', brandId).order('id')),
      fetchAll(() => sb.from('experiment_variant').select('meta_ad_id,concept_id').eq('brand_id', brandId).not('meta_ad_id', 'is', null).order('id')),
    ]);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Query failed' }, { status: 500 });
  }
  const eco = resolveEconomics(brandRes.data.economics);
  const currency = accountRes.data?.currency ?? null;

  // Window aggregates — the same math as every other screen (metrics.ts).
  const agg = aggregateByAd(daily);
  const aggById = new Map(agg.map((a) => [a.ad_id, a]));
  const dailyById = new Map<string, { date: string; spend: number; purchases: number }[]>();
  const lastRow = new Map<string, AdDailyRow>(); // rows arrive date-ordered, so the last write wins
  for (const r of daily) {
    if (!r.ad_id) continue;
    const arr = dailyById.get(r.ad_id) ?? [];
    arr.push({ date: r.date, spend: r.spend ?? 0, purchases: r.purchases ?? 0 });
    dailyById.set(r.ad_id, arr);
    lastRow.set(r.ad_id, r);
  }

  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const metaById = new Map<string, Record<string, unknown>>();
  for (const m of metaAds) { const id = str(m.ad_id); if (id && !metaById.has(id)) metaById.set(id, m); }
  const creativeByMeta = new Map(creatives.filter((c) => str(c.meta_ad_id)).map((c) => [str(c.meta_ad_id) as string, c]));
  const creativeById = new Map(creatives.map((c) => [c.id as string, c]));
  const names = {
    persona: new Map(personas.map((p) => [p.id, p.name])),
    angle: new Map(angles.map((a) => [a.id, a.code ? `${a.code} ${a.name}` : a.name])),
    concept: new Map(concepts.map((c) => [c.id, c.code ? `${c.code} ${c.name}` : c.name])),
  };
  const angleCode = new Map(angles.map((a) => [a.id, a.code ?? null]));
  const dimsByAd = new Map<string, Record<string, string>>(), dimsByCreative = new Map<string, Record<string, string>>();
  for (const d of dims) {
    const adId = str(d.ad_id), crId = str(d.creative_id);
    const target = adId ? dimsByAd : dimsByCreative;
    const key = adId ?? crId;
    if (!key) continue;
    const o = target.get(key) ?? {};
    o[d.dimension as string] = d.value as string;
    target.set(key, o);
  }
  const variantByAd = new Map(variants.map((v) => [str(v.meta_ad_id) as string, v]));

  // Ads = everything that delivered in the window + active ads that did not.
  const ids = new Set<string>(agg.map((a) => a.ad_id));
  for (const [id, m] of metaById) if (normalizeStatus(str(m.status)) === 'active') ids.add(id);

  const ads = [...ids].map((adId) => {
    const a = aggById.get(adId);
    const m = metaById.get(adId);
    const creativeId = m ? str(m.creative_id) : null;
    const creative = creativeByMeta.get(adId) ?? (creativeId ? creativeById.get(creativeId) : undefined);
    const dimensions = dimsByAd.get(adId) ?? (creative ? dimsByCreative.get(creative.id as string) : undefined) ?? {};

    const kindHint = `${str(m?.asset_kind) ?? ''} ${str(m?.media_type) ?? ''}`.toLowerCase();
    let kind: 'video' | 'image';
    if (kindHint.includes('video')) kind = 'video';
    else if (kindHint.includes('image')) kind = 'image';
    else if (m && str(m.video_id)) kind = 'video';
    // Catalog/image ads report a few incidental "plays" (20–30% of impressions);
    // a real video plays on 80%+ of them. The threshold sits between the two.
    else if ((a?.impressions ?? 0) > 0 && (a?.plays ?? 0) / (a?.impressions ?? 1) >= 0.4) kind = 'video';
    else kind = 'image';

    const spend = a?.spend ?? 0;
    const purchases = a?.purchases ?? 0;
    const status = normalizeStatus(a?.status ?? str(m?.status));
    const conceptId = str(m?.concept_id) ?? str(variantByAd.get(adId)?.concept_id);
    const personaId = str(m?.persona_id), angleId = str(m?.angle_id);
    const verdict = a
      ? verdictFor(a, eco, currency)
      : verdictFor({ spend: 0, purchases: 0, roas: null, spend_last3: 0, roas_last3: null }, eco, currency);

    return {
      ad_id: adId,
      ad_name: a?.ad_name ?? str(m?.name) ?? adId,
      campaign_name: lastRow.get(adId)?.campaign_name ?? null,
      adset_name: lastRow.get(adId)?.adset_name ?? null,
      status,
      delivered: spend > 0,
      first_date: a?.first_date ?? null,
      last_date: a?.last_date ?? null,
      days: a?.days ?? 0,
      spend,
      revenue: a?.revenue ?? 0,
      purchases,
      roas: a?.roas ?? null,
      cpa: a?.cpa ?? null,
      impressions: a?.impressions ?? null,
      link_clicks: a?.link_clicks ?? null,
      ctr: a?.result_rate ?? null,
      cpm: a?.cpm ?? null,
      freq: a?.freq ?? null,
      hook_rate: a?.hook_rate ?? null,
      hold_rate: a?.hold_rate ?? null,
      cvr: a?.cvr ?? null,
      daily: dailyById.get(adId) ?? [],
      verdict: verdict.id,
      verdict_why: verdict.why,
      kind,
      asset_type: dimensions.format ?? null,
      asset_url: str(m?.asset_url) ?? str(m?.media_url),
      thumbnail_url: str(m?.thumbnail_url) ?? (creative ? str(creative.preview_url) : null),
      duration: typeof m?.duration === 'number' ? m.duration : m?.duration != null ? Number(m.duration) : null,
      creative_id: creative ? (creative.id as string) : null,
      creative_type: creative ? str(creative.type) : null,
      analyzed: Boolean(creative) || Boolean(m?.dossier_video),
      has_dossier: Boolean(m?.dossier_video || m?.dossier_meta),
      persona_id: personaId, angle_id: angleId, concept_id: conceptId,
      persona: personaId ? names.persona.get(personaId) ?? null : null,
      angle: angleId ? names.angle.get(angleId) ?? null : null,
      angle_code: angleId ? angleCode.get(angleId) ?? null : null,
      concept: conceptId ? names.concept.get(conceptId) ?? null : null,
      dimensions,
    };
  }).sort((a, b) => b.spend - a.spend);

  const acc = rollupAggregates(agg);
  const totals = {
    spend: acc.spend,
    impressions: acc.impressions ?? 0,
    purchases: acc.purchases ?? 0,
    revenue: acc.revenue ?? 0,
    link_clicks: acc.link_clicks ?? 0,
    roas: acc.roas,
    cpa: acc.cpa,
    cpm: acc.cpm,
    ctr: acc.result_rate,
  };

  return NextResponse.json({ window: { id: window, ...range }, ads, totals, currency, economics: eco, personas, angles, concepts });
}
