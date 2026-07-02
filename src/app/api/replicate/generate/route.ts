import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import { createImageTask, createVideoTask, isKieConfigured, KIE_MODELS } from '@/lib/kie';
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
  /** para 'video': id de la generación de imagen que será el primer frame */
  parentGenerationId?: string;
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

    let kieTaskId: string;
    let prompt: string;
    let parentId: string | null = null;
    let durationSeconds: number | null = null;

    if (body.kind === 'image') {
      // Referencias: fotos de producto de la marca + preview del creativo original
      const refs: string[] = [];
      if (body.brandId) {
        const { data: assets } = await sb
          .from('brand_assets')
          .select('url')
          .eq('brand_id', body.brandId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(3);
        for (const a of assets ?? []) refs.push(a.url);
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

      prompt = finalImagePrompt(body.plan);
      kieTaskId = await createImageTask({ prompt, referenceImageUrls: refs });
    } else {
      // Video: necesita la imagen ya generada como primer frame
      if (!body.parentGenerationId) {
        return NextResponse.json({ error: 'Falta la imagen base para animar' }, { status: 400 });
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
      parentId = parent.id;
      durationSeconds = Math.max(4, Math.min(12, Math.round(body.plan.duration_seconds || 8)));
      prompt = finalMotionPrompt(body.plan);
      kieTaskId = await createVideoTask({
        prompt,
        firstFrameUrl: parent.result_url,
        durationSeconds,
        generateAudio: body.plan.generate_audio !== false,
      });
    }

    const { data: row, error } = await sb
      .from('generations')
      .insert({
        user_id: user.id,
        brand_id: body.brandId ?? null,
        creative_id: body.creativeId ?? null,
        parent_id: parentId,
        kind: body.kind,
        status: 'processing',
        prompt,
        spoken_script: body.kind === 'video' ? body.plan.spoken_script : null,
        variant_label: body.plan.variant_label ?? null,
        kie_task_id: kieTaskId,
        kie_model: body.kind === 'image' ? KIE_MODELS.image : KIE_MODELS.video,
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
