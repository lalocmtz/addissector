import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';

// GET /api/adsets?brand=  ·  POST /api/adsets {name, pain, notes, brandId}
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured() || !isAuthConfigured()) return NextResponse.json({ adsets: [] });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  let q = getSupabase()
    .from('ad_sets')
    .select('id,name,pain,notes,brand_id,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  const brand = request.nextUrl.searchParams.get('brand');
  if (brand) q = q.eq('brand_id', brand);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ adsets: data ?? [] });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured() || !isAuthConfigured()) {
    return NextResponse.json({ error: 'Supabase no configurado' }, { status: 501 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const body = await request.json();
  if (!body.name?.trim()) return NextResponse.json({ error: 'Ponle nombre al conjunto' }, { status: 400 });
  const { data, error } = await getSupabase()
    .from('ad_sets')
    .insert({
      user_id: user.id,
      brand_id: body.brandId ?? null,
      name: body.name.trim(),
      pain: body.pain ?? null,
      notes: body.notes ?? null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ adset: data });
}
