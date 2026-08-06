// =============================================================================
// /api/research/notes — Banco de ángulos / reseñas / dudas.
// GET ?brand= · POST {brandId, kind, title, body?, source?} ·
// PATCH {id, status?, title?, body?} · DELETE ?id=
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
    .from('research_notes')
    .select('id,kind,title,body,source,status,created_at')
    .eq('brand_id', brandId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const body = (await request.json()) as {
    brandId: string; kind?: string; title: string; body?: string; source?: string;
  };
  if (!body.brandId || !body.title?.trim()) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  const sb = getSupabase();
  const { data, error } = await sb
    .from('research_notes')
    .insert({
      user_id: user.id,
      brand_id: body.brandId,
      kind: body.kind || 'angulo',
      title: body.title.trim(),
      body: body.body?.trim() || null,
      source: body.source?.trim() || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const body = (await request.json()) as { id: string; status?: string; title?: string; body?: string };
  if (!body.id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) patch.status = body.status;
  if (body.title !== undefined) patch.title = body.title;
  if (body.body !== undefined) patch.body = body.body;
  const sb = getSupabase();
  const { error } = await sb.from('research_notes').update(patch).eq('id', body.id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  const sb = getSupabase();
  const { error } = await sb.from('research_notes').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
