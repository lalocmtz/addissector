// =============================================================================
// /api/tiktok/videos — la biblioteca de videos de un producto.
//
// GET  ?brand=&product=   los videos, los ganadores primero.
// POST { brandId, productId, title, storage_path, origin }
// PATCH { id, ... }       marcar ganador, anotar, corregir lo que sacó la IA.
// DELETE ?id=             borra la fila; el archivo se queda en el bucket.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { tiktokEnabled } from '@/lib/tiktok-server';

export const runtime = 'nodejs';

const SELECT = 'id,product_id,title,storage_path,video_url,thumbnail_url,duration,origin,winner,' +
  'transcript,hook,headline,framework,why_worked,beats,analyzed_at,notes,created_at';

const WRITABLE = ['title', 'origin', 'winner', 'notes', 'hook', 'headline', 'framework', 'why_worked', 'product_id'] as const;

async function auth() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  if (!(await tiktokEnabled(user.id))) return { error: NextResponse.json({ error: 'Modo no disponible' }, { status: 403 }) };
  return { user };
}

export async function GET(request: NextRequest) {
  const a = await auth();
  if (a.error) return a.error;
  const sp = request.nextUrl.searchParams;
  const brandId = sp.get('brand');
  const productId = sp.get('product');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });

  const sb = getSupabase();
  let q = sb.from('tt_video').select(SELECT).eq('brand_id', brandId).eq('user_id', a.user!.id);
  if (productId) q = q.eq('product_id', productId);
  // Ganadores primero: la biblioteca existe para volver a ellos.
  const { data, error } = await q.order('winner', { ascending: false }).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: NextRequest) {
  const a = await auth();
  if (a.error) return a.error;
  const body = (await request.json()) as Record<string, unknown>;
  const brandId = typeof body.brandId === 'string' ? body.brandId : null;
  if (!brandId) return NextResponse.json({ error: 'Falta brandId' }, { status: 400 });

  const sb = getSupabase();
  const row: Record<string, unknown> = {
    user_id: a.user!.id,
    brand_id: brandId,
    product_id: typeof body.productId === 'string' ? body.productId : null,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Video sin título',
    storage_path: typeof body.storage_path === 'string' ? body.storage_path : null,
    video_url: typeof body.video_url === 'string' ? body.video_url : null,
    duration: typeof body.duration === 'number' ? body.duration : null,
    origin: body.origin === 'mio' ? 'mio' : 'referencia',
  };
  const { data, error } = await sb.from('tt_video').insert(row).select(SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function PATCH(request: NextRequest) {
  const a = await auth();
  if (a.error) return a.error;
  const body = (await request.json()) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : null;
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of WRITABLE) {
    if (!(k in body)) continue;
    const v = body[k];
    if (k === 'winner') { patch[k] = Boolean(v); continue; }
    if (v === null) { patch[k] = null; continue; }
    if (typeof v !== 'string') continue;
    const limpio = v.trim();
    // Vaciar un campo de texto lo deja null, no cadena vacía: así el "—" de la
    // pantalla significa siempre lo mismo.
    patch[k] = limpio === '' ? null : limpio;
  }

  const sb = getSupabase();
  const { data, error } = await sb.from('tt_video').update(patch)
    .eq('id', id).eq('user_id', a.user!.id).select(SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(request: NextRequest) {
  const a = await auth();
  if (a.error) return a.error;
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  const sb = getSupabase();
  const { error } = await sb.from('tt_video').delete().eq('id', id).eq('user_id', a.user!.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
