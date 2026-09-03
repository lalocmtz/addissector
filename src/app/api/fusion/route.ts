// =============================================================================
// POST /api/fusion — La mesa redonda: psicólogo + creative strategist +
// analista de marketing desmenuzan UN creativo fusionando su análisis de video
// (guion, tomas, hook) con sus números reales de Meta (hook rate, retención,
// CVR, serie diaria) y los benchmarks de la cuenta.
// Guarda el resultado en meta_ads.fusion y lo devuelve.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { anthropic, anthropicApiKey, MODEL, cachedSystem } from '@/lib/ai';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { verdictFor, resolveEconomics, fmtMoney } from '@/lib/meta';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow } from '@/lib/metrics';

export const runtime = 'nodejs';
export const maxDuration = 300;


export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  if (!anthropicApiKey()) return NextResponse.json({ error: 'Anthropic API key is not configured' }, { status: 500 });

  // adId is the Meta ad id. adName is accepted only as a legacy fallback.
  const { brandId, adId: adIdIn, adName: adNameIn } = (await request.json()) as { brandId: string; adId?: string; adName?: string };
  if (!brandId || (!adIdIn && !adNameIn)) return NextResponse.json({ error: 'Missing brandId or adId' }, { status: 400 });

  const sb = getSupabase();
  const { data: brandRow } = await sb.from('brands').select('id').eq('id', brandId).eq('user_id', user.id).maybeSingle();
  if (!brandRow) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  // Ad + linked creative, by ad_id
  let adQ = sb.from('meta_ads').select('id,ad_id,name,creative_id,dossier_meta,dossier_video,created_date').eq('brand_id', brandId);
  adQ = adIdIn ? adQ.eq('ad_id', adIdIn) : adQ.eq('name', adNameIn!);
  const { data: metaAd } = await adQ.limit(1).maybeSingle();
  if (!metaAd) return NextResponse.json({ error: 'Ad not found in memory' }, { status: 404 });
  const adId = metaAd.ad_id as string;
  const adName = metaAd.name as string;

  let creative: { transcript: string | null; analysis: unknown; duration: number | null; name: string } | null = null;
  if (metaAd.creative_id) {
    const { data } = await sb
      .from('creatives')
      .select('name,transcript,analysis,duration')
      .eq('id', metaAd.creative_id)
      .maybeSingle();
    creative = data;
  }

  // Datos de Meta: serie diaria del anuncio + benchmarks de la cuenta
  const { data: daily } = await sb
    .from('ad_daily')
    .select(AD_DAILY_COLUMNS)
    .eq('brand_id', brandId)
    .not('ad_id', 'is', null)
    .limit(50000);
  const allRows = (daily ?? []) as unknown as AdDailyRow[];
  const ads = aggregateByAd(allRows);
  const ad = ads.find((a) => a.ad_id === adId);
  if (!ad) return NextResponse.json({ error: 'No metrics for this ad' }, { status: 404 });

  const { data: brand } = await sb.from('brands').select('name,product,economics').eq('id', brandId).single();
  const { data: account } = await sb.from('ad_account').select('currency').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle();
  const currency: string | null = account?.currency ?? null;
  const money = (n: number | null | undefined) => (n == null ? 'N/D' : fmtMoney(n, currency));
  const eco = resolveEconomics(brand?.economics);
  const v = verdictFor(ad, eco, currency);

  // Benchmarks simples de la cuenta (promedios ponderados por gasto)
  const totSpend = ads.reduce((s, a) => s + a.spend, 0) || 1;
  const wavg = (f: (a: (typeof ads)[number]) => number | null) => {
    let w = 0, sw = 0;
    for (const a of ads) { const x = f(a); if (x != null) { w += x * a.spend; sw += a.spend; } }
    return sw > 0 ? w / sw : null;
  };
  const bench = {
    roas: ads.reduce((s, a) => s + (a.revenue ?? 0), 0) / totSpend,
    hook: wavg((a) => a.hook_rate),
    hold: wavg((a) => a.hold_rate),
    ret50: wavg((a) => a.ret50),
    ret75: wavg((a) => a.ret75),
    cvr: wavg((a) => a.cvr),
  };

  const serieDiaria = allRows
    .filter((r) => r.ad_id === adId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => `${r.date}: gasto ${money(r.spend)}, ROAS ${r.roas?.toFixed(2) ?? '—'}, hook ${r.hook_rate?.toFixed(1) ?? '—'}%, frec ${r.freq?.toFixed(1) ?? '—'}`)
    .join('\n');

  const dur = creative?.duration ? Math.round(creative.duration) : null;

  const system = `Eres una mesa redonda de tres expertos analizando UN anuncio de video que ya corrió en Meta: un PSICÓLOGO del consumo, un CREATIVE STRATEGIST y un ANALISTA de marketing de resultados. Su trabajo: desmenuzar el creativo por completo, cruzando lo que pasa EN el video con lo que dicen los NÚMEROS reales.

Escribe en español, en secciones con estos encabezados EXACTOS (usa ## para cada uno):

## Veredicto en una línea
## Línea de tiempo (segundo a segundo)
Tabla o lista por tramos: qué se VE (tomas, cambios, texto en pantalla), qué se DICE (guion textual), y qué función cumple cada tramo. Marca dónde caen el 25%, 50% y 75% del video${dur ? ` (dura ~${dur}s: 25%≈${Math.round(dur * 0.25)}s, 50%≈${Math.round(dur * 0.5)}s, 75%≈${Math.round(dur * 0.75)}s)` : ''} y cruza con la retención real.
## El guion completo
Transcripción limpia, marcando [HOOK], [CUERPO], [CTA].
## Dolores y deseos que toca
Cada dolor con la frase textual del guion que lo activa.
## La psicología de por qué funciona
Mecanismos concretos (identificación, prueba social, curiosidad, urgencia, permiso, vergüenza→alivio...) anclados a momentos del video.
## El hook bajo el microscopio
Qué se ve + qué se dice en los primeros 3s, por qué detiene el scroll, y el hook rate real vs el promedio de la cuenta.
## Dónde se pierde la atención
Usa la curva real (ret 25/50/75) para señalar EN QUÉ SEGUNDO y con QUÉ contenido cae la gente, y qué harías en ese punto.
## Del clic a la compra
CTR/CVR/$ATC: ¿el video promete lo que la landing cumple? ¿Empuja a la acción o solo entretiene?
## Qué se hizo bien / Qué le faltó / Cómo mejorarlo
Tres listas cortas y accionables. Las mejoras deben ser ejecutables mañana (nuevo hook, corte en X segundo, CTA distinto...).
## Aprendizaje para la marca
1-2 frases que merecen guardarse en el cerebro de la marca.

Reglas: cita SIEMPRE los números reales al afirmar algo; nada de relleno ni obviedades; si un dato no existe dilo y sigue. Este análisis es para producir MÁS ganadores, no para replicar el video.`;

  const parts: string[] = [];
  parts.push(`ANUNCIO: "${adName}" · Marca: ${brand?.name ?? ''} (${brand?.product ?? ''})`);
  parts.push(`\nMÉTRICAS REALES (acumulado ${ad.days} días, moneda ${currency ?? 'de la cuenta'}): gasto ${money(ad.spend)}, ingresos ${money(ad.revenue)}, ROAS ${ad.roas?.toFixed(2) ?? 'N/D'} (breakeven ${eco.breakeven}, meta ${eco.target}), compras ${Math.round(ad.purchases ?? 0)}, CPA ${money(ad.cpa)}, hook rate ${ad.hook_rate?.toFixed(1) ?? 'N/D'}% (vistas de 3 s / impresiones), hold ${ad.hold_rate?.toFixed(0) ?? 'N/D'}% (ThruPlays / vistas de 3 s), retención 25% ${ad.ret25?.toFixed(0) ?? 'N/D'}%, 50% ${ad.ret50?.toFixed(0) ?? 'N/D'}%, 75% ${ad.ret75?.toFixed(0) ?? 'N/D'}%, 100% ${ad.ret100?.toFixed(0) ?? 'N/D'}%, CVR ${ad.cvr?.toFixed(2) ?? 'N/D'}%, costo/ATC ${money(ad.cost_atc)}, CPC ${money(ad.cpc)}, frecuencia ${ad.freq?.toFixed(1) ?? 'N/D'}. Veredicto de la plataforma: ${v.id} — ${v.why}`);
  parts.push(`\nPROMEDIOS DE LA CUENTA (para comparar): ROAS ${bench.roas.toFixed(2)}, hook ${bench.hook?.toFixed(1) ?? 'N/D'}%, hold ${bench.hold?.toFixed(0) ?? 'N/D'}%, ret50 ${bench.ret50?.toFixed(0) ?? 'N/D'}%, ret75 ${bench.ret75?.toFixed(0) ?? 'N/D'}%, CVR ${bench.cvr?.toFixed(2) ?? 'N/D'}%`);
  if (serieDiaria) parts.push(`\nSERIE DIARIA:\n${serieDiaria}`);
  if (creative?.transcript) parts.push(`\nTRANSCRIPCIÓN DEL VIDEO:\n${creative.transcript}`);
  if (creative?.analysis) {
    const an = JSON.stringify(creative.analysis);
    parts.push(`\nANÁLISIS PREVIO DEL VIDEO (frames, estructura, hook — JSON):\n${an.slice(0, 14000)}`);
  } else {
    parts.push(`\n(No hay video analizado en la Biblioteca para este anuncio: trabaja solo con métricas y expedientes.)`);
  }
  if (metaAd.dossier_meta) parts.push(`\nEXPEDIENTE — RESPUESTA DE LA IA DE META:\n${metaAd.dossier_meta.slice(0, 4000)}`);
  if (metaAd.dossier_video) parts.push(`\nEXPEDIENTE — NOTAS DEL EQUIPO SOBRE EL VIDEO:\n${metaAd.dossier_video.slice(0, 4000)}`);

  try {
    const client = anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 6000,
      system: [...cachedSystem(system.split('\n## Línea de tiempo')[0]), { type: 'text', text: '\n## Línea de tiempo' + system.split('\n## Línea de tiempo').slice(1).join('\n## Línea de tiempo') }],
      messages: [{ role: 'user', content: parts.join('\n') }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    await sb
      .from('meta_ads')
      .update({ fusion: text, fusion_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', metaAd.id);

    return NextResponse.json({ fusion: text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error generando el análisis';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
