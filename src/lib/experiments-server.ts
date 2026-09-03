// =============================================================================
// Experiments — server-side loading and the auto-close pass.
//
// loadExperiments() returns every experiment of a brand with its variants,
// the live numbers of each variant (over the experiment's window) and the
// evaluation. Experiments that are live/evaluating and decidable are closed
// here, so any screen that lists experiments keeps the board honest.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow, type AdAggregate } from '@/lib/metrics';
import { resolveEconomics } from '@/lib/meta';
import { matchAndPin } from '@/lib/ad-matching';
import { evaluateExperiment, resolveCriteria, closeExperiment, type Evaluation, type ExperimentRow, type SuccessCriteria } from '@/lib/experiments';
import { fetchAll } from '@/lib/fetch-all';

export const EXPERIMENT_SELECT = 'id,user_id,brand_id,number,code,name,hypothesis,prior_evidence,variable,persona_id,angle_id,concept_id,control_ad_id,control_note,success_criteria,owner_id,status,result,learning_id,brief,planned_for,started_at,closed_at,close_reason,evaluated_at,idea_id,created_at,updated_at';
export const VARIANT_SELECT = 'id,experiment_id,concept_id,ad_name,variant,hook_id,hook,format,script,visual_notes,status,owner_id,meta_ad_id,matched_at,uploaded_at,claimed_from,result,created_at';

export interface VariantRow {
  id: string; experiment_id: string | null; concept_id: string | null; ad_name: string; variant: string | null;
  hook_id: string | null; hook: string | null; format: string | null; script: string | null; visual_notes: string | null;
  status: string; owner_id: string | null; meta_ad_id: string | null; matched_at: string | null; uploaded_at: string | null;
  claimed_from: string | null; result: unknown; created_at: string;
}

export interface ExperimentFull extends ExperimentRow {
  number: number; prior_evidence: unknown; control_note: string | null; owner_id: string | null; status: string; result: unknown;
  learning_id: string | null; brief: unknown; planned_for: string | null; closed_at: string | null; close_reason: string | null;
  evaluated_at: string | null; idea_id: string | null; created_at: string; updated_at: string;
  criteria: SuccessCriteria;
  variants: VariantRow[];
  evaluation: Evaluation | null;
  control_name: string | null;
}

