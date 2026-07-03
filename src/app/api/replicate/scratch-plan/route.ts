import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import { buildScratchScenes } from '@/lib/replication-prompts';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /api/replicate/scratch-plan — "Crear de 0": descripción → escenas b-roll
// (gratis; solo usa Claude, no gasta créditos de Kie)
// ---------------------------------------------------------------------------

interface Body {
  description: string;
  brandId?: string | null;
  sceneCount?: number;
  durationSeconds?: number; // total: escenas = duración / 5
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthConfigured() || !isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Auth no está configurado' }, { status: 500 });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const body = (await request.json()) as Body;
    if (!body.description?.trim()) {
      return NextResponse.json({ error: 'Describe tu producto y el anuncio que quieres' }, { status: 400 });
    }

    const sb = getSupabase();
    let brand = null;
    let hasProductReference = false;
    let brandDocsContext = '';
    if (body.brandId) {
      const [{ data: b }, { count }, { data: docs }] = await Promise.all([
        sb.from('brands').select('name,tone,palette,product').eq('id', body.brandId).eq('user_id', user.id).maybeSingle(),
        sb.from('brand_assets').select('id', { count: 'exact', head: true }).eq('brand_id', body.brandId).eq('user_id', user.id),
        sb.from('brand_docs').select('extracted_text').eq('brand_id', body.brandId).eq('user_id', user.id).limit(3),
      ]);
      brand = b ?? null;
      hasProductReference = (count ?? 0) > 0;
      brandDocsContext = (docs ?? []).map((d) => d.extracted_text).filter(Boolean).join('\n---\n').slice(0, 6000);
    }

    const sceneCount = body.durationSeconds
      ? Math.round(body.durationSeconds / 5)
      : body.sceneCount;

    const scenes = await buildScratchScenes({
      description: body.description.trim(),
      brand,
      hasProductReference,
      sceneCount,
      brandDocsContext,
    });

    return NextResponse.json({ scenes, hasProductReference });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error creando las escenas';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
