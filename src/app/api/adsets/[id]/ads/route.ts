import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';

// POST crear anuncio · PATCH {adId, ...campos} · DELETE ?ad=
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured() || !isAuthConfigured()) {
    return NextResponse.json({ error: 'Supabase no configurado' }, { status: 501 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const { data, error } = await getSupabase()
    .from('ads')
    .insert({
      ad_set_id: id,
      user_id: user.id,
      name: body.name?.trim() || 'Anuncio nuevo',
      funnel_stage: body.funnel_stage ?? 'tofu',
      pain: body.pain ?? null,
      hypothesis: body.hypothesis ?? null,
      script: body.script ?? null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ad: data });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured() || !isAuthConfigured()) {
    return NextResponse.json({ error: 'Supabase no configurado' }, { status: 501 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  if (!body.adId) return NextResponse.json({ error: 'Falta adId' }, { status: 400 });
  const patch: Record<string, unknown> = {};
  for (const k of ['name', 'funnel_stage', 'pain', 'hypothesis', 'script', 'is_winner']) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  const { data, error } = await getSupabase()
    .from('ads')
    .update(patch)
    .eq('id', body.adId)
    .eq('ad_set_id', id)
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ad: data });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured() || !isAuthConfigured()) {
    return NextResponse.json({ error: 'Supabase no configurado' }, { status: 501 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  const adId = request.nextUrl.searchParams.get('ad');
  if (!adId) return NextResponse.json({ error: 'Falta el anuncio' }, { status: 400 });
  await getSupabase().from('ads').delete().eq('id', adId).eq('ad_set_id', id).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}
