// =============================================================================
// GET /api/meta/top?brand= — the 30 ads that took the most spend in the last
// 30 days, and where each one stands on its way into the brain:
//
//   analizado       the creative was analyzed; the brain has it
//   en_cola         the file is downloaded; the barrido will analyze it
//   por_descargar   the sync has not fetched the file yet (needs the token)
//   subir           Meta will not hand the file over (no page access, or the
//                   download failed 3 times) — upload it by hand
//
// This is THE list: the policy is "always the top 30 of the last 30 days",
// same window the Library defaults to, anchored on the last synced day.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { fetchAll } from '@/lib/fetch-all';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow } from '@/lib/metrics';

export const runtime = 'nodejs';

export const TOP_N = 30;
export const TOP_WINDOW_DAYS = 30;

export type TopState = 'analizado' | 'en_cola' | 'por_descargar' | 'subir';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const sb = getSupabase();

  const { data: last } = await sb.from('ad_daily').select('date').eq('brand_id', brandId).order('date', { ascending: false }).limit(1).maybeSingle();
  if (!last?.date) return NextResponse.json({ window: null, items: [] });
  const to = last.date as string;
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (TOP_WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);

  const rows = (await fetchAll(() => sb.from('ad_daily').select(AD_DAILY_COLUMNS).eq('brand_id', brandId).not('ad_id', 'is', null)
    .gte('date', from).lte('date', to).order('date').order('ad_id'))) as unknown as AdDailyRow[];
  const top = aggregateByAd(rows).filter((a) => a.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, TOP_N);
  const ids = top.map((a) => a.ad_id);

  const { data: metas } = ids.length
    ? await sb.from('meta_ads').select('id,ad_id,asset_kind,asset_url,asset_error,asset_strategy,thumbnail_url,queue_status,queue_attempts,queue_error,creative_id,analyzed_at,video_id')
      .eq('brand_id', brandId).in('ad_id', ids)
    : { data: [] };
  const byAd = new Map((metas ?? []).map((m) => [m.ad_id as string, m]));

  const items = top.map((a, i) => {
    const m = byAd.get(a.ad_id);
    const kindHint = String(m?.asset_kind ?? '').toLowerCase();
    const playRatio = a.impressions && a.plays ? a.plays / a.impressions : 0;
    const kind: 'video' | 'image' = kindHint === 'video' || (kindHint !== 'image' && (Boolean(m?.video_id) || playRatio >= 0.4)) ? 'video' : 'image';
    let state: TopState;
    let reason: string | null = null;
    if (m?.analyzed_at || m?.creative_id || m?.queue_status === 'listo') state = 'analizado';
    else if (m?.asset_url && (m.queue_status === 'pendiente' || m.queue_status == null || (m.queue_status === 'error' && (m.queue_attempts ?? 0) < 3))) state = 'en_cola';
    else if (m?.asset_kind === 'none' || m?.asset_error || (m?.queue_status === 'error' && (m.queue_attempts ?? 0) >= 3)) {
      state = 'subir';
      reason = (m?.asset_error as string | null) ?? (m?.queue_error as string | null) ?? 'Meta no entregó el archivo';
    } else state = 'por_descargar';
    return {
      rank: i + 1, ad_id: a.ad_id, ad_name: a.ad_name, meta_id: m?.id ?? null, kind,
      spend: a.spend, purchases: a.purchases, roas: a.roas, cpa: a.cpa,
      thumbnail_url: m?.thumbnail_url ?? null, has_asset: Boolean(m?.asset_url), manual: m?.asset_strategy === 'manual',
      state, reason,
    };
  });

  const counts = items.reduce<Record<TopState, number>>((acc, x) => { acc[x.state]++; return acc; }, { analizado: 0, en_cola: 0, por_descargar: 0, subir: 0 });
  return NextResponse.json({ window: { from, to, days: TOP_WINDOW_DAYS, n: TOP_N }, items, counts });
}