export async function loadExperiments(sb: SupabaseClient, userId: string, brandId: string, opts: { autoClose?: boolean } = {}): Promise<{ experiments: ExperimentFull[]; currency: string | null; closed: string[] }> {
  const [brandRes, accountRes, expRes, varRes] = await Promise.all([
    sb.from('brands').select('economics').eq('id', brandId).eq('user_id', userId).single(),
    sb.from('ad_account').select('currency').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle(),
    sb.from('experiment').select(EXPERIMENT_SELECT).eq('brand_id', brandId).eq('user_id', userId).order('number', { ascending: false }),
    sb.from('experiment_variant').select(VARIANT_SELECT).eq('brand_id', brandId).eq('user_id', userId).not('experiment_id', 'is', null).order('variant'),
  ]);
  if (!brandRes.data) throw new Error('Brand not found');
  const eco = resolveEconomics(brandRes.data.economics);
  const experiments = (expRes.data ?? []) as unknown as Array<Omit<ExperimentFull, 'criteria' | 'variants' | 'evaluation' | 'control_name'>>;
  const variants = (varRes.data ?? []) as VariantRow[];

  // Variants not yet pinned: look for their name in Meta (exact → parsed). A hit pins the id for good.
  const unpinned = variants.filter((v) => !v.meta_ad_id);
  if (unpinned.length) {
    const metaAds = await fetchAll(() => sb.from('meta_ads').select('ad_id,name').eq('brand_id', brandId).not('ad_id', 'is', null).order('ad_id'));
    const matches = await matchAndPin(sb, unpinned, metaAds.map((m) => ({ ad_id: m.ad_id as string, ad_name: m.name })));
    const now = new Date().toISOString();
    for (const m of matches) {
      if (!m.adId) continue;
      const v = variants.find((x) => x.id === m.planned.id)!;
      v.meta_ad_id = m.adId; v.matched_at = now;
      if (['planned', 'producing', 'ready', 'uploaded'].includes(v.status)) { v.status = 'live'; await sb.from('experiment_variant').update({ status: 'live' }).eq('id', v.id); }
      const e = experiments.find((x) => x.id === v.experiment_id);
      if (e && ['draft', 'planned', 'producing'].includes(e.status)) {
        e.status = 'live'; e.started_at = e.started_at ?? now;
        await sb.from('experiment').update({ status: 'live', started_at: e.started_at, updated_at: now }).eq('id', e.id);
      }
    }
  }

  // Every ad we need numbers for: variants + controls. One query, sliced per experiment window.
  const adIds = new Set<string>();
  for (const v of variants) if (v.meta_ad_id) adIds.add(v.meta_ad_id);
  for (const e of experiments) if (e.control_ad_id) adIds.add(e.control_ad_id);
  let daily: AdDailyRow[] = [];
  if (adIds.size) {
    daily = (await fetchAll(() => sb.from('ad_daily').select(AD_DAILY_COLUMNS).eq('brand_id', brandId).in('ad_id', [...adIds]).order('date').order('ad_id'))) as unknown as AdDailyRow[];
  }
  const names = new Map<string, string>();
  if (adIds.size) {
    const { data } = await sb.from('meta_ads').select('ad_id,name').eq('brand_id', brandId).in('ad_id', [...adIds]);
    for (const m of data ?? []) if (m.ad_id) names.set(m.ad_id, m.name);
  }

  const closed: string[] = [];
  const out: ExperimentFull[] = [];
  for (const e of experiments) {
    const criteria = resolveCriteria(e.success_criteria, eco);
    const vs = variants.filter((v) => v.experiment_id === e.id);
    // Window: from started_at (or first variant match) forward; control over the same window so the comparison is fair.
    const start = e.started_at?.slice(0, 10) ?? vs.map((v) => v.matched_at?.slice(0, 10)).filter(Boolean).sort()[0] ?? null;
    const rows = start ? daily.filter((r) => r.date >= start) : daily;
    const byAdId = new Map<string, AdAggregate>(aggregateByAd(rows).map((a) => [a.ad_id, a]));
    const controlName = e.control_ad_id ? names.get(e.control_ad_id) ?? null : null;
    const evaluation = ['live', 'evaluating', 'closed'].includes(e.status) || vs.some((v) => v.meta_ad_id)
      ? evaluateExperiment({ criteria, variants: vs, byAdId, controlAdId: e.control_ad_id, controlName, startedAt: e.started_at ?? (start ? `${start}T00:00:00Z` : null) })
      : null;

    let status = e.status;
    let result = e.result, learning_id = e.learning_id, close_reason = e.close_reason, closed_at = e.closed_at;
    if (opts.autoClose && evaluation?.decidable && ['live', 'evaluating'].includes(e.status)) {
      // The learning names what the best variant did: its hook (bank or free text) or its dimension value.
      const bestVariant = vs.find((v) => v.id === evaluation.best?.variant_id) ?? vs.find((v) => v.hook_id || v.hook);
      const { learningId } = await closeExperiment(sb, e, evaluation, {
        reason: evaluation.reason === 'criteria_met' ? 'criteria_met' : 'criteria_failed',
        hookId: bestVariant?.hook_id ?? null,
        hookTitle: bestVariant?.hook ?? null,
        dimensionValue: bestVariant?.format ?? null,
      });
      status = 'closed'; learning_id = learningId; close_reason = evaluation.reason; closed_at = new Date().toISOString();
      result = { verdict: evaluation.verdict, reason: evaluation.reason, spend: evaluation.spend, best: evaluation.best, control: evaluation.control, gates: evaluation.gates };
      closed.push(e.id);
    }
    out.push({ ...e, status, result, learning_id, close_reason, closed_at, criteria, variants: vs, evaluation, control_name: controlName });
  }
  return { experiments: out, currency: accountRes.data?.currency ?? null, closed };
}
