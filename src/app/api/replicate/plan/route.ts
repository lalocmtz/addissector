import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import { buildGenerationPlan } from '@/lib/replication-prompts';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /api/replicate/plan — arma el plan de clonación (prompts + guion) a
// partir del análisis. No genera nada todavía; es gratis (solo usa Claude).
// ---------------------------------------------------------------------------

interface PlanBody {
  analysis: Record<string, unknown>;
  creativeType: 'video' | 'image';
  variantNumber: number | null;
  brandId?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthConfigured() || !isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Auth no está configurado' }, { status: 500 });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const body = (await request.json()) as PlanBody;
    if (!body.analysis) {
      return NextResponse.json({ error: 'Falta el análisis' }, { status: 400 });
    }

    const sb = getSupabase();

    // Contexto de marca + si hay fotos de producto de referencia
    let brand: { name?: string; tone?: string | null; palette?: string | null; product?: string | null } | null = null;
    let hasProductReference = false;
    if (body.brandId) {
      const [{ data: b }, { count }] = await Promise.all([
        sb.from('brands').select('name,tone,palette,product').eq('id', body.brandId).eq('user_id', user.id).maybeSingle(),
        sb.from('brand_assets').select('id', { count: 'exact', head: true }).eq('brand_id', body.brandId).eq('user_id', user.id),
      ]);
      brand = b ?? null;
      hasProductReference = (count ?? 0) > 0;
    }

    const plan = await buildGenerationPlan({
      analysis: body.analysis,
      creativeType: body.creativeType === 'image' ? 'image' : 'video',
      variantNumber: body.variantNumber ?? null,
      brand,
      hasProductReference,
    });

    return NextResponse.json({ plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error creando el plan';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
