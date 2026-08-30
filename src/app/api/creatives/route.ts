import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, PREVIEW_BUCKET, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// GET /api/creatives — biblioteca del usuario (filtrable por marca: ?brand=id)
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ creatives: [], configured: false });
  }
  try {
    const sb = getSupabase();
    let query = sb
      .from('creatives')
      .select('id,name,type,preview_url,created_at,product,video_type,hook_score,brand_id,ad_name,video_url')
      .order('created_at', { ascending: false });

    if (isAuthConfigured()) {
      const user = await getSessionUser();
      if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
      query = query.eq('user_id', user.id);

      const brandId = request.nextUrl.searchParams.get('brand');
      if (brandId) query = query.eq('brand_id', brandId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ creatives: data ?? [], configured: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error listando creativos';
    return NextResponse.json({ error: message, creatives: [] }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/creatives — guardar un creativo en la marca activa del usuario
// ---------------------------------------------------------------------------
interface SaveBody {
  name?: string;
  type?: 'video' | 'image';
  brandId?: string | null;
  previewDataUrl?: string | null;
  duration?: number | null;
  aspectRatio?: string | null;
  transcript?: string | null;
  analysis: Record<string, unknown>;
  metaMetrics?: Record<string, unknown> | null;
  /** Ruta del video original ya subido al bucket creative-videos (upload directo). */
  videoPath?: string | null;
  /** Nombre EXACTO del anuncio en Meta para cruzar métricas y marcarlo como analizado. */
  adName?: string | null;
  /** Vínculo DURO con Meta (viene del barrido automático): no depende del nombre. */
  metaAdId?: string | null;
  /** video_id de Meta: permite deduplicar cuando varios anuncios comparten video. */
  metaVideoId?: string | null;
  /** 'manual' (Studio) o 'auto' (barrido desde la API). */
  source?: 'manual' | 'auto' | null;
  /** URL pública del asset ya alojado, cuando el barrido lo subió al bucket. */
  videoUrlDirect?: string | null;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase no está configurado', configured: false },
      { status: 501 }
    );
  }
  try {
    const body = (await request.json()) as SaveBody;
    if (!body.analysis) {
      return NextResponse.json({ error: 'Falta el análisis' }, { status: 400 });
    }

    let userId: string | null = null;
    if (isAuthConfigured()) {
      const user = await getSessionUser();
      if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
      userId = user.id;
    }

    const sb = getSupabase();
    const id = crypto.randomUUID();

    // Valida que la marca pertenezca al usuario.
    let brandId: string | null = null;
    if (body.brandId && userId) {
      const { data: brand } = await sb
        .from('brands')
        .select('id')
        .eq('id', body.brandId)
        .eq('user_id', userId)
        .maybeSingle();
      brandId = brand?.id ?? null;
    }

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

    const analysis = body.analysis as Record<string, unknown>;
    const isImage = body.type === 'image';

    // Denormalize a few columns for the library grid. Videos and images store
    // their headline metrics in different blocks, so fall back across both.
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

    return NextResponse.json({ id, preview_url: previewUrl, video_url: videoUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error guardando el creativo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
