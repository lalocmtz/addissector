// =============================================================================
// Canonical metric definitions. Written once, used everywhere.
//
// ad_daily stores COUNTS. Every rate is derived from sums of counts, never
// averaged from per-row rates ("ROAS = sum(revenue)/sum(spend), never the mean
// of ROAS"). The generated columns in ad_daily (migration 010) mirror exactly
// the formulas below for single rows; this module is the source of truth for
// any aggregate over a range of days or a cohort of ads.
//
// Definitions (all rates in percent):
//   hook_rate  = v3s / impressions          3-second video plays over impressions (thumbstop)
//   hold_rate  = thruplay / v3s             ThruPlays (15s or complete) over 3-second viewers
//   ret25..100 = vXX / v3s                  share of 3-second viewers reaching XX% of the video
//   cvr        = purchases / link_clicks
//   result_rate= link_clicks / impressions  (outbound CTR)
//   roas       = revenue / spend · cpa = spend / purchases · cpc = spend / clicks
//   cpm        = spend / impressions × 1000 · cost_atc = spend / atc
//
// `plays` (video_play_actions) is kept but is NOT the hook numerator: with
// autoplay it fires on ~85–95% of impressions and says nothing about attention.
// =============================================================================

/** One stored day of one ad (a row of ad_daily). Counts only; rates optional. */
export interface AdDailyRow {
  ad_id: string | null;
  ad_name: string;
  date: string;               // YYYY-MM-DD
  source: 'api' | 'csv';
  metrics_version: number;
  status: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  spend: number;
  revenue: number | null;
  purchases: number | null;
  atc: number | null;
  impressions: number | null;
  reach?: number | null;
  freq: number | null;
  link_clicks: number | null;
  plays: number | null;
  v3s: number | null;
  thruplay: number | null;
  v15s?: number | null;
  v25: number | null;
  v50: number | null;
  v75: number | null;
  v100: number | null;
  play_curve?: number[] | null;
  // generated in the DB; present when selected
  roas?: number | null;
  cpa?: number | null;
  cpc?: number | null;
  cpm?: number | null;
  cost_atc?: number | null;
  hook_rate?: number | null;
  hold_rate?: number | null;
  ret25?: number | null;
  ret50?: number | null;
  ret75?: number | null;
  ret100?: number | null;
  cvr?: number | null;
  result_rate?: number | null;
}

/** The columns a consumer should select from ad_daily. */
export const AD_DAILY_COLUMNS =
  'ad_id,ad_name,date,source,metrics_version,status,adset_id,adset_name,campaign_id,campaign_name,' +
  'spend,revenue,purchases,atc,impressions,reach,freq,link_clicks,plays,v3s,thruplay,v15s,v25,v50,v75,v100,' +
  'roas,cpa,cpc,cpm,cost_atc,hook_rate,hold_rate,ret25,ret50,ret75,ret100,cvr,result_rate';

const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);
const div = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** Sums of counts over any set of rows. Null-aware: a metric nobody reported stays null. */
export interface Totals {
  spend: number;
  revenue: number | null;
  purchases: number | null;
  atc: number | null;
  impressions: number | null;
  link_clicks: number | null;
  plays: number | null;
  v3s: number | null;
  thruplay: number | null;
  v25: number | null;
  v50: number | null;
  v75: number | null;
  v100: number | null;
  /** impression-weighted frequency */
  freq: number | null;
  days: number;
}

export function sumRows(rows: AdDailyRow[]): Totals {
  const t: Totals = {
    spend: 0, revenue: null, purchases: null, atc: null, impressions: null, link_clicks: null,
    plays: null, v3s: null, thruplay: null, v25: null, v50: null, v75: null, v100: null, freq: null, days: 0,
  };
  let freqW = 0, freqImp = 0;
  const add = (cur: number | null, v: number | null | undefined): number | null =>
    v == null ? cur : (cur ?? 0) + v;
  for (const r of rows) {
    t.days++;
    t.spend += r.spend ?? 0;
    t.revenue = add(t.revenue, r.revenue);
    t.purchases = add(t.purchases, r.purchases);
    t.atc = add(t.atc, r.atc);
    t.impressions = add(t.impressions, r.impressions);
    t.link_clicks = add(t.link_clicks, r.link_clicks);
    t.plays = add(t.plays, r.plays);
    t.v3s = add(t.v3s, r.v3s);
    t.thruplay = add(t.thruplay, r.thruplay);
    t.v25 = add(t.v25, r.v25);
    t.v50 = add(t.v50, r.v50);
    t.v75 = add(t.v75, r.v75);
    t.v100 = add(t.v100, r.v100);
    if (r.freq != null && r.impressions) { freqW += r.freq * r.impressions; freqImp += r.impressions; }
  }
  t.freq = freqImp > 0 ? freqW / freqImp : null;
  return t;
}

