// =============================================================================
// GET /api/strategy?brand= — the hierarchy with rollups and derived status.
// Every number comes from ad_daily keyed by ad_id; every status is derived.
// Persists angle/concept derived_status so other screens can read it cheaply.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { fetchAll } from '@/lib/fetch-all';
import { resolveEconomics } from '@/lib/meta';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow, type AdAggregate } from '@/lib/metrics';
import { rollupOf, deriveStatus, resolveMerged, type Rollup, type DerivedStatus } from '@/lib/strategy';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PERSONA_SELECT = 'id,name,description,pains,desires,objections,status,source,review_status,merged_into,created_at';
const ANGLE_SELECT = 'id,code,name,persona_id,pain,desire,mechanism,psychology,objection,awareness_stage,funnel_stage,status,derived_status,priority,source,review_status,merged_into,created_at';
const CONCEPT_SELECT = 'id,number,code,name,angle_id,persona_id,narrative_format,hypothesis,offer,status,derived_status,origin,origin_ad_id,owner_id,review_status,merged_into,created_at';
const HOOK_SELECT = 'id,title,body,hook_type,status,source,ad_ids,review_status,merged_into,created_at';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Missing brand' }, { status: 400 });
  const sb = getSupabase();

  const [brandRes, accountRes, personas, angles, concepts, hooks, metaAds, variants, daily] = await Promise.all([
    sb.from('brands').select('economics').eq('id', brandId).eq('user_id', user.id).single(),
    sb.from('ad_account').select('currency').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle(),
    fetchAll(() => sb.from('personas').select(PERSONA_SELECT).eq('brand_id', brandId).eq('user_id', user.id).order('created_at')),
    fetchAll(() => sb.from('angles').select(ANGLE_SELECT).eq('brand_id', brandId).eq('user_id', user.id).order('created_at')),
    fetchAll(() => sb.from('concepts').select(CONCEPT_SELECT).eq('brand_id', brandId).eq('user_id', user.id).order('number', { ascending: false })),
    fetchAll(() => sb.from('hook').select(HOOK_SELECT).eq('brand_id', brandId).eq('user_id', user.id).order('created_at')),
    fetchAll(() => sb.from('meta_ads').select('ad_id,name,persona_id,angle_id,concept_id,taxonomy_source,taxonomy_confidence,creative_id,thumbnail_url').eq('brand_id', brandId).not('ad_id', 'is', null).order('ad_id')),
    fetchAll(() => sb.from('experiment_variant').select('meta_ad_id,concept_id,experiment_id').eq('brand_id', brandId).not('meta_ad_id', 'is', null).order('id')),
    fetchAll(() => sb.from('ad_daily').select(AD_DAILY_COLUMNS).eq('brand_id', brandId).not('ad_id', 'is', null).order('date').order('ad_id')),
  ]);
  if (!brandRes.data) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  const eco = resolveEconomics(brandRes.data.economics);
  const currency = accountRes.data?.currency ?? null;

  const rows = daily as unknown as AdDailyRow[];
  const lifetime = aggregateByAd(rows);
  const lastDate = rows.length ? rows[rows.length - 1].date : new Date().toISOString().slice(0, 10);
  const since14 = new Date(new Date(`${lastDate}T00:00:00Z`).getTime() - 13 * 86_400_000).toISOString().slice(0, 10);
  const recent = aggregateByAd(rows.filter((r) => r.date >= since14));
  const byId = new Map(lifetime.map((a) => [a.ad_id, a]));
  const recentById = new Map(recent.map((a) => [a.ad_id, a]));

  // Merge pointers: an ad tagged with a merged entity counts for the survivor.
  const pMap = resolveMerged(personas as never[]), aMap = resolveMerged(angles as never[]), cMap = resolveMerged(concepts as never[]);
  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const angleById = new Map(angles.map((a) => [a.id, a]));

  // Attribution: ad → concept / angle / persona (hierarchy fills the gaps).
  const conceptAds = new Map<string, Set<string>>(), angleAds = new Map<string, Set<string>>(), personaAds = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string | null | undefined, adId: string) => { if (!k) return; const s = m.get(k) ?? new Set<string>(); s.add(adId); m.set(k, s); };
  const assigned = new Set<string>();
  const attribute = (adId: string, conceptId: string | null, angleId: string | null, personaId: string | null) => {
    const c = conceptId ? cMap.get(conceptId) ?? conceptId : null;
    const concept = c ? conceptById.get(c) : null;
    const a = angleId ? aMap.get(angleId) ?? angleId : concept?.angle_id ? aMap.get(concept.angle_id) ?? concept.angle_id : null;
    const angle = a ? angleById.get(a) : null;
    const p = personaId ? pMap.get(personaId) ?? personaId : angle?.persona_id ? pMap.get(angle.persona_id) ?? angle.persona_id : concept?.persona_id ? pMap.get(concept.persona_id) ?? concept.persona_id : null;
    add(conceptAds, c, adId); add(angleAds, a, adId); add(personaAds, p, adId);
    if (c || a || p) assigned.add(adId);
  };
  for (const m of metaAds) attribute(m.ad_id as string, m.concept_id, m.angle_id, m.persona_id);
  for (const v of variants) attribute(v.meta_ad_id as string, v.concept_id, null, null);

  const aggs = (ids: Set<string> | undefined, src: Map<string, AdAggregate>) => [...(ids ?? [])].map((id) => src.get(id)).filter((x): x is AdAggregate => Boolean(x));
  const judge = (ids: Set<string> | undefined): { rollup: Rollup; recent: Rollup; derived: DerivedStatus; ad_ids: string[] } => {
    const life = rollupOf(aggs(ids, byId)), rec = rollupOf(aggs(ids, recentById));
    return { rollup: life, recent: rec, derived: deriveStatus(life, rec, eco), ad_ids: [...(ids ?? [])] };
  };

  const conceptRows = concepts.map((c) => ({ ...c, ...judge(conceptAds.get(c.id)) }));
  const angleRows = angles.map((a) => ({ ...a, ...judge(angleAds.get(a.id)), concepts: conceptRows.filter((c) => c.angle_id === a.id).length }));
  const personaRows = personas.map((p) => ({ ...p, ...judge(personaAds.get(p.id)), angles: angleRows.filter((a) => a.persona_id === p.id).length }));

  // Persist derived status where it changed (angles, concepts).
  const now = new Date().toISOString();
  await Promise.all([
    ...angleRows.filter((a) => a.derived_status !== a.derived).map((a) => sb.from('angles').update({ derived_status: a.derived, updated_at: now }).eq('id', a.id)),
    ...conceptRows.filter((c) => c.derived_status !== c.derived).map((c) => sb.from('concepts').update({ derived_status: c.derived, updated_at: now }).eq('id', c.id)),
  ]);

  const unassigned = lifetime.filter((a) => !assigned.has(a.ad_id)).sort((a, b) => b.spend - a.spend);
  const proposals = {
    personas: personaRows.filter((p) => p.review_status === 'proposed').length,
    angles: angleRows.filter((a) => a.review_status === 'proposed').length,
    concepts: conceptRows.filter((c) => c.review_status === 'proposed').length,
    hooks: hooks.filter((h) => h.review_status === 'proposed').length,
  };

  return NextResponse.json({
    economics: eco, currency, memoryTo: lastDate,
    personas: personaRows, angles: angleRows, concepts: conceptRows,
    hooks: hooks.map((h) => ({ ...h, rollup: rollupOf(aggs(new Set(h.ad_ids as string[]), byId)) })),
    unassigned: { count: unassigned.length, spend: unassigned.reduce((s, a) => s + a.spend, 0), top: unassigned.slice(0, 30).map((a) => ({ ad_id: a.ad_id, ad_name: a.ad_name, spend: a.spend, roas: a.roas, hook_rate: a.hook_rate })) },
    proposals,
    ads: { total: lifetime.length, assigned: assigned.size },
  });
}
