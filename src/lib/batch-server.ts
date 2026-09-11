// =============================================================================
// Batch — server-side loading for the single screen.
//
// The screen asks three questions and this answers all three in one pass:
//
//   CORE   what is carrying revenue right now, and what to do about each piece
//   LIVE   the one batch in the test campaign, scored at equal impressions
//   BENCH  the next batches, briefed and waiting
//
// Everything a piece is judged on comes from ad_daily. Nothing here is set by
// hand and nothing is written by a model.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow, type AdAggregate } from '@/lib/metrics';
import { resolveEconomics, type Economics } from '@/lib/meta';
import { fetchAll } from '@/lib/fetch-all';
import { verdictOf, planVolume, type Verdict, type VolumePlan } from '@/lib/batch';

export const BATCH_SELECT =
  'id,user_id,brand_id,number,code,name,hypothesis,variable,angle_id,concept_id,persona_id,product_id,' +
  'owner_id,status,brief,hypothesis_doc,notes,awareness,impression_cap,success_criteria,' +
  'planned_for,started_at,closed_at,close_reason,closed_note,learning_id,created_at,updated_at';

export const PIECE_SELECT =
  'id,experiment_id,brand_id,ad_name,variant,hook,hook_id,format,format_code,beats,failure_mode,awareness,script,visual_notes,' +
  'status,owner_id,meta_ad_id,matched_at,uploaded_at,verdict,verdict_at,archived_reason,created_at';

export interface PieceRow {
  id: string; experiment_id: string | null; brand_id: string; ad_name: string; variant: string | null;
  hook: string | null; hook_id: string | null; format: string | null; format_code: string | null;
  beats: { open?: string; body?: string; close?: string } | null; failure_mode: string | null; awareness: string | null;
  script: string | null; visual_notes: string | null; status: string; owner_id: string | null;
  meta_ad_id: string | null; matched_at: string | null; uploaded_at: string | null;
  verdict: Verdict | null; verdict_at: string | null; archived_reason: string | null; created_at: string;
}

export interface PieceView extends PieceRow {
  owner_name: string | null;
  spend: number;
  revenue: number | null;
  purchases: number | null;
  roas: number | null;
  cpa: number | null;
  impressions: number | null;
  hook_rate: number | null;
  freq: number | null;
  days: number;
  /** Computed now from ad_daily. Null when the piece has not carried enough spend to be judged. */
  verdict_now: Verdict | null;
  /** true once it has reached the batch's impression cap and can be scored fairly. */
  capped: boolean;
}

export interface BatchView {
  id: string; number: number; code: string; name: string;
  hypothesis: string | null; variable: string; awareness: string | null;
  angle_id: string | null; angle_code: string | null; angle_name: string | null;
  persona_name: string | null;
  owner_id: string | null; owner_name: string | null;
  status: string; impression_cap: number;
  /**
   * What the screen groups by. `testing` = at least one piece is on Meta,
   * `waiting` = every piece is produced/uploaded and none has appeared on Meta
   * yet, `producing` = still being made, `closed` = closed or archived.
   */
  stage: BatchStage;
  planned_for: string | null; started_at: string | null; closed_at: string | null;
  close_reason: string | null; closed_note: string | null; learning_id: string | null;
  brief: unknown; hypothesis_doc: unknown; notes: string | null;
  pieces: PieceView[];
  spend: number;
  /** Share of pieces that have reached the cap. The batch is readable at 1. */
  progress: number;
}

export type BatchStage = 'testing' | 'waiting' | 'producing' | 'closed';

/** One ad in the core, with what to do about it. */
export interface CoreAd {
  ad_id: string;
  ad_name: string;
  status: string | null;
  spend: number;
  revenue: number | null;
  purchases: number | null;
  roas: number | null;
  cpa: number | null;
  freq: number | null;
  verdict: Verdict | null;
  angle_code: string | null;
  batch_number: number | null;
}

