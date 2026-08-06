// =============================================================================
// /api/brain — Secciones del cerebro de la marca (contexto editable).
// GET ?brand= · POST {id?, brandId, title, content, sort} · DELETE ?id=
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
    .from('brain_sections')
    .select('id,title,content,sort,updated_at')
    .eq('brand_id', brandId)
    .eq('user_id', user.id)
    .order('sort');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sections: data ?? [] });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const body = (await request.json()) as {
    id?: string;
    brandId: string;
    title: string;
    content?: string;
    sort?: number;
    bulk?: Array<{ title: string; content: string }>;
  };
  const sb = getSupabase();

  // Importación masiva (ej. desde el cerebro viejo en localStorage)
  if (Array.isArray(body.bulk) && body.brandId) {
    const rows = body.bulk
      .filter((s) => s.title?.trim())
      .map((s, i) => ({
        user_id: user.id,
        brand_id: body.brandId,
        title: s.title.trim(),
        content: s.content ?? '',
        sort: i,
      }));
    const { error } = await sb.from('brain_sections').insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, imported: rows.length });
  }

  if (!body.brandId || !body.title?.trim()) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }
  const row = {
    user_id: user.id,
    brand_id: body.brandId,
    title: body.title.trim(),
    content: body.content ?? '',
    sort: body.sort ?? 0,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = body.id
    ? await sb.from('brain_sections').update(row).eq('id', body.id).eq('user_id', user.id).select().single()
    : await sb.from('brain_sections').insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ section: data });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  const sb = getSupabase();
  const { error } = await sb.from('brain_sections').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
