// =============================================================================
// Experiments — the unit of learning.
//
// An experiment declares ONE variable, a control, and success criteria. Its
// variants are the ads that get produced (experiment_variant), each pinned to
// a Meta ad_id once live. Evaluation is a pure function of the criteria and
// the aggregates; closing is a side effect that writes the result and
// promotes it into a learning attached to the entity the variable named.
//
// Nothing here guesses: a verdict needs the minimum spend the criteria ask
// for, otherwise the experiment keeps running.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdAggregate } from '@/lib/metrics';
import type { Economics } from '@/lib/meta';

export const EXPERIMENT_VARIABLES = ['hook', 'concept', 'angle', 'persona', 'format', 'creator', 'offer', 'cta', 'visual_style', 'proof_type'] as const;
export type ExperimentVariable = (typeof EXPERIMENT_VARIABLES)[number];
export const isVariable = (v: unknown): v is ExperimentVariable => typeof v === 'string' && (EXPERIMENT_VARIABLES as readonly string[]).includes(v);

/** Variables that are cross-cutting dimensions (a learning about them is a dimension learning). */
export const DIMENSION_VARIABLES: ReadonlySet<ExperimentVariable> = new Set(['format', 'creator', 'offer', 'cta', 'visual_style', 'proof_type']);

export const EXPERIMENT_STATUSES = ['draft', 'planned', 'producing', 'live', 'evaluating', 'closed', 'archived'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export interface SuccessCriteria {
  /** total spend across variants before a verdict can be given */
  min_spend: number;
  /** the best variant must reach this ROAS to be validated */
  roas_min: number;
  /** optional gates on the funnel */
  hook_rate_min: number | null;
  hold_rate_min: number | null;
  cpa_max: number | null;
  /** the variant must beat the control by this relative margin (0.1 = 10%) when a control exists */
  beat_control_by: number;
  /** evaluation horizon: after this many days live, whatever is there is judged */
  window_days: number;
}

export function defaultCriteria(eco: Economics): SuccessCriteria {
  return {
    min_spend: Math.round(eco.kill * 2),
    roas_min: eco.breakeven,
    hook_rate_min: null,
    hold_rate_min: null,
    cpa_max: null,
    beat_control_by: 0.1,
    window_days: 7,
  };
}

export function resolveCriteria(raw: unknown, eco: Economics): SuccessCriteria {
  const d = defaultCriteria(eco);
  const r = (raw ?? {}) as Partial<Record<keyof SuccessCriteria, unknown>>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const opt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    min_spend: num(r.min_spend, d.min_spend),
    roas_min: num(r.roas_min, d.roas_min),
    hook_rate_min: opt(r.hook_rate_min),
    hold_rate_min: opt(r.hold_rate_min),
    cpa_max: opt(r.cpa_max),
    beat_control_by: num(r.beat_control_by, d.beat_control_by),
    window_days: Math.max(1, Math.round(num(r.window_days, d.window_days))),
  };
}

export const experimentCode = (n: number) => `EXP-${String(n).padStart(3, '0')}`;

