// =============================================================================
// Brief Writer — turns an experiment into a production brief the editor can
// shoot from, without a meeting. Structured output by tool use.
//
// The brief is grounded: it only cites ads, learnings and numbers that were
// handed to it. What it invents is the creative execution (scripts, shots),
// which is its job. One variable changes; everything else is pinned to the
// control so the result is attributable.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic, MODEL, cachedSystem } from '@/lib/ai';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow } from '@/lib/metrics';
import { resolveEconomics } from '@/lib/meta';
import { resolveCriteria, type ExperimentRow, type SuccessCriteria } from '@/lib/experiments';

export interface Brief {
  objective: string;
  hypothesis: string;
  variable_under_test: string;
  what_changes: string;
  what_stays: string[];
  audience: string;
  control_summary: string | null;
  evidence: string[];
  variants: Array<{ variant: string; title: string; hook: string; script_outline: string[]; visual_notes: string; duration_seconds: number | null }>;
  production_notes: string[];
  success_criteria_text: string;
  risks: string[];
  generated_at: string;
  model: string;
}

const BRIEF_TOOL: Anthropic.Tool = {
  name: 'write_brief',
  description: 'Write the production brief for one experiment.',
  input_schema: {
    type: 'object', additionalProperties: false,
    required: ['objective', 'hypothesis', 'variable_under_test', 'what_changes', 'what_stays', 'audience', 'control_summary', 'evidence', 'variants', 'production_notes', 'success_criteria_text', 'risks'],
    properties: {
      objective: { type: 'string', description: 'One sentence: what we will know after this experiment.' },
      hypothesis: { type: 'string', description: '"We believe [persona] responds to [change] because [reason]".' },
      variable_under_test: { type: 'string' },
      what_changes: { type: 'string', description: 'The single thing that differs between control and variants.' },
      what_stays: { type: 'array', items: { type: 'string' }, description: 'Everything pinned to the control: offer, CTA, format, length, creator, visual style…' },
      audience: { type: 'string' },
      control_summary: { type: ['string', 'null'], description: 'What the control ad does and its numbers; null when there is no control.' },
      evidence: { type: 'array', items: { type: 'string' }, description: 'Prior ads and learnings that justify the test. Only cite what you were given.' },
      variants: {
        type: 'array', minItems: 1, maxItems: 4,
        items: {
          type: 'object', additionalProperties: false,
          required: ['variant', 'title', 'hook', 'script_outline', 'visual_notes', 'duration_seconds'],
          properties: {
            variant: { type: 'string', description: 'A, B, C…' },
            title: { type: 'string' },
            hook: { type: 'string', description: 'The first 3 seconds, verbatim: what is said and what is on screen.' },
            script_outline: { type: 'array', items: { type: 'string' }, description: 'Beat by beat, 4–8 beats, with timing.' },
            visual_notes: { type: 'string' },
            duration_seconds: { type: ['number', 'null'] },
          },
        },
      },
      production_notes: { type: 'array', items: { type: 'string' } },
      success_criteria_text: { type: 'string', description: 'The criteria in plain words, with the numbers.' },
      risks: { type: 'array', items: { type: 'string' }, description: 'What could make the result unattributable.' },
    },
  },
};

const SYSTEM = `You are a senior creative strategist writing a production brief for a Meta Ads experiment.
The experiment changes exactly ONE variable against a control. Your brief must keep every other dimension pinned so the result is attributable.
Rules:
- Ground every claim in the material you are given (control ad, prior evidence, learnings, brand DNA). Never invent metrics or cite ads you were not given.
- Write for an editor who was not in the room: concrete hooks (words on screen + spoken line), beats with timing, shots.
- Variants differ from the control ONLY on the variable under test; each variant is a distinct value of that variable.
- Be specific and short. No filler, no marketing adjectives.
- Write in English.
Call write_brief exactly once.`;

