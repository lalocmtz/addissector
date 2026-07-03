import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 30;

function guard() {
  if (!isSupabaseConfigured() || !isAuthConfigured()) {
    return NextResponse.json({ error: 'Supabase no configurado' }, { status: 501 });
  }
  return null;
}

// GET conjunto + anuncios
export async function GET(_r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = guard();
  if (g) return g;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  const sb = getSupabase();
  const [{ data: adset }, { data: ads }] = await Promise.all([
    sb.from('ad_sets').select('*').eq('id', id).eq('user_id', user.id).maybeSingle(),
    sb.from('ads').select('*').eq('ad_set_id', id).eq('user_id', user.id).order('created_at'),
  ]);
  if (!adset) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  return NextResponse.json({ adset, ads: ads ?? [] });
}

// PATCH conjunto {name?, pain?, notes?}
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = guard();
  if (g) return g;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['name', 'pain', 'notes']) if (body[k] !== undefined) patch[k] = body[k];
  const { data, error } = await getSupabase()
    .from('ad_sets')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ adset: data });
}

export async function DELETE(_r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = guard();
  if (g) return g;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  await getSupabase().from('ad_sets').delete().eq('id', id).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}
