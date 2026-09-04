// =============================================================================
// POST /api/strategy/review — a person rules on a classifier proposal.
//   { type: 'persona'|'angle'|'concept'|'hook', id, action: 'accept'|'edit'|'reject'|'merge', patch?, targetId? }
// accept  keeps the row and marks it accepted (edit = accept + patch)
// reject  keeps the row, marks it rejected and detaches every ad from it
// merge   moves every reference to targetId, marks the row merged
// Also lets a person assign an ad directly: { assign: { ad_id, persona_id?, angle_id?, concept_id? } }
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const TABLE = { persona: 'personas', angle: 'angles', concept: 'concepts', hook: 'hook' } as const;
const FK = { persona: 'persona_id', angle: 'angle_id', concept: 'concept_id', hook: 'hook_id' } as const;
type Kind = keyof typeof TABLE;
const EDITABLE: Record<Kind, string[]> = {
  persona: ['name', 'description', 'pains', 'desires', 'objections'],
  angle: ['code', 'name', 'persona_id', 'pain', 'desire', 'mechanism', 'psychology', 'objection', 'awareness_stage', 'funnel_stage', 'priority'],
  concept: ['name', 'angle_id', 'persona_id', 'narrative_format', 'hypothesis', 'offer', 'owner_id'],
  hook: ['title', 'body', 'hook_type', 'status'],
};
/** Every table that points at an entity of each kind. */
const REFS: Record<Kind, Array<{ table: string; col: string }>> = {
  persona: [{ table: 'meta_ads', col: 'persona_id' }, { table: 'angles', col: 'persona_id' }, { table: 'concepts', col: 'persona_id' }, { table: 'learnings', col: 'persona_id' }, { table: 'experiment', col: 'persona_id' }, { table: 'idea', col: 'persona_id' }],
  angle: [{ table: 'meta_ads', col: 'angle_id' }, { table: 'concepts', col: 'angle_id' }, { table: 'learnings', col: 'angle_id' }, { table: 'experiment', col: 'angle_id' }, { table: 'idea', col: 'angle_id' }],
  concept: [{ table: 'meta_ads', col: 'concept_id' }, { table: 'experiment_variant', col: 'concept_id' }, { table: 'learnings', col: 'concept_id' }, { table: 'experiment', col: 'concept_id' }, { table: 'idea', col: 'concept_id' }],
  hook: [{ table: 'ad_dimension', col: 'hook_id' }, { table: 'experiment_variant', col: 'hook_id' }, { table: 'learnings', col: 'hook_id' }, { table: 'idea', col: 'hook_id' }],
};

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as { type?: Kind; id?: string; action?: string; patch?: Record<string, unknown>; targetId?: string; assign?: { brandId: string; ad_id: string; persona_id?: string | null; angle_id?: string | null; concept_id?: string | null } };
  const sb = getSupabase();
  const now = new Date().toISOString();

  if (body.assign) {
    const a = body.assign;
    if (!a.brandId || !a.ad_id) return NextResponse.json({ error: 'Missing brandId or ad_id' }, { status: 400 });
    const patch: Record<string, unknown> = { taxonomy_source: 'manual', classified_at: now, updated_at: now };
    for (const k of ['persona_id', 'angle_id', 'concept_id'] as const) if (a[k] !== undefined) patch[k] = a[k];
    const { error } = await sb.from('meta_ads').update(patch).eq('brand_id', a.brandId).eq('user_id', user.id).eq('ad_id', a.ad_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const type = body.type;
  if (!type || !(type in TABLE) || !body.id) return NextResponse.json({ error: 'Missing type or id' }, { status: 400 });
  const table = TABLE[type];
  const { data: row } = await sb.from(table).select('id,brand_id,review_status').eq('id', body.id).eq('user_id', user.id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (body.action === 'accept' || body.action === 'edit') {
    const patch: Record<string, unknown> = { review_status: 'accepted', reviewed_at: now, updated_at: now };
    if (body.patch) for (const k of EDITABLE[type]) if (body.patch[k] !== undefined) patch[k] = typeof body.patch[k] === 'string' ? (body.patch[k] as string).trim() || null : body.patch[k];
    const { error } = await sb.from(table).update(patch).eq('id', row.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'reject') {
    // Detach ads and dimension rows; keep learnings/experiments history pointing at it.
    await sb.from('meta_ads').update({ [FK[type]]: null, updated_at: now }).eq('brand_id', row.brand_id).eq(FK[type], row.id);
    if (type === 'hook') await sb.from('ad_dimension').update({ hook_id: null }).eq('hook_id', row.id);
    const { error } = await sb.from(table).update({ review_status: 'rejected', reviewed_at: now, updated_at: now }).eq('id', row.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'merge') {
    if (!body.targetId || body.targetId === row.id) return NextResponse.json({ error: 'Missing targetId' }, { status: 400 });
    const { data: target } = await sb.from(table).select('id').eq('id', body.targetId).eq('user_id', user.id).eq('brand_id', row.brand_id).maybeSingle();
    if (!target) return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    for (const r of REFS[type]) await sb.from(r.table).update({ [r.col]: target.id }).eq(r.col, row.id);
    if (type === 'hook') {
      // Union the ad lists.
      const [{ data: src }, { data: dst }] = await Promise.all([sb.from('hook').select('ad_ids').eq('id', row.id).single(), sb.from('hook').select('ad_ids').eq('id', target.id).single()]);
      await sb.from('hook').update({ ad_ids: [...new Set([...(dst?.ad_ids ?? []), ...(src?.ad_ids ?? [])])], updated_at: now }).eq('id', target.id);
    }
    const { error } = await sb.from(table).update({ review_status: 'merged', merged_into: target.id, reviewed_at: now, updated_at: now }).eq('id', row.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, mergedInto: target.id });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
