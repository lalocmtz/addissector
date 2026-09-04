// =============================================================================
// GET /api/library?brand= — every Meta ad of the brand as one row: the asset,
// lifetime and last-14-day numbers, its place in the taxonomy, its dimensions,
// and whether an analysis exists. The ad_id is the row; names are attributes.
// Sorted by spend, because spend is the account's own ranking of what mattered.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { fetchAll } from '@/lib/fetch-all';
import { resolveEconomics, verdictFor } from '@/lib/meta';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow } from '@/lib/metrics';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Missing brand' }, { status: 400 });
  const sb = getSupabase();

  const [brandRes, accountRes, daily, metaAds, dims, creatives, personas, angles, concepts, variants] = await Promise.all([
    sb.from('brands').select('economics').eq('id', brandId).eq('user_id', user.id).single(),
    sb.from('ad_account').select('currency').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle(),
    fetchAll(() => sb.from('ad_daily').select(AD_DAILY_COLUMNS).eq('brand_id', brandId).not('ad_id', 'is', null).order('date').order('ad_id')),
    fetchAll(() => sb.from('meta_ads').select('id,ad_id,name,status,created_date,asset_kind,asset_url,thumbnail_url,media_url,media_type,duration,creative_id,dossier_video,dossier_meta,fusion_at,persona_id,angle_id,concept_id,taxonomy_source,taxonomy_confidence,classified_at').eq('brand_id', brandId).not('ad_id', 'is', null).order('ad_id')),
    fetchAll(() => sb.from('ad_dimension').select('ad_id,creative_id,dimension,value,confidence,hook_id').eq('brand_id', brandId).order('id')),
    fetchAll(() => sb.from('creatives').select('id,name,ad_name,meta_ad_id,type,hook_score,video_url,preview_url').eq('user_id', user.id).eq('brand_id', brandId).order('id')),
    fetchAll(() => sb.from('personas').select('id,name').eq('brand_id', brandId).order('id')),
    fetchAll(() => sb.from('angles').select('id,code,name').eq('brand_id', brandId).order('id')),
    fetchAll(() => sb.from('concepts').select('id,code,name').eq('brand_id', brandId).order('id')),
    fetchAll(() => sb.from('experiment_variant').select('meta_ad_id,experiment_id,concept_id').eq('brand_id', brandId).not('meta_ad_id', 'is', null).order('id')),
  ]);
  if (!brandRes.data) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  const eco = resolveEconomics(brandRes.data.economics);
  const currency = accountRes.data?.currency ?? null;

  const rows = daily as unknown as AdDailyRow[];
  const lifetime = aggregateByAd(rows);
  const lastDate = rows.length ? rows[rows.length - 1].date : new Date().toISOString().slice(0, 10);
  const since14 = new Date(new Date(`${lastDate}T00:00:00Z`).getTime() - 13 * 86_400_000).toISOString().slice(0, 10);
  const recentById = new Map(aggregateByAd(rows.filter((r) => r.date >= since14)).map((a) => [a.ad_id, a]));

  const metaById = new Map(metaAds.map((m) => [m.ad_id as string, m]));
  const creativeByMeta = new Map(creatives.filter((c) => c.meta_ad_id).map((c) => [c.meta_ad_id as string, c]));
  const creativeById = new Map(creatives.map((c) => [c.id, c]));
  const name = { persona: new Map(personas.map((p) => [p.id, p.name])), angle: new Map(angles.map((a) => [a.id, a.code ? `${a.code} ${a.name}` : a.name])), concept: new Map(concepts.map((c) => [c.id, c.code ? `${c.code} ${c.name}` : c.name])) };
  const dimsByAd = new Map<string, Record<string, string>>(), dimsByCreative = new Map<string, Record<string, string>>();
  for (const d of dims) {
    const target = d.ad_id ? dimsByAd : dimsByCreative; const key = (d.ad_id ?? d.creative_id) as string;
    const o = target.get(key) ?? {}; o[d.dimension] = d.value; target.set(key, o);
  }
  const variantByAd = new Map(variants.map((v) => [v.meta_ad_id as string, v]));

  const ads = lifetime.map((a) => {
    const m = metaById.get(a.ad_id);
    const creative = creativeByMeta.get(a.ad_id) ?? (m?.creative_id ? creativeById.get(m.creative_id) : undefined);
    const dimensions = dimsByAd.get(a.ad_id) ?? (creative ? dimsByCreative.get(creative.id) : undefined) ?? {};
    const recent = recentById.get(a.ad_id);
    const v = variantByAd.get(a.ad_id);
    return {
      ad_id: a.ad_id, ad_name: a.ad_name, status: a.status, first_date: a.first_date, last_date: a.last_date, days: a.days,
      spend: a.spend, revenue: a.revenue, purchases: a.purchases, roas: a.roas, cpa: a.cpa, hook_rate: a.hook_rate, hold_rate: a.hold_rate, ret75: a.ret75, cvr: a.cvr,
      recent: recent ? { spend: recent.spend, roas: recent.roas, hook_rate: recent.hook_rate } : null,
      verdict: verdictFor(a, eco, currency).id,
      asset_kind: m?.asset_kind ?? m?.media_type ?? null, asset_url: m?.asset_url ?? m?.media_url ?? null, thumbnail_url: m?.thumbnail_url ?? creative?.preview_url ?? null, duration: m?.duration ?? null,
      creative_id: creative?.id ?? null, creative_type: creative?.type ?? null, analyzed: Boolean(creative) || Boolean(m?.dossier_video), has_dossier: Boolean(m?.dossier_video || m?.dossier_meta),
      persona_id: m?.persona_id ?? null, angle_id: m?.angle_id ?? null, concept_id: m?.concept_id ?? v?.concept_id ?? null,
      persona: m?.persona_id ? name.persona.get(m.persona_id) ?? null : null,
      angle: m?.angle_id ? name.angle.get(m.angle_id) ?? null : null,
      concept: (m?.concept_id ?? v?.concept_id) ? name.concept.get((m?.concept_id ?? v?.concept_id) as string) ?? null : null,
      taxonomy_source: m?.taxonomy_source ?? null, taxonomy_confidence: m?.taxonomy_confidence ?? null,
      experiment_id: v?.experiment_id ?? null,
      dimensions,
    };
  }).sort((a, b) => b.spend - a.spend);

  return NextResponse.json({ ads, currency, economics: eco, memoryTo: lastDate, personas, angles, concepts });
}
