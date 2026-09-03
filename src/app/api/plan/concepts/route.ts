// =============================================================================
// /api/plan/concepts — Conceptos.
// El POST hace lo que ninguna otra ruta: asigna el número correlativo de la
// marca, genera el código (SG_028_YAPROBE) y crea de una vez las variantes
// de anuncio con su nombre exacto listo para pegar en Meta.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { brandPrefix, conceptCode, plannedAdName, variantLetter } from '@/lib/plan';

export const runtime = 'nodejs';

const SELECT =
  'id,angle_id,persona_id,number,code,name,narrative_format,hypothesis,offer,status,origin,origin_ad_name,brief,do_not_change,owner,target_assets,planned_for,created_at';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const sb = getSupabase();
  const { data, error } = await sb
    .from('concepts')
    .select(SELECT)
    .eq('brand_id', brandId)
    .eq('user_id', user.id)
    .order('number', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const body = (await request.json()) as {
    brandId: string; name: string; angleId?: string | null; personaId?: string | null;
    narrativeFormat?: string; hypothesis?: string; offer?: string; owner?: string;
    targetAssets?: number; plannedFor?: string | null; origin?: string; originAdName?: string;
    brief?: string; doNotChange?: string; variants?: string[];
  };
  if (!body.brandId || !body.name?.trim()) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }
  const sb = getSupabase();

  // Prefijo de la marca y código del ángulo (si tiene)
  const [{ data: brand }, { data: angle }, { data: last }] = await Promise.all([
    sb.from('brands').select('name').eq('id', body.brandId).single(),
    body.angleId
      ? sb.from('angles').select('code').eq('id', body.angleId).single()
      : Promise.resolve({ data: null as { code: string } | null }),
    sb.from('concepts').select('number').eq('brand_id', body.brandId).order('number', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const prefix = brandPrefix(brand?.name);
  const nextNumber = ((last?.number as number | undefined) ?? 0) + 1;
  const code = conceptCode(prefix, nextNumber, angle?.code ?? null);

  const { data: concept, error } = await sb
    .from('concepts')
    .insert({
      user_id: user.id,
      brand_id: body.brandId,
      angle_id: body.angleId || null,
      persona_id: body.personaId || null,
      number: nextNumber,
      code,
      name: body.name.trim(),
      narrative_format: body.narrativeFormat?.trim() || null,
      hypothesis: body.hypothesis?.trim() || null,
      offer: body.offer?.trim() || null,
      origin: body.origin || 'manual',
      origin_ad_name: body.originAdName?.trim() || null,
      brief: body.brief?.trim() || null,
      do_not_change: body.doNotChange?.trim() || null,
      owner: body.owner || null,
      target_assets: body.targetAssets ?? 3,
      planned_for: body.plannedFor || null,
    })
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Genera las variantes con su nombre exacto de Meta.
  const count = Math.max(1, Math.min(12, body.targetAssets ?? 3));
  const variants = body.variants?.length
    ? body.variants
    : Array.from({ length: count }, (_, i) => variantLetter(i));
  const rows = variants.map((v) => ({
    user_id: user.id,
    brand_id: body.brandId,
    concept_id: concept.id,
    ad_name: plannedAdName(code, v),
    variant: v.toUpperCase(),
  }));
  const { data: ads } = await sb.from('experiment_variant').insert(rows).select('id,ad_name,variant,status,format,hook,owner_id,meta_ad_id');

  return NextResponse.json({ item: concept, ads: ads ?? [] });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const id = body.id as string;
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  const allowed = [
    'angle_id', 'persona_id', 'name', 'narrative_format', 'hypothesis', 'offer',
    'status', 'brief', 'do_not_change', 'owner', 'target_assets', 'planned_for',
  ];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (body[k] !== undefined) {
      const v = body[k];
      patch[k] = typeof v === 'string' ? (v.trim() || null) : v;
    }
  }

  const sb = getSupabase();

  // Si cambia el ángulo, el código deja de ser válido: se regenera y se
  // renombran las variantes que todavía NO se han subido a Meta.
  if (body.angle_id !== undefined) {
    const { data: current } = await sb
      .from('concepts').select('number,brand_id,code').eq('id', id).eq('user_id', user.id).single();
    if (current) {
      const [{ data: brand }, { data: angle }] = await Promise.all([
        sb.from('brands').select('name').eq('id', current.brand_id).single(),
        body.angle_id
          ? sb.from('angles').select('code').eq('id', body.angle_id as string).single()
          : Promise.resolve({ data: null as { code: string } | null }),
      ]);
      const newCode = conceptCode(brandPrefix(brand?.name), current.number, angle?.code ?? null);
      if (newCode !== current.code) {
        patch.code = newCode;
        // Only variants not yet pinned to a Meta ad get renamed: once matched, the name is irrelevant.
        const { data: pending } = await sb
          .from('experiment_variant').select('id,variant').eq('concept_id', id).is('meta_ad_id', null);
        for (const p of pending ?? []) {
          await sb.from('experiment_variant').update({ ad_name: plannedAdName(newCode, p.variant ?? 'A') }).eq('id', p.id);
        }
      }
    }
  }

  const { data, error } = await sb
    .from('concepts').update(patch).eq('id', id).eq('user_id', user.id).select(SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  const sb = getSupabase();
  const { error } = await sb.from('concepts').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
