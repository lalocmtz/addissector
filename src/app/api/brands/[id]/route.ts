import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';

function notConfigured() {
  return NextResponse.json({ error: 'Supabase no está configurado' }, { status: 501 });
}

// ---------------------------------------------------------------------------
// PATCH /api/brands/[id] — renombrar / editar contexto (tono, paleta, producto)
// ---------------------------------------------------------------------------
interface UpdateBrandBody {
  name?: string;
  tone?: string | null;
  palette?: string | null;
  product?: string | null;
  economics?: { currency?: string; breakeven?: number; target?: number; kill?: number } | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured() || !isAuthConfigured()) return notConfigured();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const { id } = await params;
    const body = (await request.json()) as UpdateBrandBody;

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: 'La marca necesita un nombre' }, { status: 400 });
      patch.name = name;
    }
    if (body.tone !== undefined) patch.tone = body.tone?.trim() || null;
    if (body.palette !== undefined) patch.palette = body.palette?.trim() || null;
    if (body.product !== undefined) patch.product = body.product?.trim() || null;
    if (body.economics !== undefined) patch.economics = body.economics;

    const sb = getSupabase();
    const { data, error } = await sb
      .from('brands')
      .update(patch)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id,name,tone,palette,product,created_at')
      .single();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });

    return NextResponse.json({ brand: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error actualizando la marca';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/brands/[id] — borrar marca (los creativos quedan sin marca)
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured() || !isAuthConfigured()) return notConfigured();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const { id } = await params;
    const sb = getSupabase();

    // No dejar al usuario sin ninguna marca.
    const { count } = await sb
      .from('brands')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Necesitas al menos una marca. Crea otra antes de borrar esta.' },
        { status: 400 }
      );
    }

    const { error } = await sb.from('brands').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error eliminando la marca';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
