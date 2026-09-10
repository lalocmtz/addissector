// =============================================================================
// saveCreative — the single writer of `creatives` rows.
//
// Used by POST /api/creatives (Studio + browser barrido) and by
// POST /api/meta/analyze-fast (Gemini engine). Uploads the preview thumbnail
// when it comes as a data URL, denormalizes the library columns and links the
// row to meta_ads (hard link by ad_id, tolerant name match as fallback).
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { PREVIEW_BUCKET } from '@/lib/supabase';

export interface SaveCreativeInput {
  name?: string | null;
  type?: 'video' | 'image' | null;
  /** Preview as data URL: uploaded to the previews bucket. */
  previewDataUrl?: string | null;
  /** Preview already hosted (e.g. Meta's thumbnail_url). Used when there is no data URL. */
  previewUrl?: string | null;
  duration?: number | null;
  aspectRatio?: string | null;
  transcript?: string | null;
  analysis: Record<string, unknown>;
  metaMetrics?: Record<string, unknown> | null;
  /** Ruta del video original ya subido al bucket creative-videos (upload directo). */
  videoPath?: string | null;
  /** URL pública del asset ya alojado, cuando el barrido lo subió al bucket. */
  videoUrlDirect?: string | null;
  /** Nombre EXACTO del anuncio en Meta para cruzar métricas y marcarlo como analizado. */
  adName?: string | null;
  /** Vínculo DURO con Meta (viene del barrido automático): no depende del nombre. */
  metaAdId?: string | null;
  /** video_id de Meta: permite deduplicar cuando varios anuncios comparten video. */
  metaVideoId?: string | null;
  /** 'manual' (Studio) o 'auto' (barrido desde la API). */
  source?: 'manual' | 'auto' | null;
}

export interface SaveCreativeResult {
  id: string;
  preview_url: string | null;
  video_url: string | null;
  product: string | null;
  video_type: string | null;
  hook_score: number | null;
}

/** Denormalized library columns, derived the same way for every engine. */
export function denormalizeAnalysis(analysis: Record<string, unknown>, isImage: boolean) {
  const sa = (analysis.structural_analysis ?? {}) as Record<string, unknown>;
  const dashboard = (analysis.dashboard ?? {}) as Record<string, unknown>;
  const hook = (dashboard.hook ?? {}) as Record<string, unknown>;

  const product =
    (typeof sa.product === 'string' && sa.product) ||
    (typeof analysis.product === 'string' && analysis.product) ||
    null;
  const videoType =
    (typeof sa.video_type === 'string' && sa.video_type) ||
    (typeof analysis.ad_type === 'string' && analysis.ad_type) ||
    null;
  // For images use the overall scorecard (or stopping power) as the headline score.
  const hookScore = isImage
    ? (typeof dashboard.overall_score === 'number'
        ? dashboard.overall_score
        : typeof dashboard.stopping_power_score === 'number'
          ? dashboard.stopping_power_score
          : null)
    : (typeof hook.effectiveness_score === 'number' ? hook.effectiveness_score : null);
  return { product, videoType, hookScore };
}

export async function saveCreative(
  sb: SupabaseClient,
  userId: string,
  brandId: string,
  body: SaveCreativeInput,
): Promise<SaveCreativeResult> {
  const id = crypto.randomUUID();

  // Upload preview thumbnail if provided (data URL -> storage object).
  let previewUrl: string | null = null;
  if (body.previewDataUrl) {
    const match = body.previewDataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    if (match) {
      const contentType = match[1];
      const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const buffer = Buffer.from(match[2], 'base64');
      const path = `${id}.${ext}`;
      const { error: upErr } = await sb.storage
        .from(PREVIEW_BUCKET)
        .upload(path, buffer, { contentType, upsert: true });
      if (!upErr) {
        previewUrl = sb.storage.from(PREVIEW_BUCKET).getPublicUrl(path).data.publicUrl;
      }
    }
  }
  if (!previewUrl && body.previewUrl) previewUrl = body.previewUrl;

  const analysis = body.analysis;
  const isImage = body.type === 'image';
  const { product, videoType, hookScore } = denormalizeAnalysis(analysis, isImage);

  // Video original (subido directo al bucket desde el cliente)
  let videoUrl: string | null = null;
  if (body.videoPath) {
    videoUrl = sb.storage.from('creative-videos').getPublicUrl(body.videoPath).data.publicUrl;
  }

  const adName = body.adName?.trim() || null;

  const { error } = await sb.from('creatives').insert({
    id,
    user_id: userId,
    brand_id: brandId,
    name: body.name || 'Creativo',
    type: body.type || 'video',
    preview_url: previewUrl,
    duration: body.duration ?? null,
    aspect_ratio: body.aspectRatio ?? null,
    transcript: body.transcript ?? null,
    analysis,
    meta_metrics: body.metaMetrics ?? null,
    product,
    video_type: videoType,
    hook_score: hookScore,
    video_url: videoUrl ?? body.videoUrlDirect ?? null,
    ad_name: adName,
    meta_ad_id: body.metaAdId ?? null,
    meta_video_id: body.metaVideoId ?? null,
    source: body.source ?? 'manual',
  });
  if (error) throw error;

  // Vínculo DURO por ad_id (barrido automático). No hay ambigüedad posible.
  let vinculado = false;
  if (body.metaAdId && brandId) {
    const { error: linkErr } = await sb
      .from('meta_ads')
      .update({ creative_id: id, analyzed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('brand_id', brandId)
      .eq('ad_id', body.metaAdId);
    vinculado = !linkErr;
  }

  // Fallback: match tolerante por nombre (flujo manual del Studio).
  if (!vinculado && adName && brandId) {
    const norm = (s: string) =>
      s.toLowerCase().replace(/\.(mp4|mov|webm|m4v|png|jpg|jpeg)$/i, '').replace(/\s+/g, ' ').trim();
    const { data: metaAds } = await sb
      .from('meta_ads')
      .select('id,name')
      .eq('brand_id', brandId);
    const target = norm(adName);
    const matchRow = (metaAds ?? []).find((m) => norm(m.name) === target);
    if (matchRow) {
      await sb
        .from('meta_ads')
        .update({ creative_id: id, updated_at: new Date().toISOString() })
        .eq('id', matchRow.id);
    }
  }

  return { id, preview_url: previewUrl, video_url: videoUrl ?? body.videoUrlDirect ?? null, product, video_type: videoType, hook_score: hookScore };
}
