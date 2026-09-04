// =============================================================================
// Strategy — the hierarchy Persona → Angle → Concept, judged by rollups.
//
// An entity's status is DERIVED from the money spent against it and what it
// returned, using the brand's economics. Never set by hand, never by an LLM:
//   untested   spend < ½ kill
//   testing    ½ kill ≤ spend < 2× kill
//   validated  spend ≥ 2× kill and ROAS ≥ target
//   viable     spend ≥ 2× kill and breakeven ≤ ROAS < target
//   refuted    spend ≥ 2× kill and ROAS < breakeven
//   fatiguing  lifetime ≥ breakeven but the last 14 days fell below it
//
// Ads reach an entity through meta_ads taxonomy pointers (classifier or
// manual) and through experiment variants (concept). A concept implies its
// angle and persona; an angle implies its persona.
// =============================================================================

import type { AdAggregate } from '@/lib/metrics';
import type { Economics } from '@/lib/meta';

export const DERIVED_STATUSES = ['untested', 'testing', 'validated', 'viable', 'refuted', 'fatiguing'] as const;
export type DerivedStatus = (typeof DERIVED_STATUSES)[number];

export interface Rollup {
  ads: number;
  spend: number;
  revenue: number;
  purchases: number;
  roas: number | null;
  hook_rate: number | null;
  hold_rate: number | null;
  best_ad: { ad_id: string; ad_name: string; roas: number | null; spend: number } | null;
}

export const emptyRollup = (): Rollup => ({ ads: 0, spend: 0, revenue: 0, purchases: 0, roas: null, hook_rate: null, hold_rate: null, best_ad: null });

export function rollupOf(ads: AdAggregate[]): Rollup {
  if (!ads.length) return emptyRollup();
  let spend = 0, revenue = 0, purchases = 0, impressions = 0, v3s = 0, thruplay = 0;
  for (const a of ads) {
    spend += a.spend; revenue += a.revenue ?? 0; purchases += a.purchases ?? 0;
    impressions += a.impressions ?? 0; v3s += a.v3s ?? 0; thruplay += a.thruplay ?? 0;
  }
  const best = [...ads].filter((a) => a.spend > 0).sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1))[0] ?? null;
  return {
    ads: ads.length, spend, revenue, purchases,
    roas: spend > 0 ? revenue / spend : null,
    hook_rate: impressions > 0 ? (v3s / impressions) * 100 : null,
    hold_rate: v3s > 0 ? (thruplay / v3s) * 100 : null,
    best_ad: best ? { ad_id: best.ad_id, ad_name: best.ad_name, roas: best.roas, spend: best.spend } : null,
  };
}

export function deriveStatus(lifetime: Rollup, recent: Rollup | null, eco: Economics): DerivedStatus {
  const half = eco.kill * 0.5, full = eco.kill * 2;
  if (lifetime.spend < half) return 'untested';
  if (lifetime.spend < full) return 'testing';
  const roas = lifetime.roas ?? 0;
  if (roas >= eco.breakeven && recent && recent.spend >= half && (recent.roas ?? 0) < eco.breakeven) return 'fatiguing';
  if (roas >= eco.target) return 'validated';
  if (roas >= eco.breakeven) return 'viable';
  return 'refuted';
}

export interface ReviewableRow { id: string; review_status: 'proposed' | 'accepted' | 'rejected' | 'merged'; merged_into: string | null }

/** Follows merge pointers so an ad tagged with a merged entity counts for the survivor. */
export function resolveMerged<T extends ReviewableRow>(rows: T[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string>();
  for (const r of rows) {
    let cur: T | undefined = r; let hops = 0;
    while (cur && cur.review_status === 'merged' && cur.merged_into && hops++ < 10) cur = byId.get(cur.merged_into);
    out.set(r.id, cur?.id ?? r.id);
  }
  return out;
}
