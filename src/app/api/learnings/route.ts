// =============================================================================
// /api/learnings — Aprendizajes acumulados de la marca.
// GET ?brand= · POST {brandId, text, evidence?, source_ad?} ·
// PATCH {id, active} · DELETE ?id=
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const sb = getSupabase();
  const { data, error } = await sb
    .from('learnings')
    .select('id,text,evidence,source_ad,active,created_at')
    .eq('brand_id', brandId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ learnings: data ?? [] });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const body = (await request.json()) as { brandId: string; text: string; evidence?: string; source_ad?: string };
  if (!body.brandId || !body.text?.trim()) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  const sb = getSupabase();
  const { data, error } = await sb
    .from('learnings')
    .insert({
      user_id: user.id,
      brand_id: body.brandId,
      text: body.text.trim(),
      evidence: body.evidence?.trim() || null,
      source_ad: body.source_ad?.trim() || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ learning: data });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const body = (await request.json()) as { id: string; active?: boolean; text?: string };
  if (!body.id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (body.active !== undefined) patch.active = body.active;
  if (body.text !== undefined) patch.text = body.text;
  const sb = getSupabase();
  const { error } = await sb.from('learnings').update(patch).eq('id', body.id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  const sb = getSupabase();
  const { error } = await sb.from('learnings').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