const money = (n: number | null | undefined, c: string | null) => (n == null ? '—' : `${n.toFixed(0)} ${c ?? ''}`.trim());
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);
const ratio = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(2)}x`);

export async function writeBrief(sb: SupabaseClient, exp: ExperimentRow & { prior_evidence: unknown; control_note: string | null; brief: unknown }): Promise<Brief> {
  const [brandRes, accountRes, personaRes, angleRes, conceptRes, variantsRes, hooksRes, learningsRes, dailyRes, controlMetaRes] = await Promise.all([
    sb.from('brands').select('name,product,tone,dna,economics').eq('id', exp.brand_id).single(),
    sb.from('ad_account').select('currency').eq('brand_id', exp.brand_id).eq('active', true).limit(1).maybeSingle(),
    exp.persona_id ? sb.from('personas').select('name,description,pains,desires').eq('id', exp.persona_id).maybeSingle() : Promise.resolve({ data: null }),
    exp.angle_id ? sb.from('angles').select('code,name,pain,psychology,mechanism,desire,objection').eq('id', exp.angle_id).maybeSingle() : Promise.resolve({ data: null }),
    exp.concept_id ? sb.from('concepts').select('code,name,narrative_format,hypothesis,offer,do_not_change').eq('id', exp.concept_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('experiment_variant').select('variant,ad_name,hook,format,script,visual_notes,hook_id').eq('experiment_id', exp.id).order('variant'),
    sb.from('hook').select('id,title,body,hook_type,status').eq('brand_id', exp.brand_id).in('status', ['validated', 'testing']).limit(30),
    sb.from('learnings').select('text,evidence,status,suspect').eq('brand_id', exp.brand_id).eq('active', true).neq('status', 'rejected').or('suspect.is.null,suspect.eq.false')
      .or([exp.persona_id ? `persona_id.eq.${exp.persona_id}` : null, exp.angle_id ? `angle_id.eq.${exp.angle_id}` : null, exp.concept_id ? `concept_id.eq.${exp.concept_id}` : null, `dimension.eq.${exp.variable}`].filter(Boolean).join(','))
      .limit(30),
    exp.control_ad_id ? sb.from('ad_daily').select(AD_DAILY_COLUMNS).eq('brand_id', exp.brand_id).eq('ad_id', exp.control_ad_id).limit(2000) : Promise.resolve({ data: [] }),
    exp.control_ad_id ? sb.from('meta_ads').select('name,dossier_video,dossier_meta,fusion,duration,asset_kind').eq('brand_id', exp.brand_id).eq('ad_id', exp.control_ad_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const brand = brandRes.data;
  const currency = accountRes.data?.currency ?? null;
  const eco = resolveEconomics(brand?.economics);
  const criteria: SuccessCriteria = resolveCriteria(exp.success_criteria, eco);
  const control = exp.control_ad_id ? aggregateByAd(((dailyRes.data ?? []) as unknown) as AdDailyRow[])[0] : undefined;
  const cm = controlMetaRes.data;

  const ctx = [
    `# BRAND: ${brand?.name ?? ''}`,
    brand?.product ? `Product: ${brand.product}` : null,
    brand?.tone ? `Tone: ${brand.tone}` : null,
    brand?.dna ? `DNA: ${JSON.stringify(brand.dna).slice(0, 2500)}` : null,
    '',
    `# EXPERIMENT ${exp.code} · ${exp.name}`,
    `Variable under test: ${exp.variable}`,
    exp.hypothesis ? `Hypothesis: ${exp.hypothesis}` : null,
    exp.control_note ? `Control note: ${exp.control_note}` : null,
    `Success criteria: min spend ${money(criteria.min_spend, currency)}, ROAS ≥ ${criteria.roas_min}${criteria.hook_rate_min != null ? `, hook ≥ ${criteria.hook_rate_min}%` : ''}${criteria.hold_rate_min != null ? `, hold ≥ ${criteria.hold_rate_min}%` : ''}${criteria.cpa_max != null ? `, CPA ≤ ${money(criteria.cpa_max, currency)}` : ''}, beat control by ${Math.round(criteria.beat_control_by * 100)}%, window ${criteria.window_days} days. Brand breakeven ROAS ${eco.breakeven}, target ${eco.target}.`,
    '',
    personaRes.data ? `# PERSONA: ${personaRes.data.name}\n${personaRes.data.description ?? ''}\nPains: ${personaRes.data.pains ?? ''}\nDesires: ${personaRes.data.desires ?? ''}` : null,
    angleRes.data ? `# ANGLE ${angleRes.data.code ?? ''}: ${angleRes.data.name}\nPain: ${angleRes.data.pain ?? ''}\nPsychology: ${angleRes.data.psychology ?? ''}\nMechanism: ${angleRes.data.mechanism ?? ''}\nDesire: ${angleRes.data.desire ?? ''}\nObjection: ${angleRes.data.objection ?? ''}` : null,
    conceptRes.data ? `# CONCEPT ${conceptRes.data.code ?? ''}: ${conceptRes.data.name}\nFormat: ${conceptRes.data.narrative_format ?? ''}\nHypothesis: ${conceptRes.data.hypothesis ?? ''}\nOffer: ${conceptRes.data.offer ?? ''}\nDo not change: ${conceptRes.data.do_not_change ?? ''}` : null,
    '',
    control ? `# CONTROL AD: ${cm?.name ?? control.ad_name} (ad_id ${control.ad_id})\nLifetime: spend ${money(control.spend, currency)}, ROAS ${ratio(control.roas)}, hook ${pct(control.hook_rate)}, hold ${pct(control.hold_rate)}, ret75 ${pct(control.ret75)}, purchases ${control.purchases ?? 0}, days ${control.days}${cm?.duration ? `, duration ${cm.duration}s` : ''}${cm?.asset_kind ? `, ${cm.asset_kind}` : ''}` : '# CONTROL AD: none',
    cm?.fusion ? `Control analysis (fusion):\n${String(cm.fusion).slice(0, 4000)}` : cm?.dossier_video ? `Control dossier:\n${String(cm.dossier_video).slice(0, 4000)}` : null,
    '',
    '# PRIOR EVIDENCE',
    ...((Array.isArray(exp.prior_evidence) ? exp.prior_evidence : []) as Array<Record<string, unknown>>).map((e) => `- ${e.ad_name ?? e.ad_id ?? ''}: spend ${e.spend ?? '—'}, ROAS ${e.roas ?? '—'}, hook ${e.hook_rate ?? '—'}${e.note ? ` — ${e.note}` : ''}`),
    '',
    '# LEARNINGS (linked to this persona/angle/concept/variable)',
    ...(learningsRes.data ?? []).map((l) => `- [${l.status}${l.suspect ? ', suspect' : ''}] ${l.text}`),
    '',
    '# HOOK BANK (validated / testing)',
    ...(hooksRes.data ?? []).map((h) => `- [${h.status}${h.hook_type ? `, ${h.hook_type}` : ''}] ${h.title}${h.body ? ` — ${String(h.body).slice(0, 160)}` : ''}`),
    '',
    variantsRes.data?.length ? `# VARIANTS ALREADY PLANNED (keep their letters and names)\n${variantsRes.data.map((v) => `- ${v.variant ?? '?'} ${v.ad_name}${v.hook ? ` · hook: ${v.hook}` : ''}${v.format ? ` · ${v.format}` : ''}`).join('\n')}` : '# VARIANTS: none planned yet — propose 2 to 3.',
  ].filter((x) => x !== null).join('\n');

  const res = await anthropic().messages.create({
    model: MODEL, max_tokens: 6000,
    system: cachedSystem(SYSTEM),
    tools: [BRIEF_TOOL], tool_choice: { type: 'tool', name: 'write_brief' },
    messages: [{ role: 'user', content: ctx }],
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!block) throw new Error('brief writer returned no tool call');
  const input = block.input as Omit<Brief, 'generated_at' | 'model'>;
  return { ...input, generated_at: new Date().toISOString(), model: MODEL };
}
