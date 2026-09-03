// =============================================================================
// Learning Linker — attaches free-floating learnings to the entity they
// explain (persona / angle / concept / hook / a dimension value) so a learning
// is read where it belongs and can expire when its supporting ads degrade.
//
// Structured output via tool use. It never rewrites the learning; it links.
// A learning that explains nothing in the taxonomy stays unlinked (status
// 'candidate') rather than being forced onto the closest entity.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anthropic, MODEL, cachedSystem } from '@/lib/ai';
import { DIMENSION_VALUES, LINKER_VERSION, type Dimension } from '@/lib/agents/taxonomy';
import type { TaxonomyContext } from '@/lib/agents/taxonomy-classifier';

const LINK_TOOL: Anthropic.Tool = {
  name: 'link_learnings',
  description: 'Attach each learning to what it explains.',
  input_schema: {
    type: 'object', additionalProperties: false, required: ['links'],
    properties: {
      links: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['learning_id', 'target_type', 'target_id', 'dimension', 'dimension_value', 'confidence', 'reason'],
          properties: {
            learning_id: { type: 'string' },
            target_type: { type: 'string', enum: ['persona', 'angle', 'concept', 'hook', 'dimension', 'none'] },
            target_id: { type: ['string', 'null'], description: 'id of the persona/angle/concept/hook; null for dimension/none' },
            dimension: { type: ['string', 'null'], enum: [...Object.keys(DIMENSION_VALUES), 'hook', null] },
            dimension_value: { type: ['string', 'null'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string' },
          },
        },
      },
    },
  },
};

const SYSTEM = `You link creative learnings to the entity they explain in a brand's strategy taxonomy.
A learning is a declarative sentence about what works or does not work. It explains exactly one thing:
- a PERSONA (who responds), an ANGLE (the reason to buy), a CONCEPT (a specific creative idea), a HOOK (the first 3 seconds), or a DIMENSION value (format, narrative_structure, creator, proof_type, offer, cta, visual_style, pacing, awareness_level, emotional_driver).
Rules: pick the most specific target that the learning is actually about; if it is about a dimension, set target_type=dimension with the dimension and a value from the vocabulary; if it explains nothing in this taxonomy, target_type=none. Never invent ids. Call link_learnings exactly once with one entry per learning.`;

export interface LearningRow { id: string; text: string; evidence: string | null; source_ad: string | null; ad_ids: string[] }

export async function linkLearnings(
  sb: SupabaseClient, learnings: LearningRow[], taxonomy: TaxonomyContext,
): Promise<{ linked: number; none: number; usage: { input: number; output: number } }> {
  if (!learnings.length) return { linked: 0, none: 0, usage: { input: 0, output: 0 } };
  const tax = [
    '# TAXONOMY',
    '## Personas', ...taxonomy.personas.map((p) => `- id=${p.id} · ${p.name}`),
    '## Angles', ...taxonomy.angles.map((a) => `- id=${a.id} · ${a.code ?? ''} ${a.name} — pain: ${String(a.pain ?? '').slice(0, 100)}`),
    '## Concepts', ...taxonomy.concepts.map((c) => `- id=${c.id} · ${c.code ?? ''} ${c.name}`),
    '## Hooks', ...taxonomy.hooks.map((h) => `- id=${h.id} · ${h.title}`),
    '## Dimension vocabulary', ...Object.entries(DIMENSION_VALUES).map(([d, vs]) => `- ${d}: ${vs.join(', ')}`),
  ].join('\n');
  const user = ['# LEARNINGS', ...learnings.map((l) => `- id=${l.id} · ${l.text}${l.source_ad ? ` [ad: ${l.source_ad}]` : ''}`)].join('\n');

  const res = await anthropic().messages.create({
    model: MODEL, max_tokens: 8000,
    system: [...cachedSystem(SYSTEM), { type: 'text', text: tax, cache_control: { type: 'ephemeral' } }],
    tools: [LINK_TOOL], tool_choice: { type: 'tool', name: 'link_learnings' },
    messages: [{ role: 'user', content: user }],
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!block) throw new Error('linker returned no tool call');
  const { links } = block.input as { links: Array<{ learning_id: string; target_type: string; target_id: string | null; dimension: string | null; dimension_value: string | null; confidence: number; reason: string }> };

  const ids = { persona: new Set(taxonomy.personas.map((p) => p.id)), angle: new Set(taxonomy.angles.map((a) => a.id)), concept: new Set(taxonomy.concepts.map((c) => c.id)), hook: new Set(taxonomy.hooks.map((h) => h.id)) };
  let linked = 0, none = 0;
  const now = new Date().toISOString();
  for (const l of links) {
    if (!learnings.some((x) => x.id === l.learning_id)) continue;
    const patch: Record<string, unknown> = { linked_at: now };
    if (l.target_type === 'dimension' && l.dimension) {
      const vocab = (DIMENSION_VALUES as Record<string, readonly string[]>)[l.dimension];
      const value = l.dimension_value && (!vocab || vocab.includes(l.dimension_value)) ? l.dimension_value : null;
      if (!value) { none++; continue; }
      patch.dimension = l.dimension as Dimension; patch.dimension_value = value;
    } else if (l.target_type !== 'none' && l.target_id && ids[l.target_type as keyof typeof ids]?.has(l.target_id)) {
      patch[`${l.target_type}_id`] = l.target_id;
    } else { none++; continue; }
    await sb.from('learnings').update(patch).eq('id', l.learning_id);
    linked++;
  }
  void LINKER_VERSION;
  return { linked, none, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
}
