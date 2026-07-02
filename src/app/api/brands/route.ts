import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import { getUsageSnapshot } from '@/lib/usage';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET /api/brands — marcas del usuario
// ---------------------------------------------------------------------------
export async function GET() {
  if (!isSupabaseConfigured() || !isAuthConfigured()) {
    return NextResponse.json({ brands: [], configured: false });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('brands')
      .select('id,name,tone,palette,product,created_at')
      .eq('user_id', user.id)
      .order('created_at');
    if (error) throw error;
    return NextResponse.json({ brands: data ?? [], configured: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error listando marcas';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/brands — crear marca (respeta el límite del plan)
// ---------------------------------------------------------------------------
interface CreateBrandBody {
  name?: string;
  tone?: string;
  palette?: string;
  product?: string;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured() || !isAuthConfigured()) {
    return NextResponse.json({ error: 'Supabase no está configurado' }, { status: 501 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const body = (await request.json()) as CreateBrandBody;
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: 'La marca necesita un nombre' }, { status: 400 });

    const sb = getSupabase();
    const [{ count }, usage] = await Promise.all([
      sb.from('brands').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      getUsageSnapshot(user.id),
    ]);

    const maxBrands = usage.plan.limits.maxBrands;
    if ((count ?? 0) >= maxBrands) {
      return NextResponse.json(
        {
          error: `Tu plan incluye ${maxBrands} marca${maxBrands === 1 ? '' : 's'}. Sube de plan para agregar más.`,
          code: 'brand_limit',
          upgrade_url: '/#precios',
        },
        { status: 402 }
      );
    }

    const { data, error } = await sb
      .from('brands')
      .insert({
        user_id: user.id,
        name,
        tone: body.tone?.trim() || null,
        palette: body.palette?.trim() || null,
        product: body.product?.trim() || null,
      })
      .select('id,name,tone,palette,product,created_at')
      .single();
    if (error) throw error;

    return NextResponse.json({ brand: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error creando la marca';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