export interface Workshop {
  currency: string | null;
  economics: Economics;
  volume: VolumePlan;
  /** Median ad spend over the window. The volume signal is measured against this. */
  median_spend: number;
  window_days: number;
  core: CoreAd[];
  live: BatchView[];
  bench: BatchView[];
  closed: BatchView[];
  /** Winners in the last 30 days. The number that matters — not the hit rate. */
  winners_30d: number;
  /** Spend the taxonomy cannot explain. The honest coverage number. */
  unmapped_spend_pct: number;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function loadWorkshop(
  sb: SupabaseClient, userId: string, brandId: string, windowDays = 30,
): Promise<Workshop> {
  const since = new Date(Date.now() - windowDays * 864e5).toISOString().slice(0, 10);

  const [brandRes, accountRes, batchRes, pieceRes, angleRes, memberRes] = await Promise.all([
    sb.from('brands').select('economics').eq('id', brandId).eq('user_id', userId).single(),
    sb.from('ad_account').select('currency').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle(),
    sb.from('experiment').select(BATCH_SELECT).eq('brand_id', brandId).eq('user_id', userId).order('number', { ascending: false }),
    sb.from('experiment_variant').select(PIECE_SELECT).eq('brand_id', brandId).eq('user_id', userId).order('variant'),
    sb.from('angles').select('id,code,name,persona_id,personas(name)').eq('brand_id', brandId),
    sb.from('member').select('id,name').eq('user_id', userId).eq('active', true),
  ]);
  if (!brandRes.data) throw new Error('Brand not found');

  const eco = resolveEconomics(brandRes.data.economics);
  const batches = (batchRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const pieces = (pieceRes.data ?? []) as unknown as PieceRow[];
  const angles = (angleRes.data ?? []) as unknown as Array<{ id: string; code: string | null; name: string; personas: { name: string } | null }>;
  const members = new Map((memberRes.data ?? []).map((m) => [m.id as string, m.name as string]));
  const angleById = new Map(angles.map((a) => [a.id, a]));

  // Every daily row of the window, once. Everything below is a slice of this.
  const daily = (await fetchAll(() =>
    sb.from('ad_daily').select(AD_DAILY_COLUMNS).eq('brand_id', brandId).gte('date', since).order('date').order('ad_id'),
  )) as unknown as AdDailyRow[];
  const aggregates = aggregateByAd(daily);
  const byAdId = new Map<string, AdAggregate>(aggregates.map((a) => [a.ad_id, a]));

  // ---- auto-match ----------------------------------------------------------
  // The minted name IS the join key. A piece whose exact name appears on exactly
  // one Meta ad in the window gets pinned here, once, so the scorecard fills
  // itself the day the ad starts spending. A name shared by two ad_ids stays
  // unmatched rather than guessed.
  const idsByName = new Map<string, Set<string>>();
  for (const a of aggregates) {
    const key = a.ad_name.trim().toUpperCase();
    (idsByName.get(key) ?? idsByName.set(key, new Set()).get(key)!).add(a.ad_id);
  }
  const now = new Date().toISOString();
  await Promise.all(pieces.filter((p) => !p.meta_ad_id).map(async (p) => {
    const ids = idsByName.get(p.ad_name.trim().toUpperCase());
    if (!ids || ids.size !== 1) return;
    const adId = [...ids][0];
    p.meta_ad_id = adId; p.matched_at = now;
    if (['planned', 'producing', 'ready', 'uploaded'].includes(p.status)) p.status = 'live';
    await sb.from('experiment_variant').update({ meta_ad_id: adId, matched_at: now, status: p.status, updated_at: now }).eq('id', p.id);
  }));

  // A batch with one piece on Meta is in test. Nobody flips this by hand.
  const matchedBatchIds = new Set(pieces.filter((p) => p.meta_ad_id && p.experiment_id).map((p) => p.experiment_id as string));
  await Promise.all(batches
    .filter((b) => matchedBatchIds.has(b.id as string) && ['draft', 'planned', 'producing'].includes(String(b.status)))
    .map(async (b) => {
      b.status = 'live'; b.started_at = (b.started_at as string | null) ?? now;
      await sb.from('experiment').update({ status: 'live', started_at: b.started_at, updated_at: now }).eq('id', b.id as string);
    }));
  const medianSpend = median(aggregates.filter((a) => a.spend > 0).map((a) => a.spend));

  const totalSpend = aggregates.reduce((s, a) => s + a.spend, 0);
  const dailySpend = windowDays > 0 ? totalSpend / windowDays : 0;
  const totalPurchases = aggregates.reduce((s, a) => s + (a.purchases ?? 0), 0);
  const cpa = totalPurchases > 0 ? totalSpend / totalPurchases : null;

  // ---- pieces -------------------------------------------------------------
  const shapePiece = (p: PieceRow, cap: number): PieceView => {
    const a = p.meta_ad_id ? byAdId.get(p.meta_ad_id) : undefined;
    const n = {
      spend: a?.spend ?? 0, revenue: a?.revenue ?? null, purchases: a?.purchases ?? null,
      roas: a?.roas ?? null, impressions: a?.impressions ?? null, days: a?.days ?? 0,
    };
    return {
      ...p,
      owner_name: p.owner_id ? members.get(p.owner_id) ?? null : null,
      ...n,
      cpa: a?.cpa ?? null,
      hook_rate: a?.hook_rate ?? null,
      freq: a?.freq ?? null,
      verdict_now: a ? verdictOf(n, eco, medianSpend) : null,
      capped: (a?.impressions ?? 0) >= cap,
    };
  };

  const shapeBatch = (b: Record<string, unknown>): BatchView => {
    const cap = Number(b.impression_cap ?? 1500);
    const mine = pieces.filter((p) => p.experiment_id === b.id).map((p) => shapePiece(p, cap));
    const angle = b.angle_id ? angleById.get(b.angle_id as string) ?? null : null;
    const status = String(b.status ?? 'draft');
    const stage: BatchStage =
      status === 'closed' || status === 'archived' ? 'closed'
      : status === 'live' || status === 'evaluating' ? 'testing'
      : mine.length > 0 && mine.every((p) => ['ready', 'uploaded'].includes(p.status)) ? 'waiting'
      : 'producing';
    return {
      id: b.id as string, number: Number(b.number ?? 0), code: String(b.code ?? ''), name: String(b.name ?? ''),
      hypothesis: (b.hypothesis as string) ?? null, variable: String(b.variable ?? ''),
      awareness: (b.awareness as string) ?? null,
      angle_id: (b.angle_id as string) ?? null, angle_code: angle?.code ?? null, angle_name: angle?.name ?? null,
      persona_name: angle?.personas?.name ?? null,
      owner_id: (b.owner_id as string) ?? null,
      owner_name: b.owner_id ? members.get(b.owner_id as string) ?? null : null,
      status, stage, impression_cap: cap,
      planned_for: (b.planned_for as string) ?? null, started_at: (b.started_at as string) ?? null,
      closed_at: (b.closed_at as string) ?? null, close_reason: (b.close_reason as string) ?? null,
      closed_note: (b.closed_note as string) ?? null, learning_id: (b.learning_id as string) ?? null,
      brief: b.brief ?? null, hypothesis_doc: b.hypothesis_doc ?? null, notes: (b.notes as string) ?? null,
      pieces: mine,
      spend: mine.reduce((s, p) => s + p.spend, 0),
      progress: mine.length ? mine.filter((p) => p.capped).length / mine.length : 0,
    };
  };

  const all = batches.map(shapeBatch);
  const live = all.filter((b) => ['live', 'evaluating'].includes(b.status));
  const bench = all.filter((b) => ['draft', 'planned', 'producing', 'ready'].includes(b.status));
  const closed = all.filter((b) => b.status === 'closed');

  // ---- core ---------------------------------------------------------------
  // Pieces know their angle and batch; everything else falls back to meta_ads
  // taxonomy. Ads that answer to neither are what the unmapped number counts.
  const pieceByAd = new Map<string, { angle_code: string | null; batch: number }>();
  for (const b of all) for (const p of b.pieces) if (p.meta_ad_id) pieceByAd.set(p.meta_ad_id, { angle_code: b.angle_code, batch: b.number });

  const liveIds = new Set<string>();
  for (const b of live) for (const p of b.pieces) if (p.meta_ad_id) liveIds.add(p.meta_ad_id);

  const { data: taggedAds } = await sb.from('meta_ads').select('ad_id,angle_id').eq('brand_id', brandId).not('angle_id', 'is', null);
  const angleOfAd = new Map((taggedAds ?? []).map((m) => [m.ad_id as string, angleById.get(m.angle_id as string)?.code ?? null]));

  const core: CoreAd[] = aggregates
    .filter((a) => a.spend > 0 && !liveIds.has(a.ad_id))
    .slice(0, 40)
    .map((a) => {
      const fromPiece = pieceByAd.get(a.ad_id);
      return {
        ad_id: a.ad_id, ad_name: a.ad_name, status: a.status,
        spend: a.spend, revenue: a.revenue, purchases: a.purchases,
        roas: a.roas, cpa: a.cpa, freq: a.freq,
        verdict: verdictOf(
          { spend: a.spend, revenue: a.revenue, purchases: a.purchases, roas: a.roas, impressions: a.impressions, days: a.days },
          eco, medianSpend,
        ),
        angle_code: fromPiece?.angle_code ?? angleOfAd.get(a.ad_id) ?? null,
        batch_number: fromPiece?.batch ?? null,
      };
    });

  const mappedSpend = aggregates
    .filter((a) => pieceByAd.has(a.ad_id) || angleOfAd.has(a.ad_id))
    .reduce((s, a) => s + a.spend, 0);

  return {
    currency: accountRes.data?.currency ?? null,
    economics: eco,
    volume: planVolume(dailySpend, cpa),
    median_spend: medianSpend,
    window_days: windowDays,
    core,
    live, bench, closed,
    winners_30d: core.filter((c) => c.verdict === 'breakthrough' || c.verdict === 'kpi_winner').length,
    unmapped_spend_pct: totalSpend > 0 ? ((totalSpend - mappedSpend) / totalSpend) * 100 : 0,
  };
}
