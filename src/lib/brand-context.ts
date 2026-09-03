// =============================================================================
// Brand context for the AI (server-side).
//
// Assembles: economics (in the account currency), the last 30 days of real
// performance keyed by ad_id (winners / losers with hook, hold, retention, CVR,
// frequency), the transcribed scripts and dossiers of those ads, the
// STRUCTURED engine (personas, angles, concepts, planned ads) that the ingest
// writes, the accumulated learnings, research notes and external documents.
// Every query is scoped by brand_id AND user_id.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { verdictFor, resolveEconomics, fmtMoney, type Economics } from '@/lib/meta';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow, type AdAggregate } from '@/lib/metrics';
import { fetchAll } from '@/lib/fetch-all';

export interface BrandContextMeta {
  currency: string | null;
  eco: Economics;
  winners: AdAggregate[];
  losers: AdAggregate[];
}

export async function buildBrandContext(
  sb: SupabaseClient,
  userId: string,
  brandId: string,
): Promise<string> {
  return (await buildBrandContextWithMeta(sb, userId, brandId)).text;
}

export async function buildBrandContextWithMeta(
  sb: SupabaseClient,
  userId: string,
  brandId: string,
): Promise<{ text: string; meta: BrandContextMeta }> {
  const own = { brand_id: brandId, user_id: userId };

  const [brandRes, accountRes, brainRes, learningsRes, notesRes, docsRes, personasRes, anglesRes, conceptsRes, plannedRes, hooksRes] = await Promise.all([
    sb.from('brands').select('name,product,tone,economics').eq('id', brandId).eq('user_id', userId).single(),
    sb.from('ad_account').select('currency,timezone').eq('brand_id', brandId).eq('active', true).order('created_at').limit(1).maybeSingle(),
    sb.from('brain_sections').select('title,content').match(own).order('sort'),
    sb.from('learnings').select('text,evidence,source_ad').match(own).eq('active', true).order('created_at', { ascending: false }).limit(30),
    sb.from('research_notes').select('kind,title,body,status').match(own).neq('status', 'descartado').order('created_at', { ascending: false }).limit(25),
    sb.from('brand_docs').select('filename,extracted_text').match(own).order('created_at', { ascending: false }).limit(12),
    sb.from('personas').select('id,name,description,pains,desires,objections,awareness_stage,status').match(own).order('created_at'),
    sb.from('angles').select('id,code,name,persona_id,pain,desire,mechanism,psychology,objection,awareness_stage,status,priority,evidence').match(own).order('created_at'),
    sb.from('concepts').select('id,code,name,angle_id,persona_id,narrative_format,hypothesis,status,origin').match(own).order('number'),
    sb.from('experiment_variant').select('ad_name,meta_ad_id,concept_id,experiment_id,status,hook,format').match(own).order('created_at'),
    sb.from('hook').select('id,title,status,ad_ids').match(own).order('created_at', { ascending: false }).limit(40),
  ]);

  const brand = brandRes.data;
  const eco = resolveEconomics(brand?.economics);
  const currency: string | null = accountRes.data?.currency ?? null;
  const money = (n: number) => fmtMoney(n, currency);

  // Last 30 days of Meta data, keyed by ad_id
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const daily = await fetchAll(() => sb
    .from('ad_daily')
    .select(AD_DAILY_COLUMNS)
    .eq('brand_id', brandId)
    .not('ad_id', 'is', null)
    .gte('date', since.toISOString().slice(0, 10))
    .order('date').order('ad_id'));

  const ads = aggregateByAd(daily as unknown as AdDailyRow[]);
  const withVerdict = ads.map((a) => ({ a, v: verdictFor(a, eco, currency) }));
  const winners = withVerdict.filter((x) => x.v.id === 'ganador' || (x.v.id === 'prometedor' && x.a.spend >= eco.kill));
  const losers = withVerdict.filter((x) => (x.v.id === 'apagar' || x.v.id === 'dejar') && x.a.spend >= eco.kill).slice(0, 8);

  // Dossiers and linked creatives of the relevant ads — by ad_id
  const relevantIds = [...winners, ...losers].map((x) => x.a.ad_id).slice(0, 20);
  const { data: dims } = relevantIds.length
    ? await sb.from('meta_ads').select('ad_id,name,dossier_meta,dossier_video,creative_id').eq('brand_id', brandId).in('ad_id', relevantIds)
    : { data: [] as Array<{ ad_id: string; name: string; dossier_meta: string | null; dossier_video: string | null; creative_id: string | null }> };
  const dimById = new Map((dims ?? []).map((d) => [d.ad_id as string, d]));

  const creativeIds = (dims ?? []).map((d) => d.creative_id).filter(Boolean) as string[];
  const relevantNames = [...winners, ...losers].map((x) => x.a.ad_name).slice(0, 20);
  const [{ data: creativesById }, { data: creativesByMeta }, { data: creativesByName }] = await Promise.all([
    creativeIds.length ? sb.from('creatives').select('id,ad_name,name,meta_ad_id,transcript,analysis').in('id', creativeIds) : Promise.resolve({ data: [] }),
    relevantIds.length ? sb.from('creatives').select('id,ad_name,name,meta_ad_id,transcript,analysis').eq('brand_id', brandId).in('meta_ad_id', relevantIds) : Promise.resolve({ data: [] }),
    relevantNames.length ? sb.from('creatives').select('id,ad_name,name,meta_ad_id,transcript,analysis').eq('brand_id', brandId).in('ad_name', relevantNames) : Promise.resolve({ data: [] }),
  ]);
  type Cr = { id: string; ad_name: string | null; name: string | null; meta_ad_id: string | null; transcript: string | null; analysis: unknown };
  const creativeByAdId = new Map<string, Cr>();
  const creativeByCreativeId = new Map<string, Cr>();
  const creativeByName = new Map<string, Cr>();
  for (const c of [...((creativesById ?? []) as Cr[]), ...((creativesByMeta ?? []) as Cr[]), ...((creativesByName ?? []) as Cr[])]) {
    creativeByCreativeId.set(c.id, c);
    if (c.meta_ad_id) creativeByAdId.set(c.meta_ad_id, c);
    const key = c.ad_name || c.name;
    if (key && !creativeByName.has(key)) creativeByName.set(key, c);
  }

  const lines: string[] = [];
  lines.push(`# BRAND: ${brand?.name ?? 'Unnamed'}`);
  if (brand?.product) lines.push(`Product: ${brand.product}`);
  if (brand?.tone) lines.push(`Tone: ${brand.tone}`);
  lines.push(`Economics (account currency ${currency ?? 'unknown'}): break-even ROAS ${eco.breakeven} · target ROAS ${eco.target} · kill spend ${money(eco.kill)}. A winner = sustained spend + ROAS ≥ ${eco.target}.`);
  lines.push(`Metric definitions: hook rate = 3-second views / impressions · hold = ThruPlays / 3-second views · ret75 = viewers reaching 75% / 3-second views. All money in ${currency ?? 'the account currency'}.`);

  const brain = brainRes.data ?? [];
  if (brain.length) {
    lines.push('\n# BRAND BRAIN');
    for (const s of brain) if (s.content?.trim()) lines.push(`## ${s.title}\n${s.content.trim()}`);
  }

  // External layer: documents the owner uploaded. Another source, cited as such.
  const docs = docsRes.data ?? [];
  if (docs.length) {
    lines.push('\n# EXTERNAL BRAND DOCUMENTS (uploaded by the team — a different source from the ad data; cite as "according to your document X")');
    for (const d of docs) if (d.extracted_text?.trim()) lines.push(`## Document: ${d.filename}\n${d.extracted_text.trim().slice(0, 4000)}`);
  }

  // Structured engine — what the ingest writes and the chat could not see before.
  const personas = personasRes.data ?? [];
  const angles = anglesRes.data ?? [];
  const concepts = conceptsRes.data ?? [];
  const planned = plannedRes.data ?? [];
  if (personas.length || angles.length || concepts.length) {
    lines.push('\n# STRATEGY ENGINE (Persona → Angle → Concept → Ad). Cite ids when you refer to them.');
    if (personas.length) {
      lines.push('## Personas');
      for (const p of personas) lines.push(`- [${p.id}] ${p.name} (${p.status}) — ${p.description ?? ''}${p.pains ? ` · pains: ${String(p.pains).slice(0, 200)}` : ''}${p.desires ? ` · desires: ${String(p.desires).slice(0, 200)}` : ''}${p.objections ? ` · objections: ${String(p.objections).slice(0, 200)}` : ''}`);
    }
    if (angles.length) {
      lines.push('## Angles (pain/desire · product mechanism · objection it neutralizes · psychology)');
      for (const a of angles) lines.push(`- [${a.id}] ${a.code ?? ''} ${a.name} (${a.status}${a.priority ? `, priority ${a.priority}` : ''}) — pain: ${a.pain ?? '—'}${a.desire ? ` · desire: ${a.desire}` : ''} · mechanism: ${a.mechanism ?? '—'} · objection: ${a.objection ?? '—'}${a.psychology ? ` · psychology: ${String(a.psychology).slice(0, 200)}` : ''}${a.evidence ? ` · evidence: ${String(a.evidence).slice(0, 240)}` : ''}`);
    }
    if (concepts.length) {
      lines.push('## Concepts');
      for (const c of concepts) lines.push(`- [${c.id}] ${c.code ?? ''} ${c.name} (${c.status}, origin ${c.origin ?? 'manual'}) — angle ${c.angle_id ?? '—'} · format ${c.narrative_format ?? '—'} · hypothesis: ${c.hypothesis ?? '—'}`);
    }
    const hooks = hooksRes.data ?? [];
    if (hooks.length) {
      lines.push('## Hook bank');
      for (const h of hooks) lines.push(`- [${h.id}] ${h.title} (${h.status}${h.ad_ids?.length ? `, used in ${h.ad_ids.length} ads` : ''})`);
    }
    if (planned.length) {
      lines.push('## Planned ads (experiment variants)');
      for (const p of planned) lines.push(`- ${p.ad_name}${p.meta_ad_id ? ` (meta ad ${p.meta_ad_id})` : ' (not yet detected in Meta)'} · ${p.status} · concept ${p.concept_id}${p.hook ? ` · hook: ${String(p.hook).slice(0, 120)}` : ''}`);
    }
  }

  const fmtAd = (x: { a: AdAggregate; v: ReturnType<typeof verdictFor> }) => {
    const { a, v } = x;
    const parts = [
      `- "${a.ad_name}" (ad_id ${a.ad_id}) [${v.id}] spend ${money(a.spend)}, ROAS ${a.roas?.toFixed(2) ?? 'N/A'}, hook ${a.hook_rate?.toFixed(1) ?? 'N/A'}%, hold ${a.hold_rate?.toFixed(0) ?? 'N/A'}%, ret75 ${a.ret75?.toFixed(0) ?? 'N/A'}%, CVR ${a.cvr?.toFixed(2) ?? 'N/A'}%, freq ${a.freq?.toFixed(1) ?? 'N/A'} — ${v.why}`,
    ];
    const dim = dimById.get(a.ad_id);
    const cr = creativeByAdId.get(a.ad_id) ?? (dim?.creative_id ? creativeByCreativeId.get(dim.creative_id) : undefined) ?? creativeByName.get(a.ad_name);
    if (cr?.transcript) parts.push(`  SCRIPT: ${String(cr.transcript).slice(0, 900)}`);
    if (cr?.analysis) {
      const an = cr.analysis as Record<string, unknown>;
      const hook = (an.hook as Record<string, unknown>)?.analysis ?? (an.hook_analysis as string);
      if (hook) parts.push(`  HOOK (analysis): ${String(hook).slice(0, 400)}`);
    }
    if (dim?.dossier_video) parts.push(`  VIDEO DOSSIER: ${dim.dossier_video.slice(0, 700)}`);
    if (dim?.dossier_meta) parts.push(`  META AI DOSSIER: ${dim.dossier_meta.slice(0, 700)}`);
    return parts.join('\n');
  };

  if (winners.length) {
    lines.push('\n# ADS WORKING NOW (last 30 days, FACTS from Meta)');
    lines.push(...winners.slice(0, 12).map(fmtAd));
  }
  if (losers.length) {
    lines.push('\n# ADS THAT DID NOT WORK (do not repeat)');
    lines.push(...losers.map(fmtAd));
  }

  const learnings = learningsRes.data ?? [];
  if (learnings.length) {
    lines.push('\n# ACCUMULATED LEARNINGS');
    lines.push(...learnings.map((l) => `- ${l.text}${l.evidence ? ` (evidence: ${l.evidence})` : ''}${l.source_ad ? ` [${l.source_ad}]` : ''}`));
  }

  const notes = notesRes.data ?? [];
  if (notes.length) {
    lines.push('\n# RESEARCH NOTES');
    lines.push(...notes.map((n) => `- [${n.kind}/${n.status}] ${n.title}${n.body ? `: ${n.body.slice(0, 300)}` : ''}`));
  }

  return {
    text: lines.join('\n'),
    meta: { currency, eco, winners: winners.map((x) => x.a), losers: losers.map((x) => x.a) },
  };
}
