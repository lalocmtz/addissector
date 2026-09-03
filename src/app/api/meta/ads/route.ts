// =============================================================================
// GET /api/meta/ads?brand=&from=&to=[&ad=<ad_id>]
//
// Per-ad aggregates over a date range (or the daily series of one ad with
// ?ad=). Everything is keyed by the Meta ad_id; the name is an attribute.
// Returns the account currency so the client never guesses a symbol.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow } from '@/lib/metrics';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const brandId = sp.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Missing brand' }, { status: 400 });
  const from = sp.get('from');
  const to = sp.get('to');
  const adId = sp.get('ad');

  const sb = getSupabase();

  // Brand must belong to the user (defense in depth: RLS is bypassed by the service role).
  const { data: brand } = await sb.from('brands').select('id').eq('id', brandId).eq('user_id', user.id).maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  const { data: account } = await sb
    .from('ad_account').select('ad_account_id,currency,currency_source,timezone,last_synced_at')
    .eq('brand_id', brandId).eq('active', true).order('created_at').limit(1).maybeSingle();

  let q = sb
    .from('ad_daily')
    .select(AD_DAILY_COLUMNS)
    .eq('brand_id', brandId)
    .not('ad_id', 'is', null)
    .order('date', { ascending: true })
    .limit(50000);
  if (from) q = q.gte('date', from);
  if (to) q = q.lte('date', to);
  if (adId) q = q.eq('ad_id', adId);

  const { data: daily, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (daily ?? []) as unknown as AdDailyRow[];

  // Daily series of one ad
  if (adId) {
    return NextResponse.json({ daily: rows, currency: account?.currency ?? null });
  }

  const ads = aggregateByAd(rows);

  // Ad dimension: dossier + linked creative, keyed by ad_id
  const { data: dims } = await sb
    .from('meta_ads')
    .select('id,ad_id,name,status,created_date,first_seen,last_seen,dossier_meta,dossier_video,creative_id,fusion,fusion_at,asset_kind,asset_url,thumbnail_url,media_url,media_type,duration')
    .eq('brand_id', brandId);
  const dimById = new Map((dims ?? []).map((d) => [d.ad_id as string, d]));

  // Library creatives: linked by meta_ad_id (pinned) → creative_id (dim) → name (legacy fallback)
  const { data: creatives } = await sb
    .from('creatives')
    .select('id,name,ad_name,meta_ad_id,type,hook_score,video_url')
    .eq('user_id', user.id)
    .eq('brand_id', brandId);
  const norm = (s: string) => s.toLowerCase().replace(/\.(mp4|mov|webm|m4v|png|jpg|jpeg)$/i, '').replace(/\s+/g, ' ').trim();
  const creativeByMetaId = new Map<string, { id: string; hook_score: number | null; video_url: string | null }>();
  const creativeByName = new Map<string, { id: string; hook_score: number | null; video_url: string | null }>();
  const creativeById = new Map<string, { id: string; hook_score: number | null; video_url: string | null }>();
  for (const c of creatives ?? []) {
    creativeById.set(c.id, c);
    if (c.meta_ad_id) creativeByMetaId.set(c.meta_ad_id, c);
    const key = c.ad_name || c.name;
    if (key) creativeByName.set(norm(key), c);
  }

  // Full memory range
  const [{ data: rangeMin }, { data: rangeMax }] = await Promise.all([
    sb.from('ad_daily').select('date').eq('brand_id', brandId).order('date', { ascending: true }).limit(1),
    sb.from('ad_daily').select('date').eq('brand_id', brandId).order('date', { ascending: false }).limit(1),
  ]);

  const enriched = ads.map((a) => {
    const dim = dimById.get(a.ad_id);
    const linked =
      creativeByMetaId.get(a.ad_id) ??
      (dim?.creative_id ? creativeById.get(dim.creative_id) : undefined) ??
      creativeByName.get(norm(a.ad_name));
    return {
      ...a,
      meta_id: dim?.id ?? null,
      created_date: dim?.created_date ?? null,
      dossier_meta: dim?.dossier_meta ?? null,
      dossier_video: dim?.dossier_video ?? null,
      creative_id: linked?.id ?? null,
      analyzed: Boolean(linked) || Boolean(dim?.dossier_video),
      has_dossier: Boolean(dim?.dossier_meta || dim?.dossier_video),
      fusion: dim?.fusion ?? null,
      fusion_at: dim?.fusion_at ?? null,
      asset_kind: dim?.asset_kind ?? dim?.media_type ?? null,
      asset_url: dim?.asset_url ?? dim?.media_url ?? null,
      thumbnail_url: dim?.thumbnail_url ?? null,
      duration: dim?.duration ?? null,
    };
  });

  return NextResponse.json({
    ads: enriched,
    currency: account?.currency ?? null,
    currencySource: account?.currency_source ?? null,
    timezone: account?.timezone ?? null,
    lastSyncedAt: account?.last_synced_at ?? null,
    memoryFrom: rangeMin?.[0]?.date ?? null,
    memoryTo: rangeMax?.[0]?.date ?? null,
  });
}
