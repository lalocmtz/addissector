// =============================================================================
// Batch — the unit of work, and the only place planning happens.
//
// One angle. ONE declared variable. 4-8 pieces launched together into the
// lateral test campaign, capped at the same impressions so they can be scored
// apples-to-apples. One verdict per piece. One learning when it closes.
//
// This file holds the two rules the old model got wrong:
//
//   1. THE VERDICT IS FOUR-STATE, NOT TWO. A binary winner/loser taxonomy
//      throws away the mid-range creative — 38-46% of a portfolio — which is
//      what holds the account up when the winners fade. Killing those during a
//      bad week is how an account gets volatile.
//
//   2. THE NAME IS MINTED HERE, NEVER TYPED. Naming conventions are the first
//      system creative teams abandon, and they abandon them because a human
//      maintains them: someone mistypes, someone new invents their own dialect,
//      and six months of reporting splits in half. The platform owns the name;
//      the strategist copies it. Six fields, because the rest already lives in
//      this database keyed by ad_id and a join is cheaper than a convention.
// =============================================================================

import type { Economics } from '@/lib/meta';

// ---------------------------------------------------------------------------
// The one variable a batch is allowed to change
// ---------------------------------------------------------------------------
export const BATCH_VARIABLES = ['hook', 'format', 'offer', 'proof_type', 'awareness_level', 'creator', 'visual_style', 'cta'] as const;
export type BatchVariable = (typeof BATCH_VARIABLES)[number];

export const AWARENESS_STAGES = ['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware'] as const;
export type AwarenessStage = (typeof AWARENESS_STAGES)[number];

export const PIECE_FORMATS = ['static', 'video', 'ugc', 'carousel', 'animation'] as const;
export type PieceFormat = (typeof PIECE_FORMATS)[number];

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
export const VERDICTS = ['breakthrough', 'kpi_winner', 'spend_winner', 'loser'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const ARCHIVE_REASONS = ['frequency', 'fatigue', 'offer_ended', 'never_delivered', 'other'] as const;
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

export interface PieceNumbers {
  spend: number;
  revenue: number | null;
  purchases: number | null;
  roas: number | null;
  impressions: number | null;
  days: number;
}

/**
 * Judges one piece against the account, not against its siblings.
 *
 * `medianSpend` is the median spend of every ad in the brand over the window.
 * A piece that took ten times that has been chosen by the delivery system —
 * that is the volume signal, and it is independent of whether the economics
 * worked. Crossing the two gives four honest states instead of a pass/fail:
 *
 *   volume + economics  → breakthrough   scale it
 *   economics, no volume→ kpi_winner     iterate: new hook, same body
 *   volume, no economics→ spend_winner   keep it: this is the account floor
 *   neither             → loser          archive it, WITH a reason
 *
 * A piece that never got enough spend to be judged returns null. Calling that
 * a loser is how a system convinces itself it has learned something.
 */
export function verdictOf(n: PieceNumbers, eco: Economics, medianSpend: number): Verdict | null {
  const floor = Math.max(medianSpend, eco.kill * 0.25);
  if (n.spend < floor) return null;

  const roas = n.roas;
  const tookVolume = medianSpend > 0 ? n.spend >= medianSpend * 10 : n.spend >= eco.kill * 2;
  const paysOff = roas != null && roas >= eco.target;
  const survives = roas != null && roas >= eco.breakeven;

  if (tookVolume && paysOff) return 'breakthrough';
  if (paysOff) return 'kpi_winner';
  if (tookVolume && survives) return 'spend_winner';
  if (survives) return 'kpi_winner';
  return 'loser';
}

/** What to do about it, in one word the screen can render. */
export const VERDICT_ACTION: Record<Verdict, 'scale' | 'iterate' | 'keep' | 'archive'> = {
  breakthrough: 'scale',
  kpi_winner: 'iterate',
  spend_winner: 'keep',
  loser: 'archive',
};

// ---------------------------------------------------------------------------
// Volume: how many pieces this account can actually finance
// ---------------------------------------------------------------------------
export interface VolumePlan {
  /** Net-new concepts per week: (10% of daily spend) / target CPA. */
  concepts_per_week: number;
  /** Pieces per week — concepts times the variants each one needs. */
  pieces_per_week: number;
  /** Winners per month to expect at the industry median hit rate. Not a target: a forecast. */
  expected_winners_per_month: number;
  daily_spend: number;
  cpa: number | null;
}

/** The industry median across 6,015 accounts. Small accounts run 3.8-5%. */
export const MEDIAN_HIT_RATE = 0.05;

export function planVolume(dailySpend: number, cpa: number | null, variantsPerConcept = 3): VolumePlan {
  const effectiveCpa = cpa && cpa > 0 ? cpa : null;
  const concepts = effectiveCpa ? Math.max(1, Math.round((dailySpend * 0.1) / effectiveCpa)) : 1;
  const pieces = concepts * variantsPerConcept;
  return {
    concepts_per_week: concepts,
    pieces_per_week: pieces,
    expected_winners_per_month: Math.round(pieces * 4 * MEDIAN_HIT_RATE * 10) / 10,
    daily_spend: dailySpend,
    cpa: effectiveCpa,
  };
}

// ---------------------------------------------------------------------------
// The name
// ---------------------------------------------------------------------------
const MAX_SEGMENT = 14;

/** ASCII, uppercase, no spaces, no accents. What Meta shows and what parses back. */
export function slug(input: string | null | undefined, max = MAX_SEGMENT): string {
  if (!input) return 'NA';
  const flat = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const clean = flat.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return (clean || 'NA').slice(0, max);
}

const AWARENESS_CODE: Record<string, string> = {
  unaware: 'UNAWARE',
  problem_aware: 'PROBLEM',
  solution_aware: 'SOLUTION',
  product_aware: 'PRODUCT',
  most_aware: 'MOST',
};

export interface MintInput {
  angleCode: string | null;
  batchNumber: number;
  awareness: string | null;
  format: string | null;
  hook: string | null;
  version: number;
}

/**
 * ANGLE-T04-PROBLEM-STATIC-ACUSACION-v1
 *
 * Six fields, and every one of them is something a report gets grouped by.
 * Owner, editor, product and date are deliberately absent: they are columns in
 * this database, reachable by ad_id, and putting them in the name only creates
 * another thing that can be typed wrong.
 */
export function mintAdName(m: MintInput): string {
  return [
    slug(m.angleCode),
    `T${String(m.batchNumber).padStart(2, '0')}`,
    AWARENESS_CODE[m.awareness ?? ''] ?? slug(m.awareness, 8),
    slug(m.format, 8),
    slug(m.hook),
    `v${m.version}`,
  ].join('-');
}

/** Reads a minted name back. Returns null for anything this system did not mint. */
export function parseAdName(name: string): { angle: string; batch: number; awareness: string; format: string; hook: string; version: number } | null {
  const parts = name.trim().split('-');
  if (parts.length !== 6) return null;
  const [angle, batch, awareness, format, hook, version] = parts;
  const b = /^T(\d{2,})$/.exec(batch);
  const v = /^v(\d+)$/.exec(version);
  if (!b || !v) return null;
  return { angle, batch: Number(b[1]), awareness, format, hook, version: Number(v[1]) };
}
