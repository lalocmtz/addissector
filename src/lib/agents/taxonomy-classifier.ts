// =============================================================================
// Taxonomy Classifier — agent #2 of six.
//
// Input : one creative's analysis (+ transcript) and the brand's EXISTING
//         taxonomy (personas, angles, concepts, hook bank) with ids.
// Output: assignment to persona / angle / concept (existing id or a proposal),
//         the hook (bank id or proposal) and every transversal dimension, each
//         with a confidence. STRUCTURED, via tool use: the model cannot return
//         a malformed object, and there is no prose to parse.
// Rule  : NO performance judgement here. It describes what the ad IS.
//
// Proposals (new persona/angle/concept/hook) are created with source
// 'classifier' and status 'propuesto'/'idea' — the human validates them in
// Strategy (Accept / Edit / Merge / Reject, Phase D).
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic, MODEL, cachedSystem } from '@/lib/ai';
import { analysisToClipboardText } from '@/lib/copy-context';
import { DIMENSIONS, DIMENSION_VALUES, durationBucket, CLASSIFIER_VERSION, type Dimension } from '@/lib/agents/taxonomy';

// ---------------------------------------------------------------------------
// Tool schema — the contract
// ---------------------------------------------------------------------------
const pick = (allowed: readonly string[]) => ({ type: 'string', enum: [...allowed] });
const conf = { type: 'number', minimum: 0, maximum: 1 };

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: 'classify_ad',
  description: 'Record the taxonomy assignment and dimensions of ONE ad. Prefer existing ids; propose a new entity only when nothing fits.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['persona', 'angle', 'concept', 'hook', 'dimensions', 'notes'],
    properties: {
      persona: {
        type: 'object', additionalProperties: false, required: ['id', 'proposal', 'confidence'],
        properties: {
          id: { type: ['string', 'null'], description: 'Existing persona id, or null' },
          proposal: { type: ['object', 'null'], additionalProperties: false, required: ['name', 'description', 'pains', 'desires', 'objections'],
            properties: { name: { type: 'string' }, description: { type: 'string' }, pains: { type: 'string' }, desires: { type: 'string' }, objections: { type: 'string' } } },
          confidence: conf,
        },
      },
      angle: {
        type: 'object', additionalProperties: false, required: ['id', 'proposal', 'confidence'],
        properties: {
          id: { type: ['string', 'null'] },
          proposal: { type: ['object', 'null'], additionalProperties: false, required: ['code', 'name', 'pain', 'desire', 'mechanism', 'objection', 'psychology'],
            properties: {
              code: { type: 'string', description: 'UPPERCASE, max 12 chars, no spaces' },
              name: { type: 'string' },
              pain: { type: 'string', description: 'The pain the angle speaks to' },
              desire: { type: 'string' },
              mechanism: { type: 'string', description: 'Why the PRODUCT resolves the pain (ingredient, feature, process). Not psychology.' },
              objection: { type: 'string', description: 'The objection it neutralizes' },
              psychology: { type: 'string', description: 'Why it converts psychologically' },
            } },
          confidence: conf,
        },
      },
      concept: {
        type: 'object', additionalProperties: false, required: ['id', 'proposal', 'confidence'],
        properties: {
          id: { type: ['string', 'null'] },
          proposal: { type: ['object', 'null'], additionalProperties: false, required: ['name', 'narrative_format', 'one_line'],
            properties: {
              name: { type: 'string', description: 'A reproducible creative idea: three different editors would make something recognizably the same' },
              narrative_format: { type: 'string' },
              one_line: { type: 'string' },
            } },
          confidence: conf,
        },
      },
      hook: {
        type: 'object', additionalProperties: false, required: ['id', 'proposal', 'confidence'],
        properties: {
          id: { type: ['string', 'null'], description: 'Existing hook id from the bank, or null' },
          proposal: { type: ['object', 'null'], additionalProperties: false, required: ['title', 'body', 'hook_type'],
            properties: {
              title: { type: 'string', description: 'The hook in one line, as it could be reused' },
              body: { type: 'string', description: 'What is seen and said in the first 3 seconds' },
              hook_type: pick(['visual', 'text_overlay', 'spoken', 'pattern_interrupt', 'question', 'claim', 'social_proof', 'other']),
            } },
          confidence: conf,
        },
      },
      dimensions: {
        type: 'object', additionalProperties: false,
        required: ['format', 'narrative_structure', 'creator', 'proof_type', 'offer', 'cta', 'visual_style', 'pacing', 'awareness_level', 'emotional_driver'],
        properties: Object.fromEntries(
          (Object.keys(DIMENSION_VALUES) as Array<Exclude<Dimension, 'hook'>>)
            .filter((d) => d !== 'duration_bucket')
            .map((d) => [d, { type: 'object', additionalProperties: false, required: ['value', 'confidence'], properties: { value: pick(DIMENSION_VALUES[d]), confidence: conf } }]),
        ),
      },
      notes: { type: 'string', description: 'One line: what made the classification hard, if anything' },
    },
  },
};

