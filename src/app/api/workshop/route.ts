// =============================================================================
// /api/workshop
//   GET  ?brand=&window=    the whole screen in one call: batches (live, bench,
//                           closed) with pieces and numbers, angles, members
//   POST                    create a batch — angle and ONE variable are required
//   PATCH                   update a batch / move its status
//                           status:'ready' = "marked as uploaded" (piece-level)
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { loadWorkshop, BATCH_SELECT } from '@/lib/batch-server';
import { BATCH_VARIABLES, AWARENESS_STAGES } from '@/lib/batch';
import { nextExperimentNumber, experimentCode, EXPERIMENT_STATUSES } from '@/lib/experiments';

export const runtime = 'nodejs';
export const maxDuration = 60;

const WRITABLE = [
  'name', 'hypothesis', 'variable', 'angle_id', 'product_id', 'owner_id',
  'awareness', 'impression_cap', 'planned_for', 'notes', 'brief', 'success_criteria',
];

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Missing brand' }, { status: 400 });
  const windowDays = Math.min(Math.max(Number(request.nextUrl.searchParams.get('window') ?? 30), 3), 180);

  const sb = getSupabase();
  try {
    const workshop = await loadWorkshop(sb, user.id, brandId, windowDays);
    const [membersRes, anglesRes] = await Promise.all([
      sb.from('member').select('id,name,role,is_ai').eq('user_id', user.id).eq('active', true)
        .or(`brand_id.is.null,brand_id.eq.${brandId}`),
      sb.from('angles').select('id,code,name,persona_id,awareness_stage,personas(name)')
        .eq('brand_id', brandId).eq('user_id', user.id).order('code'),
    ]);
    return NextResponse.json({
      ...workshop,
      members: membersRes.data ?? [],
      angles: anglesRes.data ?? [],
    });
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

  // A batch without an angle is a note, and a batch without one declared
  // variable is not a test. Both are refused here rather than silently allowed
  // and discovered later as an unreadable result.
  const angleId = body.angle_id as string | undefined;
  if (!angleId) return NextResponse.json({ error: 'A batch needs an angle' }, { status: 400 });
  const variable = String(body.variable ?? '');
  if (!(BATCH_VARIABLES as readonly string[]).includes(variable)) {
    return NextResponse.json({ error: 'A batch changes exactly one declared variable' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });

  const sb = getSupabase();
  const { data: angle } = await sb.from('angles').select('id,persona_id,awareness_stage')
    .eq('id', angleId).eq('brand_id', brandId).eq('user_id', user.id).maybeSingle();
  if (!angle) return NextResponse.json({ error: 'Angle not found' }, { status: 404 });

  const awarenessIn = String(body.awareness ?? angle.awareness_stage ?? '');
  const awareness = (AWARENESS_STAGES as readonly string[]).includes(awarenessIn) ? awarenessIn : null;

  const number = await nextExperimentNumber(sb, brandId);
  const { data, error } = await sb.from('experiment').insert({
    user_id: user.id, brand_id: brandId, number, code: experimentCode(number),
    name, variable, angle_id: angleId,
    // The persona is a property of the angle. It is copied here only so old
    // reads keep working; nothing writes it independently any more.
    persona_id: angle.persona_id ?? null,
    awareness,
    hypothesis: typeof body.hypothesis === 'string' ? body.hypothesis.trim() || null : null,
    product_id: (body.product_id as string) ?? null,
    owner_id: (body.owner_id as string) ?? null,
    impression_cap: Number(body.impression_cap ?? 1500),
    planned_for: (body.planned_for as string) ?? null,
    status: 'planned',
  }).select(BATCH_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ batch: data });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const id = body.id as string | undefined;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of WRITABLE) {
    if (body[k] === undefined) continue;
    const v = body[k];
    patch[k] = typeof v === 'string' ? (v.trim() || null) : v;
  }
  const sb = getSupabase();

  // "Marcar como subida". The batch table has no `ready` status (check
  // constraint: draft/planned/producing/live/evaluating/closed/archived), so
  // "every piece is produced and uploaded" is stored on the pieces themselves;
  // loadWorkshop reads it back as stage = 'waiting'. The batch flips to `live`
  // on its own the day one of those names shows up in ad_daily.
  if (body.status === 'ready') {
    const { data: batch } = await sb.from('experiment').select('id,status').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    if (!['draft', 'planned', 'producing'].includes(batch.status)) {
      return NextResponse.json({ error: 'Batch is already in test or closed' }, { status: 409 });
    }
    const { error: perr } = await sb.from('experiment_variant')
      .update({ status: 'uploaded', uploaded_at: patch.updated_at, updated_at: patch.updated_at })
      .eq('experiment_id', id).eq('user_id', user.id).in('status', ['planned', 'producing', 'ready']);
    if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });
    delete body.status;
  }

  if (typeof body.status === 'string') {
    if (!(EXPERIMENT_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
    }
    patch.status = body.status;
    if (body.status === 'live') patch.started_at = (body.started_at as string) ?? new Date().toISOString();
  }
  if (patch.variable !== undefined && !(BATCH_VARIABLES as readonly string[]).includes(String(patch.variable))) {
    return NextResponse.json({ error: 'Unknown variable' }, { status: 400 });
  }

  const { data, error } = await sb.from('experiment').update(patch)
    .eq('id', id).eq('user_id', user.id).select(BATCH_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ batch: data });
}
