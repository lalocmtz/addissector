import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import {
  createImageTask,
  createVideoTask,
  isKieConfigured,
  KIE_MODELS,
  type VideoQuality,
} from '@/lib/kie';
import {
  finalImagePrompt,
  finalMotionPrompt,
  type GenerationPlan,
} from '@/lib/replication-prompts';

export const runtime = 'nodejs';
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /api/replicate/generate — dispara UNA generación (imagen o video) en
// Kie.ai. Cada llamada es un clic explícito del usuario con costo mostrado.
// ---------------------------------------------------------------------------

interface GenerateBody {
  kind: 'image' | 'video';
  plan: GenerationPlan;
  brandId?: string | null;
  creativeId?: string | null;
  /** imágenes por lote (1-4, default 3) */
  count?: number;
  /** permitir generar sin fotos del producto real (bajo advertencia) */
  allowGenericProduct?: boolean;
  /** para 'video': id de la generación de imagen APROBADA (primer frame) */
  parentGenerationId?: string;
  /** calidad del video */
  quality?: VideoQuality;
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthConfigured() || !isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Auth no está configurado' }, { status: 500 });
    }
    if (!isKieConfigured()) {
      return NextResponse.json(
        { error: 'Kie.ai no está conectado todavía (falta KIE_API_KEY).', code: 'kie_missing' },
        { status: 501 }
      );
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const body = (await request.json()) as GenerateBody;
    if (!body.plan || (body.kind !== 'image' && body.kind !== 'video')) {
      return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
    }

    const sb = getSupabase();

    if (body.kind === 'image') {
      // Referencias: fotos de producto de la marca + preview del creativo original
      const refs: string[] = [];
      let productRefs = 0;
      if (body.brandId) {
        const { data: assets } = await sb
          .from('brand_assets')
          .select('url')
          .eq('brand_id', body.brandId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(3);
        for (const a of assets ?? []) refs.push(a.url);
        productRefs = (assets ?? []).length;
      }

      // FOCO ROJO: sin fotos del producto real, el modelo lo inventa.
      // Bloqueamos el gasto salvo confirmación explícita.
      if (productRefs === 0 && !body.allowGenericProduct) {
        return NextResponse.json(
          {
            error:
              'No hay fotos de tu producto en esta marca: la IA generaría un empaque inventado. Sube 1-3 fotos en Marcas, o confirma que quieres continuar con producto genérico.',
            code: 'no_product_reference',
          },
          { status: 428 }
        );
      }

      if (body.creativeId) {
        const { data: creative } = await sb
          .from('creatives')
          .select('preview_url')
          .eq('id', body.creativeId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (creative?.preview_url) refs.push(creative.preview_url);
      }

      const count = Math.max(1, Math.min(4, Math.round(body.count ?? 3)));
      const basePrompt = finalImagePrompt(body.plan);
      const generations = [];
      for (let i = 0; i < count; i++) {
        const prompt =
          count === 1
            ? basePrompt
            : `${basePrompt}\n\nVariation ${i + 1} of ${count}: vary the person's look (hair, age within the target range, outfit) and small setting details, while keeping every rule above and the exact same product.`;
        const kieTaskId = await createImageTask({ prompt, referenceImageUrls: refs });
        const { data: row, error } = await sb
          .from('generations')
          .insert({
            user_id: user.id,
            brand_id: body.brandId ?? null,
            creative_id: body.creativeId ?? null,
            kind: 'image',
            status: 'processing',
            prompt,
            variant_label: body.plan.variant_label ?? null,
            kie_task_id: kieTaskId,
            kie_model: KIE_MODELS.image,
          })
          .select('*')
          .single();
        if (error) throw error;
        generations.push(row);
      }
      return NextResponse.json({ generations });
    }

    // ------ VIDEO: necesita la imagen APROBADA como primer frame ------
    if (!body.parentGenerationId) {
      return NextResponse.json({ error: 'Falta la imagen aprobada para animar' }, { status: 400 });
    }
    const { data: parent } = await sb
      .from('generations')
      .select('id,result_url,status')
      .eq('id', body.parentGenerationId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!parent || parent.status !== 'success' || !parent.result_url) {
      return NextResponse.json(
        { error: 'La imagen base no está lista todavía' },
        { status: 400 }
      );
    }

    const quality: VideoQuality = body.quality ?? 'sora_pro';
    const durationSeconds = Math.max(8, Math.min(12, Math.round(body.plan.duration_seconds || 10)));
    const prompt = finalMotionPrompt(body.plan);
    const { taskId, model } = await createVideoTask({
      quality,
      prompt,
      firstFrameUrl: parent.result_url,
      durationSeconds,
      generateAudio: body.plan.generate_audio !== false,
    });

    const { data: row, error } = await sb
      .from('generations')
      .insert({
        user_id: user.id,
        brand_id: body.brandId ?? null,
        creative_id: body.creativeId ?? null,
        parent_id: parent.id,
        kind: 'video',
        status: 'processing',
        prompt,
        spoken_script: body.plan.spoken_script,
        variant_label: body.plan.variant_label ?? null,
        kie_task_id: taskId,
        kie_model: model,
        duration_seconds: durationSeconds,
      })
      .select('*')
      .single();
    if (error) throw error;

    return NextResponse.json({ generation: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al generar';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
