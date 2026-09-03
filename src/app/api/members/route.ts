// =============================================================================
// /api/members — the real people (and the AI) who own work. Workspace-level:
// a member belongs to the user, optionally scoped to one brand.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';
const SELECT = 'id,brand_id,name,email,role,is_ai,active,created_at';
const ROLES = ['strategist', 'designer', 'editor', 'media_buyer', 'ai', 'other'];

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  const sb = getSupabase();
  let q = sb.from('member').select(SELECT).eq('user_id', user.id).eq('active', true).order('created_at');
  if (brandId) q = q.or(`brand_id.is.null,brand_id.eq.${brandId}`);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as { name?: string; email?: string; role?: string; brandId?: string | null };
  if (!body.name?.trim()) return NextResponse.json({ error: 'Missing name' }, { status: 400 });
  const role = ROLES.includes(body.role ?? '') ? body.role : 'other';
  const sb = getSupabase();
  const { data, error } = await sb.from('member')
    .insert({ user_id: user.id, brand_id: body.brandId ?? null, name: body.name.trim(), email: body.email?.trim() || null, role })
    .select(SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as { id?: string; name?: string; email?: string | null; role?: string; active?: boolean };
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.email !== undefined) patch.email = body.email?.trim() || null;
  if (body.role !== undefined && ROLES.includes(body.role)) patch.role = body.role;
  if (body.active !== undefined) patch.active = body.active;
  const sb = getSupabase();
  const { data, error } = await sb.from('member').update(patch).eq('id', body.id).eq('user_id', user.id).select(SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