/** Every derived rate, from totals. THE definitions. */
export interface Rates {
  roas: number | null;
  cpa: number | null;
  cpc: number | null;
  cpm: number | null;
  cost_atc: number | null;
  hook_rate: number | null;
  hold_rate: number | null;
  ret25: number | null;
  ret50: number | null;
  ret75: number | null;
  ret100: number | null;
  cvr: number | null;
  result_rate: number | null;
}

export function ratesOf(t: Totals): Rates {
  const imp = t.impressions ?? 0;
  const v3s = t.v3s ?? 0;
  const clicks = t.link_clicks ?? 0;
  return {
    roas: t.revenue != null ? div(t.revenue, t.spend) : null,
    cpa: t.purchases != null && t.purchases > 0 ? t.spend / t.purchases : null,
    cpc: clicks > 0 ? t.spend / clicks : null,
    cpm: imp > 0 ? (t.spend / imp) * 1000 : null,
    cost_atc: t.atc != null && t.atc > 0 ? t.spend / t.atc : null,
    hook_rate: t.v3s != null ? pct(v3s, imp) : null,
    hold_rate: t.thruplay != null ? pct(t.thruplay, v3s) : null,
    ret25: t.v25 != null ? pct(t.v25, v3s) : null,
    ret50: t.v50 != null ? pct(t.v50, v3s) : null,
    ret75: t.v75 != null ? pct(t.v75, v3s) : null,
    ret100: t.v100 != null ? pct(t.v100, v3s) : null,
    cvr: t.purchases != null ? pct(t.purchases, clicks) : null,
    result_rate: t.link_clicks != null ? pct(clicks, imp) : null,
  };
}

/** Per-ad aggregate over a range: totals + rates + recency signals. Keyed by ad_id. */
export interface AdAggregate extends Totals, Rates {
  ad_id: string;
  ad_name: string;
  status: string | null;
  first_date: string | null;
  last_date: string | null;
  spend_last3: number;
  roas_last3: number | null;
  /** true when any row still carries untrusted video metrics (metrics_version 0) */
  video_metrics_pending: boolean;
}

/**
 * Aggregates daily rows by ad_id. Rows without ad_id (legacy CSV rows whose
 * name mapped to more than one ad) are skipped: they cannot be attributed.
 * Sorted by spend desc — spend is the signal that Meta was able to distribute
 * the creative.
 */
export function aggregateByAd(rows: AdDailyRow[]): AdAggregate[] {
  const by = new Map<string, AdDailyRow[]>();
  for (const r of rows) {
    if (!r.ad_id) continue;
    const arr = by.get(r.ad_id) ?? [];
    arr.push(r);
    by.set(r.ad_id, arr);
  }
  const out: AdAggregate[] = [];
  for (const [adId, days] of by) {
    days.sort((a, b) => a.date.localeCompare(b.date));
    const totals = sumRows(days);
    const last3 = days.slice(-3);
    const t3 = sumRows(last3);
    const last = days[days.length - 1];
    out.push({
      ad_id: adId,
      ad_name: last.ad_name,
      status: last.status,
      first_date: days[0].date,
      last_date: last.date,
      ...totals,
      ...ratesOf(totals),
      spend_last3: t3.spend,
      roas_last3: t3.revenue != null ? div(t3.revenue, t3.spend) : null,
      video_metrics_pending: days.some((d) => d.metrics_version === 0 && d.source === 'api'),
    });
  }
  return out.sort((a, b) => b.spend - a.spend);
}

/** Rollup of a cohort of aggregates (concept, angle, account…). Same rules. */
export function rollupAggregates(ads: AdAggregate[]): Totals & Rates & { ads: number } {
  const add = (cur: number | null, v: number | null): number | null => (v == null ? cur : (cur ?? 0) + v);
  const t: Totals = {
    spend: 0, revenue: null, purchases: null, atc: null, impressions: null, link_clicks: null,
    plays: null, v3s: null, thruplay: null, v25: null, v50: null, v75: null, v100: null, freq: null, days: 0,
  };
  let freqW = 0, freqImp = 0;
  for (const a of ads) {
    t.spend += a.spend;
    t.days += a.days;
    t.revenue = add(t.revenue, a.revenue);
    t.purchases = add(t.purchases, a.purchases);
    t.atc = add(t.atc, a.atc);
    t.impressions = add(t.impressions, a.impressions);
    t.link_clicks = add(t.link_clicks, a.link_clicks);
    t.plays = add(t.plays, a.plays);
    t.v3s = add(t.v3s, a.v3s);
    t.thruplay = add(t.thruplay, a.thruplay);
    t.v25 = add(t.v25, a.v25);
    t.v50 = add(t.v50, a.v50);
    t.v75 = add(t.v75, a.v75);
    t.v100 = add(t.v100, a.v100);
    if (a.freq != null && a.impressions) { freqW += a.freq * a.impressions; freqImp += a.impressions; }
  }
  t.freq = freqImp > 0 ? freqW / freqImp : null;
  return { ...t, ...ratesOf(t), ads: ads.length };
}
