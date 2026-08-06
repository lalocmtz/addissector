// =============================================================================
// AdDNA — Ensamblador del contexto de marca para la IA (server-side).
// Reúne: cerebro (secciones), economía, ganadores actuales con sus números,
// guiones/transcripts de creativos analizados, expedientes y aprendizajes.
// Este contexto es el que hace que los guiones nuevos salgan con retroalimentación real.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { aggregateAds, verdictFor, DEFAULT_ECONOMICS, type DailyRow, type Economics } from '@/lib/meta';

export async function buildBrandContext(
  sb: SupabaseClient,
  userId: string,
  brandId: string
): Promise<string> {
  const [brandRes, brainRes, learningsRes, notesRes] = await Promise.all([
    sb.from('brands').select('name,product,tone,economics').eq('id', brandId).single(),
    sb.from('brain_sections').select('title,content').eq('brand_id', brandId).order('sort'),
    sb.from('learnings').select('text,evidence,source_ad').eq('brand_id', brandId).eq('active', true).order('created_at', { ascending: false }).limit(30),
    sb.from('research_notes').select('kind,title,body,status').eq('brand_id', brandId).neq('status', 'descartado').order('created_at', { ascending: false }).limit(25),
  ]);

  const brand = brandRes.data;
  const eco: Economics = { ...DEFAULT_ECONOMICS, ...((brand?.economics as Economics) ?? {}) };

  // Últimos 30 días de datos de Meta
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().slice(0, 10);
  const { data: daily } = await sb
    .from('meta_daily')
    .select('ad_name,date,status,spend,revenue,roas,cpa,cpc,cpm,v3s,hook_rate,v25,v50,v75,freq,cost_atc,link_clicks,cvr,result_rate')
    .eq('brand_id', brandId)
    .gte('date', sinceStr)
    .limit(20000);

  const ads = aggregateAds((daily ?? []) as DailyRow[]);
  const withVerdict = ads.map((a) => ({ a, v: verdictFor(a, eco) }));
  const winners = withVerdict.filter((x) => x.v.id === 'ganador' || (x.v.id === 'prometedor' && x.a.spend >= eco.kill));
  const losers = withVerdict.filter((x) => (x.v.id === 'apagar' || x.v.id === 'dejar') && x.a.spend >= eco.kill).slice(0, 8);

  // Expedientes y creativos vinculados de los relevantes
  const relevantNames = [...winners, ...losers].map((x) => x.a.ad_name).slice(0, 20);
  const { data: dims } = relevantNames.length
    ? await sb.from('meta_ads').select('name,dossier_meta,dossier_video,creative_id').eq('brand_id', brandId).in('name', relevantNames)
    : { data: [] as Array<{ name: string; dossier_meta: string | null; dossier_video: string | null; creative_id: string | null }> };
  const dimMap = new Map((dims ?? []).map((d) => [d.name, d]));

  const creativeIds = (dims ?? []).map((d) => d.creative_id).filter(Boolean) as string[];
  const { data: creativesById } = creativeIds.length
    ? await sb.from('creatives').select('id,ad_name,name,transcript,analysis').in('id', creativeIds)
    : { data: [] };
  const { data: creativesByName } = relevantNames.length
    ? await sb.from('creatives').select('id,ad_name,name,transcript,analysis').eq('brand_id', brandId).in('ad_name', relevantNames)
    : { data: [] };
  const creativeMap = new Map<string, { transcript: string | null; analysis: unknown }>();
  for (const c of [...(creativesById ?? []), ...(creativesByName ?? [])]) {
    const key = (c.ad_name as string) || (c.name as string);
    if (key && !creativeMap.has(key)) creativeMap.set(key, { transcript: c.transcript, analysis: c.analysis });
  }

  const lines: string[] = [];
  lines.push(`# MARCA: ${brand?.name ?? 'Sin nombre'}`);
  if (brand?.product) lines.push(`Producto: ${brand.product}`);
  if (brand?.tone) lines.push(`Tono: ${brand.tone}`);
  lines.push(`Economía: moneda ${eco.currency} · breakeven ROAS ${eco.breakeven} · meta ROAS ${eco.target} · kill spend ${eco.kill}. Definición de ganador: mucho gasto sostenido + ROAS ≥ ${eco.target}.`);

  const brain = brainRes.data ?? [];
  if (brain.length) {
    lines.push('\n# CEREBRO DE LA MARCA');
    for (const s of brain) {
      if (s.content?.trim()) lines.push(`## ${s.title}\n${s.content.trim()}`);
    }
  }

  const fmtAd = (x: { a: ReturnType<typeof aggregateAds>[number]; v: ReturnType<typeof verdictFor> }) => {
    const { a, v } = x;
    const parts = [
      `- "${a.ad_name}" [${v.label}] gasto $${Math.round(a.spend)}, ROAS ${a.roas?.toFixed(2) ?? 'N/D'}, hook ${a.hook_rate?.toFixed(1) ?? 'N/D'}%, ret75 ${a.ret75?.toFixed(0) ?? 'N/D'}%, CVR ${a.cvr?.toFixed(2) ?? 'N/D'}%, frec ${a.freq?.toFixed(1) ?? 'N/D'} — ${v.why}`,
    ];
    const dim = dimMap.get(a.ad_name);
    const cr = creativeMap.get(a.ad_name);
    if (cr?.transcript) parts.push(`  GUION: ${String(cr.transcript).slice(0, 900)}`);
    if (cr?.analysis) {
      const an = cr.analysis as Record<string, unknown>;
      const hook = (an.hook as Record<string, unknown>)?.analysis ?? (an.hook_analysis as string);
      if (hook) parts.push(`  HOOK (análisis): ${String(hook).slice(0, 400)}`);
    }
    if (dim?.dossier_video) parts.push(`  EXPEDIENTE VIDEO: ${dim.dossier_video.slice(0, 700)}`);
    if (dim?.dossier_meta) parts.push(`  EXPEDIENTE META IA: ${dim.dossier_meta.slice(0, 700)}`);
    return parts.join('\n');
  };

  if (winners.length) {
    lines.push('\n# ANUNCIOS QUE ESTÁN FUNCIONANDO AHORA (últimos 30 días)');
    lines.push(...winners.slice(0, 12).map(fmtAd));
  }
  if (losers.length) {
    lines.push('\n# ANUNCIOS QUE NO FUNCIONARON (para no repetir)');
    lines.push(...losers.map(fmtAd));
  }

  const learnings = learningsRes.data ?? [];
  if (learnings.length) {
    lines.push('\n# APRENDIZAJES ACUMULADOS');
    lines.push(...learnings.map((l) => `- ${l.text}${l.evidence ? ` (evidencia: ${l.evidence})` : ''}${l.source_ad ? ` [${l.source_ad}]` : ''}`));
  }

  const notes = notesRes.data ?? [];
  if (notes.length) {
    lines.push('\n# RESEARCH CREATIVO (banco de ángulos)');
    lines.push(...notes.map((n) => `- [${n.kind}/${n.status}] ${n.title}${n.body ? `: ${n.body.slice(0, 300)}` : ''}`));
  }

  return lines.join('\n');
}