export async function nextExperimentNumber(sb: SupabaseClient, brandId: string): Promise<number> {
  const { data } = await sb.from('experiment').select('number').eq('brand_id', brandId).order('number', { ascending: false }).limit(1).maybeSingle();
  return (data?.number ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type Verdict = 'validated' | 'refuted' | 'inconclusive';

export interface VariantMetrics {
  variant_id: string;
  ad_name: string;
  ad_id: string | null;
  spend: number;
  roas: number | null;
  cpa: number | null;
  hook_rate: number | null;
  hold_rate: number | null;
  purchases: number;
  days: number;
}

export interface Evaluation {
  /** true when the criteria allow a verdict now */
  decidable: boolean;
  /** why it is not decidable yet, or why it was closed */
  reason: 'insufficient_spend' | 'no_live_variants' | 'window_elapsed' | 'criteria_met' | 'criteria_failed';
  verdict: Verdict | null;
  spend: number;
  progress: number;                 // 0..1 of min_spend
  days_live: number;
  best: VariantMetrics | null;
  control: VariantMetrics | null;
  variants: VariantMetrics[];
  gates: { roas: boolean | null; hook: boolean | null; hold: boolean | null; cpa: boolean | null; control: boolean | null };
}

interface VariantLike { id: string; ad_name: string; meta_ad_id: string | null; status: string }

const toMetrics = (v: VariantLike, agg: AdAggregate | undefined): VariantMetrics => ({
  variant_id: v.id, ad_name: v.ad_name, ad_id: v.meta_ad_id ?? null,
  spend: agg?.spend ?? 0, roas: agg?.roas ?? null, cpa: agg?.cpa ?? null,
  hook_rate: agg?.hook_rate ?? null, hold_rate: agg?.hold_rate ?? null,
  purchases: agg?.purchases ?? 0, days: agg?.days ?? 0,
});

/**
 * Judges an experiment. Pure: give it the criteria, the variants and the
 * per-ad aggregates over the evaluation window (plus the control's).
 */
export function evaluateExperiment(args: {
  criteria: SuccessCriteria;
  variants: VariantLike[];
  byAdId: Map<string, AdAggregate>;
  controlAdId: string | null;
  controlName?: string | null;
  startedAt: string | null;
  now?: Date;
}): Evaluation {
  const { criteria, variants, byAdId, controlAdId } = args;
  const now = args.now ?? new Date();
  const live = variants.filter((v) => v.meta_ad_id && !['killed'].includes(v.status));
  const vm = live.map((v) => toMetrics(v, byAdId.get(v.meta_ad_id!)));
  const spend = vm.reduce((s, v) => s + v.spend, 0);
  const control = controlAdId
    ? toMetrics({ id: 'control', ad_name: args.controlName ?? controlAdId, meta_ad_id: controlAdId, status: 'live' }, byAdId.get(controlAdId))
    : null;
  const daysLive = args.startedAt ? Math.max(0, Math.floor((now.getTime() - new Date(args.startedAt).getTime()) / 86_400_000)) : 0;
  const best = vm.filter((v) => v.roas != null).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0]
    ?? vm.sort((a, b) => b.spend - a.spend)[0] ?? null;

  const base = { spend, progress: criteria.min_spend > 0 ? Math.min(1, spend / criteria.min_spend) : 1, days_live: daysLive, best, control, variants: vm };
  const noGates = { roas: null, hook: null, hold: null, cpa: null, control: null };
  if (!live.length) return { decidable: false, reason: 'no_live_variants', verdict: null, ...base, gates: noGates };

  const windowElapsed = daysLive >= criteria.window_days;
  if (spend < criteria.min_spend && !windowElapsed) return { decidable: false, reason: 'insufficient_spend', verdict: null, ...base, gates: noGates };

  // Gates on the best variant.
  const gates = {
    roas: best?.roas != null ? best.roas >= criteria.roas_min : false,
    hook: criteria.hook_rate_min == null ? null : best?.hook_rate != null && best.hook_rate >= criteria.hook_rate_min,
    hold: criteria.hold_rate_min == null ? null : best?.hold_rate != null && best.hold_rate >= criteria.hold_rate_min,
    cpa: criteria.cpa_max == null ? null : best?.cpa != null && best.cpa <= criteria.cpa_max,
    control: control && control.roas != null && best?.roas != null ? best.roas >= control.roas * (1 + criteria.beat_control_by) : null,
  };
  const required = [gates.roas, gates.hook, gates.hold, gates.cpa, gates.control].filter((g): g is boolean => g !== null);
  const allPass = required.every(Boolean);
  const spentEnough = spend >= criteria.min_spend;

  let verdict: Verdict;
  if (allPass && spentEnough) verdict = 'validated';
  else if (spentEnough && !gates.roas) verdict = 'refuted';                 // enough money, did not even reach the floor
  else if (spentEnough && gates.control === false) verdict = 'refuted';     // enough money, control still wins
  else verdict = 'inconclusive';                                            // window elapsed without enough spend, or mixed gates
  return {
    decidable: true,
    reason: verdict === 'validated' ? 'criteria_met' : spentEnough ? 'criteria_failed' : 'window_elapsed',
    verdict, ...base, gates,
  };
}

// ---------------------------------------------------------------------------
// Learning ascent
// ---------------------------------------------------------------------------

export interface ExperimentRow {
  id: string; user_id: string; brand_id: string; code: string; name: string; hypothesis: string | null;
  variable: ExperimentVariable; persona_id: string | null; angle_id: string | null; concept_id: string | null;
  control_ad_id: string | null; success_criteria: unknown; started_at: string | null;
}

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);
const ratio = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}x`);

/** The learning text is written in the base locale; it is data the strategist edits, not UI. */
export function learningTextFor(exp: ExperimentRow, ev: Evaluation, vars: { dimensionValue?: string | null; hookTitle?: string | null }): { text: string; evidence: string } {
  const subject = exp.variable === 'hook' && vars.hookTitle ? `hook "${vars.hookTitle.slice(0, 80)}"`
    : DIMENSION_VARIABLES.has(exp.variable) && vars.dimensionValue ? `${exp.variable.replace('_', ' ')} = ${vars.dimensionValue}`
    : exp.variable;
  const outcome = ev.verdict === 'validated' ? 'works' : ev.verdict === 'refuted' ? 'does not work' : 'is inconclusive';
  const vs = ev.control && ev.control.roas != null ? ` vs control ${ratio(ev.control.roas)}` : '';
  const text = `${exp.code}: ${subject} ${outcome} — ${exp.hypothesis?.trim() || exp.name}. Best variant ${ratio(ev.best?.roas ?? null)} ROAS${vs}, hook ${pct(ev.best?.hook_rate ?? null)}, hold ${pct(ev.best?.hold_rate ?? null)}.`;
  const evidence = ev.variants.map((v) => `${v.ad_name}: spend ${v.spend.toFixed(0)}, ROAS ${ratio(v.roas)}, hook ${pct(v.hook_rate)}, purchases ${v.purchases}`).join(' · ')
    + (ev.control ? ` · control ${ev.control.ad_name}: ROAS ${ratio(ev.control.roas)}, hook ${pct(ev.control.hook_rate)}` : '');
  return { text, evidence };
}

/**
 * Closes the experiment with the evaluation and writes the learning it earned.
 * Idempotent: an experiment that already has a learning is not re-ascended.
 */
export async function closeExperiment(
  sb: SupabaseClient, exp: ExperimentRow, ev: Evaluation, opts: { reason: 'criteria_met' | 'criteria_failed' | 'manual' | 'stale'; hookId?: string | null; hookTitle?: string | null; dimensionValue?: string | null },
): Promise<{ learningId: string | null }> {
  const now = new Date().toISOString();
  const { data: existing } = await sb.from('experiment').select('learning_id,status').eq('id', exp.id).single();
  let learningId: string | null = existing?.learning_id ?? null;

  if (!learningId && ev.verdict) {
    const { text, evidence } = learningTextFor(exp, ev, opts);
    const isDim = DIMENSION_VARIABLES.has(exp.variable);
    const { data: learning } = await sb.from('learnings').insert({
      user_id: exp.user_id, brand_id: exp.brand_id, text, evidence, source: 'experiment', active: true,
      persona_id: exp.persona_id, angle_id: exp.angle_id, concept_id: exp.concept_id,
      hook_id: exp.variable === 'hook' ? opts.hookId ?? null : null,
      experiment_id: exp.id,
      dimension: isDim ? exp.variable : null, dimension_value: isDim ? opts.dimensionValue ?? null : null,
      ad_ids: ev.variants.map((v) => v.ad_id).filter((x): x is string => Boolean(x)),
      status: ev.verdict === 'validated' ? 'confirmed' : ev.verdict === 'refuted' ? 'rejected' : 'candidate',
      linked_at: now,
    }).select('id').single();
    learningId = learning?.id ?? null;
  }

  await sb.from('experiment').update({
    status: 'closed', closed_at: now, evaluated_at: now, close_reason: opts.reason, learning_id: learningId,
    result: { verdict: ev.verdict, reason: ev.reason, spend: ev.spend, days_live: ev.days_live, best: ev.best, control: ev.control, variants: ev.variants, gates: ev.gates, closed_at: now },
    updated_at: now,
  }).eq('id', exp.id);
  await sb.from('experiment_variant').update({ status: 'evaluated', updated_at: now }).eq('experiment_id', exp.id).in('status', ['live', 'uploaded']);
  return { learningId };
}
