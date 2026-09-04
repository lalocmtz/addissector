// =============================================================================
// Hypothesis Writer — drafts the guided template a strategist fills in before
// producing anything: who it is for, why this angle, what will actually change
// between variants, and what stays pinned.
//
// It writes a DRAFT, never the truth. Every field lands in an editable form;
// the strategist overwrites what it got wrong. The point is to never face a
// blank box, and to force the questions that make an experiment attributable.
//
// Grounded on the brand, the persona/angle/concept and the learnings already
// linked to them. It does not invent numbers: the criteria come from the
// experiment itself.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic, MODEL, cachedSystem } from '@/lib/ai';
import { resolveEconomics } from '@/lib/meta';
import { resolveCriteria, type ExperimentRow } from '@/lib/experiments';

export interface HypothesisDoc {
  /** "We believe <persona> responds to <change> because <reason>." */
  statement: string;
  /** Who it is aimed at, in the brand's own words. */
  audience: string;
  /** The avatar: the concrete person behind the persona. */
  avatar: string;
  /** Why this angle is the one worth spending on now. */
  angle_rationale: string;
  /** Why this concept is the right execution of that angle. */
  concept_rationale: string;
  /** The variants to produce — one line each, all differing in the SAME variable. */
  variants_to_make: string[];
  /** What must NOT move between variants, so the result is attributable. */
  held_constant: string[];
  /** What would make this hypothesis wrong. Written before the data arrives. */
  kill_signal: string;
  /** What the draft could not answer and the strategist must decide. */
  open_questions: string[];
  generated_at: string;
  model: string;
}

const TOOL: Anthropic.Tool = {
  name: 'draft_hypothesis',
  description: 'Draft the guided hypothesis template for one experiment.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['statement', 'audience', 'avatar', 'angle_rationale', 'concept_rationale', 'variants_to_make', 'held_constant', 'kill_signal', 'open_questions'],
    properties: {
      statement: { type: 'string', description: 'One sentence: "We believe <persona> responds to <change> because <reason>." Falsifiable, not a wish.' },
      audience: { type: 'string', description: 'Who this is aimed at. One or two sentences.' },
      avatar: { type: 'string', description: 'The concrete person: age, moment, what they are doing when the ad appears, what stops them.' },
      angle_rationale: { type: 'string', description: 'Why this angle deserves spend now. Cite the evidence given, or say plainly there is none.' },
      concept_rationale: { type: 'string', description: 'Why this concept is the right execution of that angle.' },
      variants_to_make: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6, description: 'One line per variant to produce. All differ in the SAME declared variable and in nothing else.' },
      held_constant: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8, description: 'What stays identical across variants: offer, CTA, landing, duration, format… whatever is not the variable.' },
      kill_signal: { type: 'string', description: 'What would prove this wrong. Concrete and observable.' },
      open_questions: { type: 'array', items: { type: 'string' }, maxItems: 5, description: 'What the draft cannot answer and the strategist has to decide. Empty array if none.' },
    },
  },
};

const SYSTEM = `You draft hypothesis templates for a DTC performance-creative team.

Rules:
- You write a DRAFT a human will edit. Be specific enough to argue with; a vague draft is useless.
- ONE variable changes across variants. If the experiment declares "hook", then offer, format, CTA and landing are held constant. Never propose variants that move two things.
- Ground every claim in the context you were given. If there is no evidence for the angle, say so in angle_rationale instead of inventing a study or a number.
- Never invent metrics, ad names or results. The numbers you may cite are the ones in the context.
- Write in the same language as the brand context. Keep it plain and operational, no marketing filler.
- kill_signal must be something that could actually be observed and would change the team's mind.`;

