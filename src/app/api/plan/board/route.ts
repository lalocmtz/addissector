// =============================================================================
// /api/plan/board — El tablero. Aquí se cierra el círculo.
//
// Cruza lo que PLANEASTE (personas, ángulos, conceptos, anuncios planeados)
// con lo que PASÓ (meta_daily) usando el nombre del anuncio como llave, y
// devuelve rollups y rankings: qué ángulo está validado, qué formato narrativo
// funciona, qué concepto merece iteración y cuál nunca recibió gasto.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { aggregateAds, DEFAULT_ECONOMICS, type DailyRow, type Economics, type AdAggregate } from '@/lib/meta';
import { rollup, conceptVerdict, angleVerdict, type RollupMetrics } from '@/lib/plan';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const days = Math.max(1, Math.min(365, Number(request.nextUrl.searchParams.get('days') ?? 30)));

  const sb = getSupabase();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const [brandRes, personasRes, anglesRes, conceptsRes, plannedRes, dailyRes] = await Promise.all([
    sb.from('brands').select('name,economics').eq('id', brandId).single(),
    sb.from('personas').select('id,name,description,status').eq('brand_id', brandId).eq('user_id', user.id),
    sb.from('angles').select('id,code,name,persona_id,status,funnel_stage,priority,learnings').eq('brand_id', brandId).eq('user_id', user.id),
    sb.from('concepts').select('id,angle_id,persona_id,number,code,name,narrative_format,hypothesis,status,owner,target_assets,planned_for,origin,origin_ad_name,brief,do_not_change').eq('brand_id', brandId).eq('user_id', user.id).order('number', { ascending: false }),
    sb.from('planned_ads').select('id,concept_id,ad_name,variant,format,hook,status,owner,uploaded_at').eq('brand_id', brandId).eq('user_id', user.id),
    sb.from('meta_daily').select('ad_name,date,status,spend,revenue,roas,cpa,cpc,cpm,v3s,hook_rate,v25,v50,v75,freq,cost_atc,link_clicks,cvr,result_rate').eq('brand_id', brandId).gte('date', sinceStr).limit(30000),
  ]);

  const eco: Economics = { ...DEFAULT_ECONOMICS, ...((brandRes.data?.economics as Economics) ?? {}) };
  const personas = personasRes.data ?? [];
  const angles = anglesRes.data ?? [];
  const concepts = conceptsRes.data ?? [];
  const planned = plannedRes.data ?? [];

  // Datos reales de Meta, agregados por nombre de anuncio.
  const aggregates = aggregateAds((dailyRes.data ?? []) as DailyRow[]);
  const byName = new Map<string, AdAggregate>(aggregates.map((a) => [a.ad_name, a]));

  // --- Conceptos: rollup de sus anuncios planeados que YA tienen datos -------
  const plannedByConcept = new Map<string, typeof planned>();
  for (const p of planned) {
    const arr = plannedByConcept.get(p.concept_id ?? '') ?? [];
    arr.push(p);
    plannedByConcept.set(p.concept_id ?? '', arr);
  }

  const conceptRows = concepts.map((c) => {
    const ads = plannedByConcept.get(c.id) ?? [];
    const withData = ads.map((a) => byName.get(a.ad_name)).filter(Boolean) as AdAggregate[];
    const m = rollup(withData, ads.length);
    const v = conceptVerdict(m, eco);
    return {
      ...c,
      metrics: m,
      verdict: v,
      ads: ads.map((a) => {
        const agg = byName.get(a.ad_name);
        return {
          ...a,
          spend: agg?.spend ?? 0,
          roas: agg?.roas ?? null,
          hook_rate: agg?.hook_rate ?? null,
          purchases: agg?.purchases ?? 0,
          hasData: !!agg,
        };
      }),
    };
  });

  // --- Ángulos: rollup de todos los conceptos que cuelgan de él -------------
  const angleRows = angles.map((a) => {
    const cs = conceptRows.filter((c) => c.angle_id === a.id);
    const adNames = cs.flatMap((c) => c.ads.map((x) => x.ad_name));
    const withData = adNames.map((n) => byName.get(n)).filter(Boolean) as AdAggregate[];
    const m = rollup(withData, adNames.length);
    const tested = cs.filter((c) => c.metrics.spend >= eco.kill * 0.5).length;
    const best = cs
      .filter((c) => c.metrics.roas != null)
      .sort((x, y) => (y.metrics.roas ?? 0) - (x.metrics.roas ?? 0))[0];
    return {
      ...a,
      concepts: cs.length,
      conceptsTested: tested,
      metrics: m,
      verdict: angleVerdict(m, tested, eco),
      bestConcept: best ? { code: best.code, name: best.name, roas: best.metrics.roas } : null,
    };
  });

  // --- Anuncios de Meta que NO están planeados (huérfanos) ------------------
  const plannedNames = new Set(planned.map((p) => p.ad_name));
  const orphans = aggregates.filter((a) => !plannedNames.has(a.ad_name));
  const orphanMetrics = rollup(orphans);

  // --- Rankings -------------------------------------------------------------
  const minSpend = eco.kill * 0.5;
  const rankBy = <T extends { metrics: RollupMetrics }>(rows: T[]) =>
    rows
      .filter((r) => r.metrics.spend >= minSpend && r.metrics.roas != null)
      .sort((a, b) => (b.metrics.roas ?? 0) - (a.metrics.roas ?? 0));

  // Formato narrativo: agrupa conceptos por su formato y suma de verdad.
  const byFormat = new Map<string, AdAggregate[]>();
  const formatConcepts = new Map<string, number>();
  for (const c of conceptRows) {
    const f = c.narrative_format || 'Sin formato';
    const arr = byFormat.get(f) ?? [];
    for (const ad of c.ads) { const agg = byName.get(ad.ad_name); if (agg) arr.push(agg); }
    byFormat.set(f, arr);
    formatConcepts.set(f, (formatConcepts.get(f) ?? 0) + 1);
  }
  const formatRanking = [...byFormat.entries()]
    .map(([format, ads]) => ({ format, concepts: formatConcepts.get(format) ?? 0, metrics: rollup(ads) }))
    .filter((r) => r.metrics.spend >= minSpend)
    .sort((a, b) => (b.metrics.roas ?? 0) - (a.metrics.roas ?? 0));

  return NextResponse.json({
    economics: eco,
    brandName: brandRes.data?.name ?? null,
    days,
    personas,
    angles: angleRows,
    concepts: conceptRows,
    rankings: {
      angles: rankBy(angleRows).slice(0, 10),
      concepts: rankBy(conceptRows).slice(0, 10),
      formats: formatRanking,
    },
    unplanned: {
      count: orphans.length,
      metrics: orphanMetrics,
      /** Los huérfanos con más gasto: son los que urge mapear. */
      top: orphans.slice(0, 25).map((a) => ({
        ad_name: a.ad_name, spend: a.spend, roas: a.roas, hook_rate: a.hook_rate, purchases: a.purchases,
      })),
    },
  });
}
