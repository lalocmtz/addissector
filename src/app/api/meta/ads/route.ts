// =============================================================================
// GET /api/meta/ads?brand=&window=last7[&from=&to=][&ad=<ad_id>]
//
// Per-ad aggregates over a time window (or the daily series of one ad with
// ?ad=). Everything is keyed by the Meta ad_id; the name is an attribute.
// Windows: today · yesterday · last3 · last7 · last14 · last30 · lifetime ·
// custom (from/to). Each ad carries its momentum (phase, spend velocity, ROAS
// slope) computed on its full history, and the numbers of the previous period
// of equal length for comparison. Account averages come along for context.
// Returns the account currency so the client never guesses a symbol.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { aggregateByAd, rollupAggregates, AD_DAILY_COLUMNS, type AdDailyRow } from '@/lib/metrics';
import { resolveWindow, isWindowId, delta, type WindowId } from '@/lib/windows';
import { resolveEconomics } from '@/lib/meta';
import { verdictOf, signalFloor } from '@/lib/verdict';
import { fetchAll } from '@/lib/fetch-all';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const brandId = sp.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Missing brand' }, { status: 400 });
  const adId = sp.get('ad');
  const windowParam = sp.get('window');
  const customFrom = sp.get('from');
  const customTo = sp.get('to');

  const sb = getSupabase();

  // Brand must belong to the user (defense in depth: RLS is bypassed by the service role).
  const { data: brand } = await sb.from('brands').select('id,economics').eq('id', brandId).eq('user_id', user.id).maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  const eco = resolveEconomics(brand.economics);

  const { data: accountRow } = await sb
    .from('ad_account').select('ad_account_id,currency,currency_source,timezone,last_synced_at')
    .eq('brand_id', brandId).eq('active', true).order('created_at').limit(1).maybeSingle();

  // Full history of the brand (momentum needs it; windows slice it).
  let all: AdDailyRow[];
  try {
    all = (await fetchAll(() => {
      const q = sb.from('ad_daily').select(AD_DAILY_COLUMNS).eq('brand_id', brandId).not('ad_id', 'is', null);
      return (adId ? q.eq('ad_id', adId) : q).order('date', { ascending: true }).order('ad_id');
    })) as unknown as AdDailyRow[];
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Query failed' }, { status: 500 });
  }

  // Daily series of one ad
  if (adId) {
    return NextResponse.json({ daily: all, currency: accountRow?.currency ?? null });
  }

  const memoryFrom = all[0]?.date ?? null;
  const memoryTo = all.length ? all[all.length - 1].date : null;
  const anchor = memoryTo ?? new Date().toISOString().slice(0, 10);
  const windowId: WindowId = isWindowId(windowParam) ? windowParam : (customFrom || customTo ? 'custom' : 'lifetime');
  const win = resolveWindow(windowId, anchor, { from: customFrom, to: customTo });
  const inRange = (r: AdDailyRow, range: { from: string | null; to: string | null }) =>
    (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to);

  const momentumOpts = { minSpend: eco.kill * 0.5, breakeven: eco.breakeven };
  const lifetime = aggregateByAd(all, momentumOpts);
  const momentumById = new Map(lifetime.map((a) => [a.ad_id, a.momentum]));
  const rows = all.filter((r) => inRange(r, win.current));
  const ads = aggregateByAd(rows).map((a) => ({ ...a, momentum: momentumById.get(a.ad_id) }));
  const prevAds = win.previous ? aggregateByAd(all.filter((r) => inRange(r, win.previous!))) : [];
  const prevById = new Map(prevAds.map((a) => [a.ad_id, a]));
  // --- Ventanas fijas 3d / 7d / 14d -----------------------------------------
  // El veredicto NO depende de la ventana que el usuario esté mirando: 7d manda
  // y 14d confirma, siempre, aunque en pantalla esté "Hoy". Se calculan sobre
  // el mismo `all` que ya está en memoria, así que no cuestan una consulta más.
  const diasAtras = (n: number) => {
    const d = new Date(`${anchor}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (n - 1));
    return d.toISOString().slice(0, 10);
  };
  const ventana = (n: number) => {
    const desde = diasAtras(n);
    return new Map(aggregateByAd(all.filter((r) => r.date >= desde && r.date <= anchor)).map((a) => [a.ad_id, a]));
  };
  const w3 = ventana(3);
  const w7 = ventana(7);
  const w14 = ventana(14);
  const piso = signalFloor(eco);

  const account = rollupAggregates(ads);
  const accountPrev = win.previous ? rollupAggregates(prevAds) : null;

  // Ad dimension: dossier + linked creative, keyed by ad_id
  const dims = await fetchAll(() => sb
    .from('meta_ads')
    .select('id,ad_id,name,status,created_date,first_seen,last_seen,dossier_meta,dossier_video,creative_id,fusion,fusion_at,asset_kind,asset_url,thumbnail_url,media_url,media_type,duration,persona_id,angle_id,concept_id')
    .eq('brand_id', brandId).order('id'));
  const dimById = new Map(dims.map((d) => [d.ad_id as string, d]));

  // Library creatives: linked by meta_ad_id (pinned) → creative_id (dim) → name (legacy fallback)
  const { data: creatives } = await sb
    .from('creatives')
    .select('id,name,ad_name,meta_ad_id,type,hook_score,video_url')
    .eq('user_id', user.id)
    .eq('brand_id', brandId);
  const norm = (s: string) => s.toLowerCase().replace(/\.(mp4|mov|webm|m4v|png|jpg|jpeg)$/i, '').replace(/\s+/g, ' ').trim();
  const creativeByMetaId = new Map<string, { id: string; hook_score: number | null; video_url: string | null }>();
  const creativeByName = new Map<string, { id: string; hook_score: number | null; video_url: string | null }>();
  const creativeById = new Map<string, { id: string; hook_score: number | null; video_url: string | null }>();
  for (const c of creatives ?? []) {
    creativeById.set(c.id, c);
    if (c.meta_ad_id) creativeByMetaId.set(c.meta_ad_id, c);
    const key = c.ad_name || c.name;
    if (key) creativeByName.set(norm(key), c);
  }

  /** Lo que la tabla necesita de una ventana, sin arrastrar el agregado entero. */
  const slice = (x: ReturnType<typeof aggregateByAd>[number] | undefined) => x ? {
    spend: x.spend, revenue: x.revenue, purchases: x.purchases, roas: x.roas, cpa: x.cpa,
    hook_rate: x.hook_rate, hold_rate: x.hold_rate, ret50: x.ret50, ret75: x.ret75,
    freq: x.freq, cvr: x.cvr, cpm: x.cpm, cpc: x.cpc, cost_atc: x.cost_atc,
  } : null;

  const enriched = ads.map((a) => {
    const dim = dimById.get(a.ad_id);
    const prev = prevById.get(a.ad_id);
    const linked =
      creativeByMetaId.get(a.ad_id) ??
      (dim?.creative_id ? creativeById.get(dim.creative_id) : undefined) ??
      creativeByName.get(norm(a.ad_name));
    return {
      ...a,
      meta_id: dim?.id ?? null,
      created_date: dim?.created_date ?? null,
      dossier_meta: dim?.dossier_meta ?? null,
      dossier_video: dim?.dossier_video ?? null,
      creative_id: linked?.id ?? null,
      analyzed: Boolean(linked) || Boolean(dim?.dossier_video),
      has_dossier: Boolean(dim?.dossier_meta || dim?.dossier_video),
      fusion: dim?.fusion ?? null,
      fusion_at: dim?.fusion_at ?? null,
      asset_kind: dim?.asset_kind ?? dim?.media_type ?? null,
      asset_url: dim?.asset_url ?? dim?.media_url ?? null,
      thumbnail_url: dim?.thumbnail_url ?? null,
      duration: dim?.duration ?? null,
      persona_id: dim?.persona_id ?? null,
      angle_id: dim?.angle_id ?? null,
      concept_id: dim?.concept_id ?? null,
      d3: slice(w3.get(a.ad_id)),
      d7: slice(w7.get(a.ad_id)),
      d14: slice(w14.get(a.ad_id)),
      verdict: verdictOf(
        { spend: w7.get(a.ad_id)?.spend ?? 0, roas: w7.get(a.ad_id)?.roas ?? null, purchases: w7.get(a.ad_id)?.purchases ?? null, freq: w7.get(a.ad_id)?.freq ?? null },
        w14.get(a.ad_id) ? { spend: w14.get(a.ad_id)!.spend, roas: w14.get(a.ad_id)!.roas, purchases: w14.get(a.ad_id)!.purchases, freq: w14.get(a.ad_id)!.freq } : null,
        eco,
      ),
      previous: prev ? { spend: prev.spend, roas: prev.roas, hook_rate: prev.hook_rate, cpa: prev.cpa, purchases: prev.purchases } : null,
      delta: prev ? { spend: delta(a.spend, prev.spend), roas: delta(a.roas, prev.roas), hook_rate: delta(a.hook_rate, prev.hook_rate), cpa: delta(a.cpa, prev.cpa) } : null,
    };
  });

  return NextResponse.json({
    ads: enriched,
    economics: eco,
    signalFloor: piso,
    window: win,
    account: {
      current: account,
      previous: accountPrev,
      delta: accountPrev ? { spend: delta(account.spend, accountPrev.spend), roas: delta(account.roas, accountPrev.roas), hook_rate: delta(account.hook_rate, accountPrev.hook_rate), purchases: delta(account.purchases, accountPrev.purchases) } : null,
    },
    currency: accountRow?.currency ?? null,
    currencySource: accountRow?.currency_source ?? null,
    timezone: accountRow?.timezone ?? null,
    lastSyncedAt: accountRow?.last_synced_at ?? null,
    memoryFrom,
    memoryTo,
  });
}
