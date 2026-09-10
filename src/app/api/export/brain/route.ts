// =============================================================================
// /api/export/brain?brand=&window=60
//   The brand's live signal as ONE markdown file for an external brain (Claude
//   Cowork / Code projects that read brand/ and data/). Nothing is computed by a
//   model: it is the same ad_daily arithmetic every screen uses, written down.
//
//   Sections mirror the Second Brain layout:
//     data/ad-performance.md   top ads by spend, with verdicts
//     brand/winning-ads.md     what won, what lost, and the angle behind each
//     data/voice-of-customer   hooks that ran (literal lines), learnings
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow } from '@/lib/metrics';
import { resolveEconomics } from '@/lib/meta';
import { fetchAll } from '@/lib/fetch-all';
import { verdictOf } from '@/lib/batch';

export const runtime = 'nodejs';
export const maxDuration = 60;

const r1 = (n: number | null | undefined, d = 2) => (n == null || !isFinite(n) ? '—' : n.toFixed(d));
const money = (n: number, cur: string | null) => `${Math.round(n).toLocaleString('en-US')} ${cur ?? ''}`.trim();

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Missing brand' }, { status: 400 });
  const windowDays = Math.min(Math.max(Number(request.nextUrl.searchParams.get('window') ?? 60), 7), 365);
  const top = Math.min(Math.max(Number(request.nextUrl.searchParams.get('top') ?? 30), 5), 100);
  const since = new Date(Date.now() - windowDays * 864e5).toISOString().slice(0, 10);

  const sb = getSupabase();
  const [brandRes, accRes, angleRes, personaRes, adsRes, dimRes, learnRes, batchRes, pieceRes] = await Promise.all([
    sb.from('brands').select('name,economics,product,dna').eq('id', brandId).eq('user_id', user.id).maybeSingle(),
    sb.from('ad_account').select('currency').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle(),
    sb.from('angles').select('id,code,name,pain,desire,mechanism,awareness_stage,status,derived_status,personas(name)').eq('brand_id', brandId),
    sb.from('personas').select('name,description,pains,desires,objections,awareness_stage').eq('brand_id', brandId),
    sb.from('meta_ads').select('ad_id,angle_id,concept_id,analyzed_at,concepts(code,name)').eq('brand_id', brandId),
    sb.from('ad_dimension').select('ad_id,dimension,value').eq('brand_id', brandId),
    sb.from('learnings').select('text,evidence,kind,created_at').eq('brand_id', brandId).eq('active', true).order('created_at', { ascending: false }).limit(40),
    sb.from('experiment').select('code,name,variable,awareness,status,hypothesis,closed_note,close_reason,closed_at,angle_id').eq('brand_id', brandId).order('number'),
    sb.from('experiment_variant').select('experiment_id,ad_name,hook,format,verdict,meta_ad_id').eq('brand_id', brandId),
  ]);
  if (!brandRes.data) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  const brand = brandRes.data as { name: string; economics: unknown; product: string | null; dna: unknown };
  const cur = accRes.data?.currency ?? null;
  const eco = resolveEconomics(brand.economics);
  const angles = (angleRes.data ?? []) as unknown as Array<{ id: string; code: string | null; name: string; pain: string | null; desire: string | null; mechanism: string | null; awareness_stage: string | null; status: string | null; derived_status: string | null; personas: { name: string } | null }>;
  const angleById = new Map(angles.map((a) => [a.id, a]));
  const adMeta = new Map(((adsRes.data ?? []) as unknown as Array<{ ad_id: string; angle_id: string | null; concept_id: string | null; analyzed_at: string | null; concepts: { code: string | null; name: string } | null }>).map((m) => [m.ad_id, m]));
  const dims = new Map<string, Record<string, string>>();
  for (const d of (dimRes.data ?? []) as Array<{ ad_id: string; dimension: string; value: string }>) {
    (dims.get(d.ad_id) ?? dims.set(d.ad_id, {}).get(d.ad_id)!)[d.dimension] = d.value;
  }

  const daily = (await fetchAll(() =>
    sb.from('ad_daily').select(AD_DAILY_COLUMNS).eq('brand_id', brandId).gte('date', since).order('date').order('ad_id'),
  )) as unknown as AdDailyRow[];
  const aggs = aggregateByAd(daily).filter((a) => a.spend > 0);
  const spends = aggs.map((a) => a.spend).sort((x, y) => x - y);
  const medianSpend = spends.length ? (spends.length % 2 ? spends[(spends.length - 1) / 2] : (spends[spends.length / 2 - 1] + spends[spends.length / 2]) / 2) : 0;
  const totalSpend = aggs.reduce((s, a) => s + a.spend, 0);
  const totalRev = aggs.reduce((s, a) => s + (a.revenue ?? 0), 0);
  const totalBuys = aggs.reduce((s, a) => s + (a.purchases ?? 0), 0);

  const verdictOfAgg = (a: (typeof aggs)[number]) => verdictOf(
    { spend: a.spend, revenue: a.revenue, purchases: a.purchases, roas: a.roas, impressions: a.impressions, days: 0 }, eco, medianSpend,
  );
  const VERDICT_ES: Record<string, string> = { breakthrough: 'ESCALAR', kpi_winner: 'ITERAR', spend_winner: 'MANTENER', loser: 'ARCHIVAR' };

  const L: string[] = [];
  const p = (s = '') => L.push(s);
  const today = new Date().toISOString().slice(0, 10);
  p(`# ${brand.name} — señal viva de Meta Ads`);
  p(`_Exportado por AdDissector el ${today}. Ventana: últimos ${windowDays} días (desde ${since}). Moneda: ${cur ?? '?'}._`);
  p();
  p('> Regla de lectura: lo que no está en el top por gasto NO es "no funciona", es "sin señal" (Meta nunca lo financió). Los veredictos comparan cada anuncio contra la cuenta: ESCALAR = volumen y ROAS; ITERAR = ROAS sin volumen; MANTENER = volumen sin ROAS; ARCHIVAR = ninguno.');
  p();
  p('## Economía de la cuenta');
  p(`- Meta ROAS: ${eco.target}x · Breakeven: ${eco.breakeven}x · Gasto mínimo para juzgar: ${eco.kill}`);
  p(`- Gasto en ventana: ${money(totalSpend, cur)} · Ingresos atribuidos: ${money(totalRev, cur)} · ROAS: ${r1(totalSpend ? totalRev / totalSpend : null)}x · Compras: ${totalBuys} · CPA: ${totalBuys ? money(totalSpend / totalBuys, cur) : '—'}`);
  p(`- Anuncios con gasto: ${aggs.length} · Gasto mediano por anuncio: ${money(medianSpend, cur)}`);
  p();

  // ---- data/ad-performance.md ----------------------------------------------
  p(`## data/ad-performance.md — top ${top} por gasto`);
  p();
  p('| # | Anuncio | Gasto | ROAS | CPA | Hook % | Hold % | CVR % | Veredicto | Ángulo | Concepto | Formato | Conciencia |');
  p('|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---|---|');
  aggs.slice(0, top).forEach((a, i) => {
    const m = adMeta.get(a.ad_id); const d = dims.get(a.ad_id) ?? {};
    const ang = m?.angle_id ? angleById.get(m.angle_id)?.code ?? '' : '';
    const v = verdictOfAgg(a);
    p(`| ${i + 1} | ${a.ad_name.replace(/\|/g, '/')} | ${money(a.spend, cur)} | ${r1(a.roas)} | ${a.cpa != null ? money(a.cpa, cur) : '—'} | ${r1(a.hook_rate, 1)} | ${r1(a.hold_rate, 1)} | ${r1(a.cvr, 2)} | ${v ? VERDICT_ES[v] : 'sin señal'} | ${ang} | ${m?.concepts?.code ?? ''} | ${d.format ?? ''} | ${d.awareness_level ?? ''} |`);
  });
  p();

  // ---- brand/winning-ads.md ------------------------------------------------
  p('## brand/winning-ads.md — qué ganó, qué perdió y por qué');
  p();
  const judged = aggs.map((a) => ({ a, v: verdictOfAgg(a) })).filter((x) => x.v);
  const winners = judged.filter((x) => x.v === 'breakthrough' || x.v === 'kpi_winner').slice(0, 15);
  const losers = judged.filter((x) => x.v === 'loser').slice(0, 10);
  const describe = (a: (typeof aggs)[number]) => {
    const d = dims.get(a.ad_id) ?? {}; const m = adMeta.get(a.ad_id);
    const bits = [
      m?.angle_id ? `ángulo ${angleById.get(m.angle_id)?.code ?? ''}` : null,
      m?.concepts?.name ? `concepto "${m.concepts.name}"` : null,
      d.format ? `formato ${d.format}` : null, d.awareness_level ? `conciencia ${d.awareness_level}` : null,
      d.proof_type ? `prueba ${d.proof_type}` : null, d.offer ? `oferta ${d.offer}` : null,
      d.hook ? `hook: "${d.hook}"` : null,
    ].filter(Boolean);
    return bits.length ? bits.join(' · ') : 'sin clasificar (analizar en la Biblioteca)';
  };
  p('### Ganadores');
  if (!winners.length) p('_Ninguno en la ventana._');
  for (const { a, v } of winners) p(`- **${a.ad_name}** — ${money(a.spend, cur)}, ROAS ${r1(a.roas)}, CPA ${a.cpa != null ? money(a.cpa, cur) : '—'}, hook ${r1(a.hook_rate, 1)}%, CVR ${r1(a.cvr, 2)}% → ${VERDICT_ES[v!]}. ${describe(a)}`);
  p();
  p('### Perdedores financiados (útiles para contrastar)');
  if (!losers.length) p('_Ninguno en la ventana._');
  for (const { a } of losers) p(`- **${a.ad_name}** — ${money(a.spend, cur)}, ROAS ${r1(a.roas)}, CPA ${a.cpa != null ? money(a.cpa, cur) : '—'}, hook ${r1(a.hook_rate, 1)}%. ${describe(a)}`);
  p();

  // ---- angles by money -------------------------------------------------------
  p('### Ángulos, por dinero real');
  p();
  p('| Ángulo | Nombre | Conciencia | Anuncios | Gasto | ROAS | Estado |');
  p('|---|---|---|---:|---:|---:|---|');
  for (const ang of angles) {
    const mine = aggs.filter((a) => adMeta.get(a.ad_id)?.angle_id === ang.id);
    const sp = mine.reduce((s, a) => s + a.spend, 0); const rv = mine.reduce((s, a) => s + (a.revenue ?? 0), 0);
    p(`| ${ang.code ?? ''} | ${ang.name} | ${ang.awareness_stage ?? ''} | ${mine.length} | ${money(sp, cur)} | ${sp ? r1(rv / sp) : '—'} | ${mine.length ? (sp && rv / sp >= eco.target ? 'gana' : sp && rv / sp >= eco.breakeven ? 'sobrevive' : 'pierde') : 'sin probar'} |`);
  }
  p();
  p('### Ángulos (definición)');
  for (const ang of angles) p(`- **${ang.code ?? ''} · ${ang.name}** (${ang.personas?.name ?? 'sin persona'}, ${ang.awareness_stage ?? '?'}) — dolor: ${ang.pain ?? '—'}${ang.desire ? ` · deseo: ${ang.desire}` : ''}${ang.mechanism ? ` · mecanismo: ${ang.mechanism}` : ''}`);
  p();
  const personas = (personaRes.data ?? []) as Array<{ name: string; description: string | null; pains: string | null; desires: string | null; objections: string | null; awareness_stage: string | null }>;
  if (personas.length) {
    p('### Personas');
    for (const ps of personas) p(`- **${ps.name}** — ${ps.description ?? ''}${ps.pains ? ` · dolores: ${ps.pains}` : ''}${ps.desires ? ` · deseos: ${ps.desires}` : ''}${ps.objections ? ` · objeciones: ${ps.objections}` : ''}`);
    p();
  }

  // ---- tandas ----------------------------------------------------------------
  const batches = (batchRes.data ?? []) as Array<{ code: string; name: string; variable: string; awareness: string | null; status: string; hypothesis: string | null; closed_note: string | null; close_reason: string | null; closed_at: string | null; angle_id: string | null }>;
  const pieces = (pieceRes.data ?? []) as Array<{ experiment_id: string; ad_name: string; hook: string | null; format: string | null; verdict: string | null; meta_ad_id: string | null }>;
  if (batches.length) {
    p('## Tandas (qué se probó y qué se aprendió)');
    for (const b of batches) {
      const ang = b.angle_id ? angleById.get(b.angle_id)?.code ?? '' : '';
      p(`- **${b.code} · ${b.name}** — ${ang} · cambia: ${b.variable} · ${b.awareness ?? ''} · estado: ${b.status}${b.hypothesis ? ` · hipótesis: ${b.hypothesis}` : ''}${b.closed_note ? ` · aprendizaje: ${b.closed_note}` : ''}`);
    }
    p();
  }
  const hooksRan = pieces.filter((x) => x.meta_ad_id && x.hook);
  if (hooksRan.length) {
    p('## Hooks que ya corrieron (textuales)');
    for (const x of hooksRan) {
      const a = aggs.find((g) => g.ad_id === x.meta_ad_id);
      p(`- "${x.hook}" (${x.format ?? ''}) → ${a ? `${money(a.spend, cur)}, ROAS ${r1(a.roas)}, hook ${r1(a.hook_rate, 1)}%` : 'sin gasto en ventana'}${x.verdict ? ` · ${VERDICT_ES[x.verdict] ?? x.verdict}` : ''}`);
    }
    p();
  }
  const learnings = (learnRes.data ?? []) as Array<{ text: string; evidence: string | null; kind: string | null; created_at: string }>;
  if (learnings.length) {
    p('## Aprendizajes registrados');
    for (const l of learnings) p(`- ${l.text}${l.evidence ? ` _(evidencia: ${l.evidence})_` : ''}`);
    p();
  }
  p('---');
  p('Cómo usar este archivo con Claude: pégalo en `data/ad-performance.md` del brand brain (o adjúntalo al chat) y pide hooks, briefs o guiones "para los ángulos que ganan y contra los perdedores financiados".');

  const md = L.join('\n');
  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-brain-${today}.md"`,
    },
  });
}
