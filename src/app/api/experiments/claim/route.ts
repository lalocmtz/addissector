// =============================================================================
// POST /api/experiments/claim — an ad that already runs in Meta is claimed into
// the plan: it becomes a variant (pinned by ad_id) of an experiment, and/or a
// member of a concept. Nothing is renamed in Meta; the id is the identity.
//
//   { brandId, ad_id, experimentId? , conceptId? , newConcept?: {name, angle_id?, persona_id?}, asControl? }
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { brandPrefix, conceptCode } from '@/lib/plan';
import { VARIANT_SELECT } from '@/lib/experiments-server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as { brandId?: string; ad_id?: string; experimentId?: string | null; conceptId?: string | null; newConcept?: { name: string; angle_id?: string | null; persona_id?: string | null } | null; asControl?: boolean };
  if (!body.brandId || !body.ad_id) return NextResponse.json({ error: 'Missing brandId or ad_id' }, { status: 400 });
  const sb = getSupabase();
  const { data: meta } = await sb.from('meta_ads').select('id,ad_id,name,concept_id').eq('brand_id', body.brandId).eq('ad_id', body.ad_id).maybeSingle();
  if (!meta) return NextResponse.json({ error: 'Ad not found in this brand' }, { status: 404 });
  const now = new Date().toISOString();

  // Concept: existing, new, or the experiment's.
  let conceptId = body.conceptId ?? null;
  if (!conceptId && body.newConcept?.name?.trim()) {
    const [{ data: brand }, { data: last }] = await Promise.all([
      sb.from('brands').select('name').eq('id', body.brandId).single(),
      sb.from('concepts').select('number').eq('brand_id', body.brandId).order('number', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const number = (last?.number ?? 0) + 1;
    const angleCode = body.newConcept.angle_id ? (await sb.from('angles').select('code').eq('id', body.newConcept.angle_id).maybeSingle()).data?.code : null;
    const { data: c, error } = await sb.from('concepts').insert({
      user_id: user.id, brand_id: body.brandId, number, code: conceptCode(brandPrefix(brand?.name), number, angleCode),
      name: body.newConcept.name.trim(), angle_id: body.newConcept.angle_id ?? null, persona_id: body.newConcept.persona_id ?? null,
      status: 'live', origin: 'meta', origin_ad_name: meta.name, origin_ad_id: meta.ad_id,
    }).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    conceptId = c.id;
  }

  // Experiment: as control or as a live variant.
  let variant = null;
  if (body.experimentId) {
    const { data: exp } = await sb.from('experiment').select('id,concept_id,status,started_at,owner_id').eq('id', body.experimentId).eq('user_id', user.id).maybeSingle();
    if (!exp) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    conceptId = conceptId ?? exp.concept_id ?? null;
    if (body.asControl) {
      await sb.from('experiment').update({ control_ad_id: meta.ad_id, updated_at: now }).eq('id', exp.id);
    } else {
      const { data: existing } = await sb.from('experiment_variant').select('variant').eq('experiment_id', exp.id);
      const taken = new Set((existing ?? []).map((v) => v.variant));
      let i = 0, letter = 'A';
      while (taken.has(letter)) letter = String.fromCharCode(65 + ++i);
      // The ad name in Meta is what it is; uniqueness per brand is on ad_name, so reuse it if free.
      const { data: clash } = await sb.from('experiment_variant').select('id,experiment_id').eq('brand_id', body.brandId).eq('ad_name', meta.name).maybeSingle();
      if (clash && clash.experiment_id !== exp.id) {
        await sb.from('experiment_variant').update({ experiment_id: exp.id, concept_id: conceptId, variant: letter, meta_ad_id: meta.ad_id, matched_at: now, status: 'live', claimed_from: 'meta', updated_at: now }).eq('id', clash.id);
        variant = (await sb.from('experiment_variant').select(VARIANT_SELECT).eq('id', clash.id).single()).data;
      } else if (clash) {
        variant = (await sb.from('experiment_variant').update({ meta_ad_id: meta.ad_id, matched_at: now, status: 'live', claimed_from: 'meta', updated_at: now }).eq('id', clash.id).select(VARIANT_SELECT).single()).data;
      } else {
        const { data, error } = await sb.from('experiment_variant').insert({
          user_id: user.id, brand_id: body.brandId, experiment_id: exp.id, concept_id: conceptId, ad_name: meta.name, variant: letter,
          status: 'live', owner_id: exp.owner_id, meta_ad_id: meta.ad_id, matched_at: now, claimed_from: 'meta',
        }).select(VARIANT_SELECT).single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        variant = data;
      }
      if (['draft', 'planned', 'producing'].includes(exp.status)) await sb.from('experiment').update({ status: 'live', started_at: exp.started_at ?? now, updated_at: now }).eq('id', exp.id);
    }
  }

  if (conceptId) {
    await sb.from('meta_ads').update({ concept_id: conceptId, taxonomy_source: 'manual', classified_at: now, updated_at: now }).eq('id', meta.id);
    // A creative analyzed for this ad inherits the concept through meta_ad_id (nothing to write: the link is the id).
  }
  return NextResponse.json({ ok: true, conceptId, variant });
}