export async function draftHypothesis(
  sb: SupabaseClient,
  exp: ExperimentRow & { hypothesis: string | null; product_id?: string | null },
): Promise<HypothesisDoc> {
  const [brandRes, accountRes, personaRes, angleRes, conceptRes, productRes, learningsRes] = await Promise.all([
    sb.from('brands').select('name,product,tone,dna,economics').eq('id', exp.brand_id).single(),
    sb.from('ad_account').select('currency').eq('brand_id', exp.brand_id).eq('active', true).limit(1).maybeSingle(),
    exp.persona_id ? sb.from('personas').select('name,description,pains,desires').eq('id', exp.persona_id).maybeSingle() : Promise.resolve({ data: null }),
    exp.angle_id ? sb.from('angles').select('code,name,pain,psychology,mechanism,desire,objection').eq('id', exp.angle_id).maybeSingle() : Promise.resolve({ data: null }),
    exp.concept_id ? sb.from('concepts').select('code,name,narrative_format,hypothesis,offer,do_not_change').eq('id', exp.concept_id).maybeSingle() : Promise.resolve({ data: null }),
    exp.product_id ? sb.from('product').select('name,description,price').eq('id', exp.product_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('learnings').select('text,status').eq('brand_id', exp.brand_id).eq('active', true).neq('status', 'rejected')
      .or([exp.persona_id ? `persona_id.eq.${exp.persona_id}` : null, exp.angle_id ? `angle_id.eq.${exp.angle_id}` : null, `dimension.eq.${exp.variable}`].filter(Boolean).join(','))
      .limit(20),
  ]);

  const brand = brandRes.data;
  const currency = accountRes.data?.currency ?? null;
  const criteria = resolveCriteria(exp.success_criteria, resolveEconomics(brand?.economics));
  const learnings = (learningsRes.data ?? []) as Array<{ text: string; status: string }>;

  const ctx = [
    `# BRAND: ${brand?.name ?? ''}`,
    brand?.product ? `Product: ${brand.product}` : null,
    brand?.tone ? `Tone: ${brand.tone}` : null,
    brand?.dna ? `DNA: ${JSON.stringify(brand.dna).slice(0, 2000)}` : null,
    productRes.data ? `Product under test: ${productRes.data.name}${productRes.data.price != null ? ` (${productRes.data.price} ${currency ?? ''})` : ''}${productRes.data.description ? ` — ${productRes.data.description}` : ''}` : null,
    '',
    `# EXPERIMENT ${exp.code} · ${exp.name}`,
    `THE ONE VARIABLE THAT CHANGES: ${exp.variable}`,
    exp.hypothesis ? `What the strategist already wrote: ${exp.hypothesis}` : 'The strategist has not written a hypothesis yet.',
    `Decision rule: it needs ${criteria.min_spend} ${currency ?? ''} of spend and ROAS ≥ ${criteria.roas_min} within ${criteria.window_days} days${criteria.beat_control_by ? `, beating the control by ${Math.round(criteria.beat_control_by * 100)}%` : ''}.`,
    '',
    personaRes.data ? `# PERSONA: ${personaRes.data.name}\n${personaRes.data.description ?? ''}\nPains: ${personaRes.data.pains ?? ''}\nDesires: ${personaRes.data.desires ?? ''}` : '# PERSONA: not chosen yet',
    angleRes.data ? `# ANGLE ${angleRes.data.code ?? ''}: ${angleRes.data.name}\nPain: ${angleRes.data.pain ?? ''}\nPsychology: ${angleRes.data.psychology ?? ''}\nMechanism: ${angleRes.data.mechanism ?? ''}\nDesire: ${angleRes.data.desire ?? ''}\nObjection: ${angleRes.data.objection ?? ''}` : '# ANGLE: not chosen yet',
    conceptRes.data ? `# CONCEPT ${conceptRes.data.code ?? ''}: ${conceptRes.data.name}\nFormat: ${conceptRes.data.narrative_format ?? ''}\nOffer: ${conceptRes.data.offer ?? ''}\nDo not change: ${conceptRes.data.do_not_change ?? ''}` : '# CONCEPT: not chosen yet',
    '',
    '# LEARNINGS ALREADY ON RECORD',
    ...(learnings.length ? learnings.map((l) => `- [${l.status}] ${l.text}`) : ['(none for this persona/angle/variable)']),
  ].filter((x) => x !== null).join('\n');

  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: cachedSystem(SYSTEM),
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: `${ctx}\n\nDraft the hypothesis template for this experiment.` }],
  });

  const block = res.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  if (!block) throw new Error('The model returned no draft');
  const d = block.input as Omit<HypothesisDoc, 'generated_at' | 'model'>;
  return { ...d, generated_at: new Date().toISOString(), model: MODEL };
}
