// =============================================================================
// /api/experiments/variants — the ads an experiment will produce.
//   POST   { experimentId, hook?, hook_id?, format?, script?, visual_notes?, owner_id? }
//          the ad name is generated (SG_028_YAPROBE_B / SG_EXP012_HOOK_B) — it is
//          what gets pasted into Meta, and how the ad is matched before it is pinned.
//   PATCH  { id, ...fields }      DELETE ?id=
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { brandPrefix, conceptCode, plannedAdName, variantLetter, normalizeCode } from '@/lib/plan';
import { VARIANT_SELECT } from '@/lib/experiments-server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as { experimentId?: string; hook?: string; hook_id?: string | null; format?: string; script?: string; visual_notes?: string; owner_id?: string | null; variant?: string };
  if (!body.experimentId) return NextResponse.json({ error: 'Missing experimentId' }, { status: 400 });
  const sb = getSupabase();
  const { data: exp } = await sb.from('experiment').select('id,brand_id,number,variable,concept_id,angle_id,owner_id').eq('id', body.experimentId).eq('user_id', user.id).maybeSingle();
  if (!exp) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });

  const [{ data: brand }, { data: existing }, { data: concept }] = await Promise.all([
    sb.from('brands').select('name').eq('id', exp.brand_id).single(),
    sb.from('experiment_variant').select('variant').eq('experiment_id', exp.id),
    exp.concept_id ? sb.from('concepts').select('number,code,angle_id').eq('id', exp.concept_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const angleId = concept?.angle_id ?? exp.angle_id;
  const { data: angle } = angleId ? await sb.from('angles').select('code').eq('id', angleId).maybeSingle() : { data: null };

  const taken = new Set((existing ?? []).map((v) => v.variant).filter(Boolean));
  let letter = body.variant?.toUpperCase().trim() || '';
  if (!letter || taken.has(letter)) { let i = 0; do { letter = variantLetter(i++); } while (taken.has(letter)); }
  const prefix = brandPrefix(brand?.name);
  const base = concept ? (concept.code || conceptCode(prefix, concept.number, angle?.code)) : `${prefix}_EXP${String(exp.number).padStart(3, '0')}_${normalizeCode(exp.variable)}`;
  const adName = plannedAdName(base, letter);

  const { data, error } = await sb.from('experiment_variant').insert({
    user_id: user.id, brand_id: exp.brand_id, experiment_id: exp.id, concept_id: exp.concept_id, ad_name: adName, variant: letter,
    hook_id: body.hook_id ?? null, hook: body.hook?.trim() || null, format: body.format?.trim() || null, script: body.script?.trim() || null,
    visual_notes: body.visual_notes?.trim() || null, owner_id: body.owner_id ?? exp.owner_id ?? null, status: 'planned',
  }).select(VARIANT_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ variant: data });
}

const WRITABLE = ['ad_name', 'variant', 'hook_id', 'hook', 'format', 'script', 'visual_notes', 'status', 'owner_id', 'meta_ad_id', 'uploaded_at'] as const;

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const id = body.id as string | undefined;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of WRITABLE) if (body[k] !== undefined) patch[k] = typeof body[k] === 'string' ? (body[k] as string).trim() || null : body[k];
  if (patch.meta_ad_id) patch.matched_at = new Date().toISOString();
  const sb = getSupabase();
  const { data, error } = await sb.from('experiment_variant').update(patch).eq('id', id).eq('user_id', user.id).select(VARIANT_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // A variant going live starts the experiment clock.
  if (patch.status === 'live' || patch.meta_ad_id) {
    const { data: exp } = await sb.from('experiment').select('id,status,started_at').eq('id', data.experiment_id).maybeSingle();
    if (exp && ['draft', 'planned', 'producing'].includes(exp.status)) await sb.from('experiment').update({ status: 'live', started_at: exp.started_at ?? new Date().toISOString() }).eq('id', exp.id);
  }
  return NextResponse.json({ variant: data });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const sb = getSupabase();
  const { error } = await sb.from('experiment_variant').delete().eq('id', id).eq('user_id', user.id).is('meta_ad_id', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
