// =============================================================================
// Planned ad ↔ Meta ad matching. The bridge used to be `planned.ad_name ===
// meta.ad_name`; with ≥22 names shared by more than one ad_id that bridge was
// already broken. Now:
//
//   1. If the planned ad already has meta_ad_id → done, the name is irrelevant.
//   2. Exact name match against the Meta ads that have data — only when the
//      name belongs to exactly ONE ad_id (a colliding name is ambiguous).
//   3. parsePlannedName(): canonical SG_028_YAPROBE_A vs the real-world formats
//      of the account (#28_C, SG#63_V1, CR_00496_C, B07_10). Same number and
//      variant → match, again only if unambiguous.
//
// The first match is PINNED (planned_ads.meta_ad_id + matched_at) so the name
// stops mattering from then on.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePlannedName } from '@/lib/plan';

export interface PlannedLike {
  id: string;
  ad_name: string;
  meta_ad_id: string | null;
}

export interface MetaAdLike {
  ad_id: string;
  ad_name: string;
}

export interface MatchResult<P extends PlannedLike> {
  planned: P;
  adId: string | null;
  /** how the link was made */
  via: 'pinned' | 'exact' | 'parsed' | 'ambiguous' | 'none';
  /** ad_ids competing for the same name/number (when via = ambiguous) */
  candidates: string[];
}

function signature(name: string): string | null {
  const p = parsePlannedName(name);
  if (p.number == null || !p.variant) return null;
  return `${p.prefix ?? '*'}|${p.number}|${p.variant}`;
}

/** Pure matcher. Does not touch the DB. */
export function matchPlannedAds<P extends PlannedLike>(planned: P[], metaAds: MetaAdLike[]): MatchResult<P>[] {
  const byName = new Map<string, Set<string>>();
  const bySig = new Map<string, Set<string>>();
  const bySigLoose = new Map<string, Set<string>>(); // number|variant without prefix
  for (const m of metaAds) {
    (byName.get(m.ad_name) ?? byName.set(m.ad_name, new Set()).get(m.ad_name)!).add(m.ad_id);
    const sig = signature(m.ad_name);
    if (sig) {
      (bySig.get(sig) ?? bySig.set(sig, new Set()).get(sig)!).add(m.ad_id);
      const loose = sig.replace(/^[^|]*\|/, '*|');
      (bySigLoose.get(loose) ?? bySigLoose.set(loose, new Set()).get(loose)!).add(m.ad_id);
    }
  }
  const resolve = (set: Set<string> | undefined): { adId: string | null; ambiguous: string[] } => {
    if (!set || set.size === 0) return { adId: null, ambiguous: [] };
    if (set.size === 1) return { adId: [...set][0], ambiguous: [] };
    return { adId: null, ambiguous: [...set] };
  };

  return planned.map((p) => {
    if (p.meta_ad_id) return { planned: p, adId: p.meta_ad_id, via: 'pinned', candidates: [] };
    const exact = resolve(byName.get(p.ad_name));
    if (exact.adId) return { planned: p, adId: exact.adId, via: 'exact', candidates: [] };
    if (exact.ambiguous.length) return { planned: p, adId: null, via: 'ambiguous', candidates: exact.ambiguous };
    const sig = signature(p.ad_name);
    if (sig) {
      const strict = resolve(bySig.get(sig));
      if (strict.adId) return { planned: p, adId: strict.adId, via: 'parsed', candidates: [] };
      if (strict.ambiguous.length) return { planned: p, adId: null, via: 'ambiguous', candidates: strict.ambiguous };
      const loose = resolve(bySigLoose.get(sig.replace(/^[^|]*\|/, '*|')));
      if (loose.adId) return { planned: p, adId: loose.adId, via: 'parsed', candidates: [] };
      if (loose.ambiguous.length) return { planned: p, adId: null, via: 'ambiguous', candidates: loose.ambiguous };
    }
    return { planned: p, adId: null, via: 'none', candidates: [] };
  });
}

/** Matches and pins new links in planned_ads. Returns the results (pinned ones included). */
export async function matchAndPin<P extends PlannedLike>(
  sb: SupabaseClient, planned: P[], metaAds: MetaAdLike[],
): Promise<MatchResult<P>[]> {
  const results = matchPlannedAds(planned, metaAds);
  const fresh = results.filter((r) => r.adId && r.via !== 'pinned');
  const now = new Date().toISOString();
  await Promise.all(fresh.map((r) =>
    sb.from('planned_ads').update({ meta_ad_id: r.adId, matched_at: now, updated_at: now }).eq('id', r.planned.id),
  ));
  return results;
}
