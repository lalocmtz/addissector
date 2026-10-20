// =============================================================================
// GET /api/marca/fotos?brand=  — la biblioteca de marca: fotos reales del
// producto (tatuaje puesto, packs, empaque) que el adaptador de estáticos usa
// como referencia para que la IA no invente el producto. Se suben con
// /api/canvas/upload-url { folder: 'marca' } y viven en brand-assets.
// DELETE ?brand=&path=  quita una.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';
const BUCKET = 'brand-assets';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const sb = getSupabase();
  const { data: brand } = await sb.from('brands').select('id').eq('id', brandId).eq('user_id', user.id).maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });
  const carpeta = `${user.id}/${brandId}/marca`;
  const { data, error } = await sb.storage.from(BUCKET).list(carpeta, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const fotos = (data ?? []).filter((f) => f.name && !f.name.startsWith('.')).map((f) => ({
    path: `${carpeta}/${f.name}`,
    url: sb.storage.from(BUCKET).getPublicUrl(`${carpeta}/${f.name}`).data.publicUrl,
  }));
  return NextResponse.json({ fotos });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const brandId = sp.get('brand') ?? '';
  const path = sp.get('path') ?? '';
  if (!path.startsWith(`${user.id}/${brandId}/marca/`)) return NextResponse.json({ error: 'Ruta inválida' }, { status: 400 });
  const { error } = await getSupabase().storage.from(BUCKET).remove([path]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