const SYSTEM = `You are the Taxonomy Classifier of a creative-strategy platform for Meta Ads.
You receive the analysis of ONE ad and the brand's existing taxonomy. You describe what the ad IS along a fixed taxonomy — you never judge whether it performed.

The backbone (hierarchical):
  Persona  — who we talk to.
  Angle    — the reason to buy: pain/desire + PRODUCT mechanism (why the product solves it) + objection it neutralizes. If you cannot write the three, it is not an angle.
  Concept  — a reproducible creative idea expressing the angle. Test: would three different editors make something recognizably the same?
Dimensions (transversal attributes, NOT levels): hook, format, narrative_structure, creator, proof_type, offer, cta, visual_style, pacing, awareness_level, emotional_driver.

Rules:
- Prefer EXISTING ids. Propose a new persona/angle/concept only when nothing existing fits; a proposal must be specific to this brand and product, never generic.
- Do not create an angle for a variation of wording: if the pain, mechanism and objection match an existing angle, it is that angle.
- The hook is the first 3 seconds. Match the bank by meaning, not by wording. Propose only if truly new.
- Confidence is calibrated: 0.9+ only when the evidence is explicit in the analysis.
- Always call the classify_ad tool exactly once. No prose.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TaxonomyContext {
  personas: Array<{ id: string; name: string; description: string | null; pains: string | null }>;
  angles: Array<{ id: string; code: string | null; name: string; pain: string | null; mechanism: string | null; objection: string | null; persona_id: string | null }>;
  concepts: Array<{ id: string; code: string | null; name: string; angle_id: string | null; narrative_format: string | null }>;
  hooks: Array<{ id: string; title: string; hook_type: string | null }>;
}

export interface CreativeForClassification {
  id: string;
  brand_id: string;
  user_id: string;
  name: string | null;
  ad_name: string | null;
  meta_ad_id: string | null;
  type: string | null;
  duration: number | null;
  transcript: string | null;
  analysis: Record<string, unknown>;
}

type ClassifyOutput = {
  persona: { id: string | null; proposal: { name: string; description: string; pains: string; desires: string; objections: string } | null; confidence: number };
  angle: { id: string | null; proposal: { code: string; name: string; pain: string; desire: string; mechanism: string; objection: string; psychology: string } | null; confidence: number };
  concept: { id: string | null; proposal: { name: string; narrative_format: string; one_line: string } | null; confidence: number };
  hook: { id: string | null; proposal: { title: string; body: string; hook_type: string } | null; confidence: number };
  dimensions: Record<string, { value: string; confidence: number }>;
  notes: string;
};

export interface ClassifyResult {
  creativeId: string;
  adId: string | null;
  persona_id: string | null;
  angle_id: string | null;
  concept_id: string | null;
  hook_id: string | null;
  created: { persona?: string; angle?: string; concept?: string; hook?: string };
  dimensions: number;
  confidence: number;
  notes: string;
  usage: { input: number; output: number; cacheRead: number };
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------
export async function loadTaxonomy(sb: SupabaseClient, userId: string, brandId: string): Promise<TaxonomyContext> {
  const own = { brand_id: brandId, user_id: userId };
  const [p, a, c, h] = await Promise.all([
    sb.from('personas').select('id,name,description,pains').match(own).order('created_at'),
    sb.from('angles').select('id,code,name,pain,mechanism,objection,persona_id').match(own).order('created_at'),
    sb.from('concepts').select('id,code,name,angle_id,narrative_format').match(own).order('number'),
    sb.from('hook').select('id,title,hook_type').match(own).order('created_at'),
  ]);
  return { personas: p.data ?? [], angles: a.data ?? [], concepts: c.data ?? [], hooks: h.data ?? [] };
}

function taxonomyBlock(t: TaxonomyContext): string {
  const lines: string[] = ['# EXISTING TAXONOMY OF THIS BRAND (use these ids)'];
  lines.push('## Personas');
  lines.push(...(t.personas.length ? t.personas.map((p) => `- id=${p.id} · ${p.name}${p.description ? ` — ${String(p.description).slice(0, 160)}` : ''}${p.pains ? ` · pains: ${String(p.pains).slice(0, 140)}` : ''}`) : ['- (none yet)']));
  lines.push('## Angles');
  lines.push(...(t.angles.length ? t.angles.map((a) => `- id=${a.id} · ${a.code ?? ''} ${a.name} — pain: ${String(a.pain ?? '').slice(0, 120)} · mechanism: ${String(a.mechanism ?? '—').slice(0, 100)} · objection: ${String(a.objection ?? '').slice(0, 100)} · persona=${a.persona_id ?? 'null'}`) : ['- (none yet)']));
  lines.push('## Concepts');
  lines.push(...(t.concepts.length ? t.concepts.map((c) => `- id=${c.id} · ${c.code ?? ''} ${c.name} · angle=${c.angle_id ?? 'null'} · format=${c.narrative_format ?? '—'}`) : ['- (none yet)']));
  lines.push('## Hook bank');
  lines.push(...(t.hooks.length ? t.hooks.map((h) => `- id=${h.id} · ${h.title}${h.hook_type ? ` [${h.hook_type}]` : ''}`) : ['- (none yet)']));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Classify one creative
// ---------------------------------------------------------------------------
export async function classifyCreative(
  sb: SupabaseClient,
  creative: CreativeForClassification,
  taxonomy: TaxonomyContext,
  brand: { name: string; product: string | null },
): Promise<ClassifyResult> {
  const isImage = (creative.type ?? '').toLowerCase() === 'image';
  const compact = analysisToClipboardText(creative.analysis, creative.ad_name ?? creative.name ?? undefined).slice(0, 14000);
  const user = [
    `# BRAND: ${brand.name}${brand.product ? ` — ${brand.product}` : ''}`,
    `# AD: ${creative.ad_name ?? creative.name ?? creative.id} · type ${creative.type ?? 'video'}${creative.duration ? ` · ${Math.round(creative.duration)}s` : ''}`,
    creative.transcript ? `\n# TRANSCRIPT\n${creative.transcript.slice(0, 4000)}` : '',
    `\n# ANALYSIS\n${compact}`,
  ].join('\n');

  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: [...cachedSystem(SYSTEM), { type: 'text', text: taxonomyBlock(taxonomy), cache_control: { type: 'ephemeral' } }],
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'tool', name: 'classify_ad' },
    messages: [{ role: 'user', content: user }],
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'classify_ad');
  if (!block) throw new Error('classifier returned no tool call');
  const out = block.input as ClassifyOutput;
  const usage = {
    input: res.usage.input_tokens,
    output: res.usage.output_tokens,
    cacheRead: (res.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0,
  };

  const own = { user_id: creative.user_id, brand_id: creative.brand_id };
  const created: ClassifyResult['created'] = {};
  const validId = (id: string | null, pool: Array<{ id: string }>) => (id && pool.some((x) => x.id === id) ? id : null);

  // Persona
  let personaId = validId(out.persona.id, taxonomy.personas);
  if (!personaId && out.persona.proposal && out.persona.confidence >= 0.5) {
    const p = out.persona.proposal;
    const { data } = await sb.from('personas').insert({ ...own, name: p.name.slice(0, 160), description: p.description, pains: p.pains, desires: p.desires, objections: p.objections, status: 'propuesta', source: 'classifier' }).select('id').single();
    if (data) { personaId = data.id; created.persona = data.id; taxonomy.personas.push({ id: data.id, name: p.name, description: p.description, pains: p.pains }); }
  }
  // Angle
  let angleId = validId(out.angle.id, taxonomy.angles);
  if (!angleId && out.angle.proposal && out.angle.confidence >= 0.5) {
    const a = out.angle.proposal;
    let code = a.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'ANGLE';
    if (taxonomy.angles.some((x) => x.code === code)) code = `${code.slice(0, 9)}${Math.floor(Math.random() * 900 + 100)}`;
    const { data } = await sb.from('angles').insert({ ...own, code, name: a.name.slice(0, 200), persona_id: personaId, pain: a.pain, desire: a.desire, mechanism: a.mechanism, objection: a.objection, psychology: a.psychology, status: 'sin_probar', source: 'classifier' }).select('id').single();
    if (data) { angleId = data.id; created.angle = data.id; taxonomy.angles.push({ id: data.id, code, name: a.name, pain: a.pain, mechanism: a.mechanism, objection: a.objection, persona_id: personaId }); }
  }
  // Concept
  let conceptId = validId(out.concept.id, taxonomy.concepts);
  if (!conceptId && out.concept.proposal && out.concept.confidence >= 0.5) {
    const c = out.concept.proposal;
    const { data: last } = await sb.from('concepts').select('number').eq('brand_id', creative.brand_id).order('number', { ascending: false }).limit(1).maybeSingle();
    const number = ((last?.number as number | undefined) ?? 0) + 1;
    const { data } = await sb.from('concepts').insert({ ...own, number, code: `C${String(number).padStart(3, '0')}`, name: c.name.slice(0, 200), angle_id: angleId, persona_id: personaId, narrative_format: c.narrative_format, hypothesis: c.one_line, status: 'evaluado', origin: 'classifier', origin_ad_id: creative.meta_ad_id }).select('id').single();
    if (data) { conceptId = data.id; created.concept = data.id; taxonomy.concepts.push({ id: data.id, code: `C${String(number).padStart(3, '0')}`, name: c.name, angle_id: angleId, narrative_format: c.narrative_format }); }
  }
  // Hook
  let hookId = validId(out.hook.id, taxonomy.hooks);
  if (!hookId && out.hook.proposal && out.hook.confidence >= 0.5) {
    const h = out.hook.proposal;
    const { data } = await sb.from('hook').insert({ ...own, title: h.title.slice(0, 400), body: h.body, hook_type: h.hook_type, status: 'idea', source: 'classifier', ad_ids: creative.meta_ad_id ? [creative.meta_ad_id] : [] }).select('id').single();
    if (data) { hookId = data.id; created.hook = data.id; taxonomy.hooks.push({ id: data.id, title: h.title, hook_type: h.hook_type }); }
  } else if (hookId && creative.meta_ad_id) {
    const { data: hk } = await sb.from('hook').select('ad_ids').eq('id', hookId).single();
    const ids = new Set<string>((hk?.ad_ids as string[] | null) ?? []);
    if (!ids.has(creative.meta_ad_id)) { ids.add(creative.meta_ad_id); await sb.from('hook').update({ ad_ids: [...ids], updated_at: new Date().toISOString() }).eq('id', hookId); }
  }

  // Dimensions — one row per axis. Keyed by ad_id when pinned, else by creative.
  const rows: Array<Record<string, unknown>> = [];
  const keyCols = creative.meta_ad_id ? { ad_id: creative.meta_ad_id, creative_id: creative.id } : { ad_id: null, creative_id: creative.id };
  const now = new Date().toISOString();
  for (const d of DIMENSIONS) {
    if (d === 'hook') {
      const title = out.hook.proposal?.title ?? taxonomy.hooks.find((h) => h.id === hookId)?.title;
      if (title) rows.push({ ...own, ...keyCols, dimension: 'hook', value: title.slice(0, 200), confidence: out.hook.confidence, hook_id: hookId, source: 'classifier', version: CLASSIFIER_VERSION, updated_at: now });
      continue;
    }
    if (d === 'duration_bucket') {
      rows.push({ ...own, ...keyCols, dimension: d, value: durationBucket(creative.duration, isImage), confidence: 1, source: 'classifier', version: CLASSIFIER_VERSION, updated_at: now });
      continue;
    }
    const v = out.dimensions[d];
    if (v?.value) rows.push({ ...own, ...keyCols, dimension: d, value: v.value, confidence: v.confidence, source: 'classifier', version: CLASSIFIER_VERSION, updated_at: now });
  }
  if (rows.length) {
    const onConflict = creative.meta_ad_id ? 'brand_id,ad_id,dimension' : 'brand_id,creative_id,dimension';
    // Partial unique indexes: upsert per index. Replace-by-delete keeps it simple and correct.
    const q = sb.from('ad_dimension').delete().eq('brand_id', creative.brand_id);
    await (creative.meta_ad_id ? q.eq('ad_id', creative.meta_ad_id) : q.eq('creative_id', creative.id).is('ad_id', null));
    const { error } = await sb.from('ad_dimension').insert(rows);
    if (error) throw new Error(`ad_dimension (${onConflict}): ${error.message}`);
  }

  // Backbone assignment on the ad
  const confidence = Math.min(out.persona.confidence, out.angle.confidence, out.concept.confidence);
  if (creative.meta_ad_id) {
    await sb.from('meta_ads').update({
      persona_id: personaId, angle_id: angleId, concept_id: conceptId,
      taxonomy_confidence: confidence, taxonomy_source: 'classifier', taxonomy_version: CLASSIFIER_VERSION,
      classified_at: now, updated_at: now,
    }).eq('brand_id', creative.brand_id).eq('ad_id', creative.meta_ad_id);
  }

  return { creativeId: creative.id, adId: creative.meta_ad_id, persona_id: personaId, angle_id: angleId, concept_id: conceptId, hook_id: hookId, created, dimensions: rows.length, confidence, notes: out.notes, usage };
}
