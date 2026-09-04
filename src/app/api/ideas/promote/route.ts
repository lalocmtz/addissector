// =============================================================================
// POST /api/ideas/promote — an idea becomes an experiment.
// The variable is mandatory: an experiment that does not name what it changes
// cannot be evaluated, so it cannot exist.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { resolveEconomics } from '@/lib/meta';
import { isVariable, defaultCriteria, nextExperimentNumber, experimentCode } from '@/lib/experiments';
import { EXPERIMENT_SELECT, shapeNewExperiment } from '@/lib/experiments-server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as { id?: string; variable?: string; name?: string; hypothesis?: string; control_ad_id?: string | null; control_note?: string | null; owner_id?: string | null; success_criteria?: unknown };
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  if (!isVariable(body.variable)) return NextResponse.json({ error: 'Missing variable' }, { status: 400 });

  const sb = getSupabase();
  const { data: idea } = await sb.from('idea').select('*').eq('id', body.id).eq('user_id', user.id).maybeSingle();
  if (!idea) return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
  if (idea.status === 'promoted' && idea.experiment_id) return NextResponse.json({ error: 'Already promoted', experimentId: idea.experiment_id }, { status: 409 });

  const { data: brand } = await sb.from('brands').select('economics').eq('id', idea.brand_id).single();
  const eco = resolveEconomics(brand?.economics);
  const number = await nextExperimentNumber(sb, idea.brand_id);
  const owner = body.owner_id ?? idea.owner_id ?? (await defaultOwner(sb, user.id, idea.brand_id));

  const { data: exp, error } = await sb.from('experiment').insert({
    user_id: user.id, brand_id: idea.brand_id, number, code: experimentCode(number),
    name: (body.name?.trim() || idea.text).slice(0, 140),
    hypothesis: body.hypothesis?.trim() || idea.rationale || idea.text,
    prior_evidence: idea.evidence ?? [],
    variable: body.variable,
    persona_id: idea.persona_id, angle_id: idea.angle_id, concept_id: idea.concept_id,
    control_ad_id: body.control_ad_id ?? null, control_note: body.control_note ?? null,
    success_criteria: body.success_criteria ?? defaultCriteria(eco),
    owner_id: owner, status: 'draft', idea_id: idea.id,
  }).select(EXPERIMENT_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from('idea').update({ status: 'promoted', experiment_id: exp.id, variable: body.variable, updated_at: new Date().toISOString() }).eq('id', idea.id);
  return NextResponse.json({ experiment: shapeNewExperiment(exp, eco) });
}

async function defaultOwner(sb: ReturnType<typeof getSupabase>, userId: string, brandId: string): Promise<string | null> {
  const { data } = await sb.from('member').select('id').eq('user_id', userId).eq('active', true).eq('role', 'strategist')
    .or(`brand_id.is.null,brand_id.eq.${brandId}`).order('created_at').limit(1).maybeSingle();
  return data?.id ?? null;
}
