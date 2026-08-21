// =============================================================================
// GET /api/meta/ads?brand=&from=&to=[&ad=] — agregados por anuncio en el rango
// (o serie diaria de un anuncio con ?ad=). Incluye expediente y vínculo con la
// Biblioteca para saber si el ganador ya fue analizado.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { aggregateAds, type DailyRow } from '@/lib/meta';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const brandId = sp.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const from = sp.get('from');
  const to = sp.get('to');
  const adName = sp.get('ad');

  const sb = getSupabase();

  let q = sb
    .from('meta_daily')
    .select('ad_name,date,status,spend,revenue,roas,cpa,cpc,cpm,v3s,hook_rate,v25,v50,v75,freq,cost_atc,link_clicks,cvr,result_rate')
    .eq('brand_id', brandId)
    .order('date', { ascending: true })
    .limit(20000);
  if (from) q = q.gte('date', from);
  if (to) q = q.lte('date', to);
  if (adName) q = q.eq('ad_name', adName);

  const { data: daily, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Serie diaria de un solo anuncio
  if (adName) {
    return NextResponse.json({ daily: daily ?? [] });
  }

  const ads = aggregateAds((daily ?? []) as DailyRow[]);

  // Dimensión: expediente + creativo vinculado
  const { data: dims } = await sb
    .from('meta_ads')
    .select('id,name,status,created_date,first_seen,last_seen,dossier_meta,dossier_video,creative_id,fusion,fusion_at,media_url,media_type,thumbnail_url')
    .eq('brand_id', brandId);
  const dimMap = new Map((dims ?? []).map((d) => [d.name, d]));

  // Creativos de la biblioteca vinculados por ad_name o por creative_id
  const { data: creatives } = await sb
    .from('creatives')
    .select('id,name,ad_name,type,hook_score,video_url')
    .eq('user_id', user.id)
    .eq('brand_id', brandId);

  // Match tolerante: mismo nombre con/sin extensión, may/min, espacios
  const norm = (s: string) =>
    s.toLowerCase().replace(/\.(mp4|mov|webm|m4v|png|jpg|jpeg)$/i, '').replace(/\s+/g, ' ').trim();
  const creativeByAd = new Map<string, { id: string; hook_score: number | null; video_url: string | null }>();
  for (const c of creatives ?? []) {
    if (c.ad_name) creativeByAd.set(norm(c.ad_name), c);
    else if (c.name) creativeByAd.set(norm(c.name), c);
  }
  const creativeById = new Map((creatives ?? []).map((c) => [c.id, c]));

  // Rango total disponible en la memoria
  const { data: range } = await sb
    .from('meta_daily')
    .select('date')
    .eq('brand_id', brandId)
    .order('date', { ascending: true })
    .limit(1);
  const { data: rangeMax } = await sb
    .from('meta_daily')
    .select('date')
    .eq('brand_id', brandId)
    .order('date', { ascending: false })
    .limit(1);

  const enriched = ads.map((a) => {
    const dim = dimMap.get(a.ad_name);
    const linked = (dim?.creative_id ? creativeById.get(dim.creative_id) : undefined) ?? creativeByAd.get(norm(a.ad_name));
    return {
      ...a,
      meta_id: dim?.id ?? null,
      created_date: dim?.created_date ?? null,
      dossier_meta: dim?.dossier_meta ?? null,
      dossier_video: dim?.dossier_video ?? null,
      creative_id: linked?.id ?? null,
      analyzed: Boolean(linked) || Boolean(dim?.dossier_video) || Boolean(dim?.fusion),
      has_dossier: Boolean(dim?.dossier_meta || dim?.dossier_video),
      fusion: dim?.fusion ?? null,
      fusion_at: dim?.fusion_at ?? null,
      media_url: dim?.media_url ?? null,
      media_type: dim?.media_type ?? null,
      thumbnail_url: dim?.thumbnail_url ?? null,
    };
  });

  return NextResponse.json({
    ads: enriched,
    memoryFrom: range?.[0]?.date ?? null,
    memoryTo: rangeMax?.[0]?.date ?? null,
  });
}
