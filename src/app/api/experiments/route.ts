// =============================================================================
// /api/experiments
//   GET  ?brand=            every experiment with variants, numbers, evaluation
//                           (runs the auto-close pass: decidable → closed + learning)
//   POST                    create — `variable` is mandatory
//   PATCH                   update fields / move status (planned → producing → live …)
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { resolveEconomics } from '@/lib/meta';
import { isVariable, defaultCriteria, resolveCriteria, nextExperimentNumber, experimentCode, EXPERIMENT_STATUSES } from '@/lib/experiments';
import { loadExperiments, EXPERIMENT_SELECT } from '@/lib/experiments-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Missing brand' }, { status: 400 });
  const sb = getSupabase();
  try {
    const { experiments, currency, closed } = await loadExperiments(sb, user.id, brandId, { autoClose: request.nextUrl.searchParams.get('evaluate') !== '0' });
    const { data: members } = await sb.from('member').select('id,name,role,is_ai').eq('user_id', user.id).eq('active', true).or(`brand_id.is.null,brand_id.eq.${brandId}`);
    return NextResponse.json({ experiments, currency, closed, members: members ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const brandId = body.brandId as string | undefined;
  if (!brandId) return NextResponse.json({ error: 'Missing brandId' }, { status: 400 });
  if (!isVariable(body.variable)) return NextResponse.json({ error: 'Missing variable' }, { status: 400 });
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });

  const sb = getSupabase();
  const { data: brand } = await sb.from('brands').select('economics').eq('id', brandId).eq('user_id', user.id).single();
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  const eco = resolveEconomics(brand.economics);
  const number = await nextExperimentNumber(sb, brandId);
  const owner = (body.owner_id as string | null | undefined) ?? (await defaultOwner(sb, user.id, brandId));

  const { data, error } = await sb.from('experiment').insert({
    user_id: user.id, brand_id: brandId, number, code: experimentCode(number), name: name.slice(0, 140),
    hypothesis: str(body.hypothesis), prior_evidence: Array.isArray(body.prior_evidence) ? body.prior_evidence : [],
    variable: body.variable,
    persona_id: str(body.persona_id), angle_id: str(body.angle_id), concept_id: str(body.concept_id),
    control_ad_id: str(body.control_ad_id), control_note: str(body.control_note),
    success_criteria: body.success_criteria ? resolveCriteria(body.success_criteria, eco) : defaultCriteria(eco),
    owner_id: owner, status: 'draft', planned_for: str(body.planned_for),
  }).select(EXPERIMENT_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ experiment: data });
}

const WRITABLE = ['name', 'hypothesis', 'prior_evidence', 'variable', 'persona_id', 'angle_id', 'concept_id', 'control_ad_id', 'control_note', 'success_criteria', 'owner_id', 'status', 'planned_for', 'brief'] as const;

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const id = body.id as string | undefined;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const sb = getSupabase();
  const { data: current } = await sb.from('experiment').select('id,brand_id,status,started_at').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!current) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of WRITABLE) if (body[k] !== undefined) patch[k] = typeof body[k] === 'string' ? (body[k] as string).trim() || null : body[k];
  if (patch.variable !== undefined && !isVariable(patch.variable)) return NextResponse.json({ error: 'Invalid variable' }, { status: 400 });
  if (patch.status !== undefined) {
    if (!(EXPERIMENT_STATUSES as readonly string[]).includes(patch.status as string)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    if (patch.status === 'live' && !current.started_at) patch.started_at = new Date().toISOString();
    if (patch.status === 'closed') return NextResponse.json({ error: 'Use /api/experiments/close' }, { status: 400 });
  }
  if (patch.success_criteria !== undefined) {
    const { data: brand } = await sb.from('brands').select('economics').eq('id', current.brand_id).single();
    patch.success_criteria = resolveCriteria(patch.success_criteria, resolveEconomics(brand?.economics));
  }
  const { data, error } = await sb.from('experiment').update(patch).eq('id', id).eq('user_id', user.id).select(EXPERIMENT_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ experiment: data });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const sb = getSupabase();
  // Never lose a closed experiment: archive it instead.
  const { data: cur } = await sb.from('experiment').select('status').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!cur) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
  if (cur.status === 'closed') {
    await sb.from('experiment').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', id);
    return NextResponse.json({ ok: true, archived: true });
  }
  const { error } = await sb.from('experiment').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function defaultOwner(sb: ReturnType<typeof getSupabase>, userId: string, brandId: string): Promise<string | null> {
  const { data } = await sb.from('member').select('id').eq('user_id', userId).eq('active', true).eq('role', 'strategist')
    .or(`brand_id.is.null,brand_id.eq.${brandId}`).order('created_at').limit(1).maybeSingle();
  return data?.id ?? null;
}
