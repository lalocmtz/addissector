import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BUCKET = 'brand-assets';

async function requireOwnBrand(brandId: string, userId: string) {
  const sb = getSupabase();
  const { data } = await sb
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// GET /api/brands/[id]/assets — fotos de producto de la marca
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured() || !isAuthConfigured()) {
    return NextResponse.json({ assets: [] });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('brand_assets')
    .select('id,kind,url,created_at')
    .eq('brand_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assets: data ?? [] });
}

// ---------------------------------------------------------------------------
// POST /api/brands/[id]/assets — sube una foto (dataUrl) al bucket público
// ---------------------------------------------------------------------------
interface UploadBody {
  dataUrl: string;
  kind?: 'product' | 'creator' | 'logo';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isSupabaseConfigured() || !isAuthConfigured()) {
      return NextResponse.json({ error: 'Supabase no está configurado' }, { status: 501 });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { id } = await params;
    if (!(await requireOwnBrand(id, user.id))) {
      return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });
    }

    const body = (await request.json()) as UploadBody;
    const match = body.dataUrl?.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    if (!match) return NextResponse.json({ error: 'Imagen inválida' }, { status: 400 });

    const contentType = match[1];
    const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 4 * 1024 * 1024) {
      return NextResponse.json({ error: 'La imagen supera 4 MB' }, { status: 400 });
    }

    const sb = getSupabase();
    const assetId = crypto.randomUUID();
    const path = `${user.id}/${id}/${assetId}.${ext}`;
    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (upErr) throw upErr;

    const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const { data, error } = await sb
      .from('brand_assets')
      .insert({ id: assetId, user_id: user.id, brand_id: id, kind: body.kind ?? 'product', url })
      .select('id,kind,url,created_at')
      .single();
    if (error) throw error;

    return NextResponse.json({ asset: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error subiendo la imagen';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/brands/[id]/assets?asset=<assetId>
// ---------------------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isSupabaseConfigured() || !isAuthConfigured()) {
      return NextResponse.json({ error: 'Supabase no está configurado' }, { status: 501 });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { id } = await params;
    const assetId = request.nextUrl.searchParams.get('asset');
    if (!assetId) return NextResponse.json({ error: 'Falta el asset' }, { status: 400 });

    const sb = getSupabase();
    const { data: asset } = await sb
      .from('brand_assets')
      .select('id,url')
      .eq('id', assetId)
      .eq('brand_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!asset) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    const path = asset.url.split(`${BUCKET}/`).pop();
    if (path) await sb.storage.from(BUCKET).remove([path]);
    await sb.from('brand_assets').delete().eq('id', assetId).eq('user_id', user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error eliminando la imagen';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
