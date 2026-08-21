// =============================================================================
// AdDNA — Núcleo del análisis fusionado (la mesa redonda).
// Usado por /api/fusion (manual) y /api/auto-analyze (cron automático).
// mode 'ganador': qué hace ganar a este creativo (para replicar patrones).
// mode 'antivideo': qué lo hace perder (anti-patrones — qué NO volver a hacer).
// Guarda el resultado en meta_ads.fusion y devuelve el texto.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from '@/lib/supabase';
import { aggregateAds, verdictFor, DEFAULT_ECONOMICS, type DailyRow, type Economics } from '@/lib/meta';

const MODEL = 'claude-sonnet-4-6';

export type FusionMode = 'ganador' | 'antivideo';

const SYSTEM_GANADOR = (dur: number | null) => `Eres una mesa redonda de tres expertos analizando UN anuncio de video que ya corrió en Meta: un PSICÓLOGO del consumo, un CREATIVE STRATEGIST y un ANALISTA de marketing de resultados. Su trabajo: desmenuzar el creativo por completo, cruzando lo que pasa EN el video con lo que dicen los NÚMEROS reales.

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

const SYSTEM_ANTIVIDEO = (dur: number | null) => `Eres una mesa redonda de tres expertos haciendo la AUTOPSIA de un anuncio PERDEDOR que Meta financió con gasto real y aun así no fue rentable: un PSICÓLOGO del consumo, un CREATIVE STRATEGIST y un ANALISTA de marketing de resultados. El objetivo NO es rescatarlo: es extraer los ANTI-PATRONES — qué exactamente hizo que perdiera dinero — para que la marca no vuelva a cometer esos errores.

Escribe en español, en secciones con estos encabezados EXACTOS (usa ## para cada uno):

## Causa de muerte en una línea
## Dónde se rompió el embudo
Con los números reales, señala la etapa exacta: ¿hook débil (no detienen el scroll)?, ¿retención (empiezan y abandonan${dur ? ` — dura ~${dur}s` : ''})?, ¿clic sin compra (promete lo que la landing no cumple)?, ¿CPM caro (el ángulo no le interesa a la audiencia)? Compara cada métrica contra el promedio de la cuenta.
## Qué se ve y se dice (y por qué no funcionó)
Si hay transcripción/análisis del video, recorre el creativo señalando los momentos débiles concretos.
## Anti-patrones para el cerebro de la marca
La sección MÁS importante: lista numerada de reglas "NO hacer X" — específicas, verificables, citando la evidencia numérica de este anuncio. Nada genérico.
## ¿Era el creativo o era otra cosa?
Sé honesto: si los números sugieren que el problema pudo ser externo (landing, oferta, precio, un periodo con el sitio roto, audiencia saturada), dilo — un falso anti-patrón contamina el cerebro.
## Si se quisiera rescatar el ángulo
1-2 líneas: ¿el ángulo/dolor merece otro intento con distinta ejecución, o se descarta el ángulo completo?

Reglas: cita SIEMPRE los números reales al afirmar algo; nada de relleno; si un dato no existe dilo y sigue. Este análisis alimenta la lista de "qué NO hacer" de la marca.`;

export async function runFusion(
  brandId: string,
  adName: string,
  mode: FusionMode = 'ganador'
): Promise<{ fusion?: string; error?: string; status: number }> {
  const apiKey = process.env.MY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Falta la API key de Anthropic', status: 500 };

  const sb = getSupabase();

  const { data: metaAd } = await sb
    .from('meta_ads')
    .select('id,name,creative_id,dossier_meta,dossier_video,created_date')
    .eq('brand_id', brandId)
    .eq('name', adName)
    .maybeSingle();
  if (!metaAd) return { error: 'Anuncio no encontrado en la memoria', status: 404 };

  let creative: { transcript: string | null; analysis: unknown; duration: number | null; name: string } | null = null;
  if (metaAd.creative_id) {
    const { data } = await sb
      .from('creatives')
      .select('name,transcript,analysis,duration')
      .eq('id', metaAd.creative_id)
      .maybeSingle();
    creative = data;
  }

  const { data: daily } = await sb
    .from('meta_daily')
    .select('ad_name,date,status,spend,revenue,roas,cpa,cpc,cpm,v3s,hook_rate,v25,v50,v75,freq,cost_atc,link_clicks,cvr,result_rate')
    .eq('brand_id', brandId)
    .limit(20000);
  const allRows = (daily ?? []) as DailyRow[];
  const ads = aggregateAds(allRows);
  const ad = ads.find((a) => a.ad_name === adName);
  if (!ad) return { error: 'Sin métricas para este anuncio', status: 404 };

  const { data: brand } = await sb.from('brands').select('name,product,economics').eq('id', brandId).single();
  const eco: Economics = { ...DEFAULT_ECONOMICS, ...((brand?.economics as Economics) ?? {}) };
  const v = verdictFor(ad, eco);

  const totSpend = ads.reduce((s, a) => s + a.spend, 0) || 1;
  const wavg = (f: (a: (typeof ads)[number]) => number | null) => {
    let w = 0, sw = 0;
    for (const a of ads) { const x = f(a); if (x != null) { w += x * a.spend; sw += a.spend; } }
    return sw > 0 ? w / sw : null;
  };
  const bench = {
    roas: ads.reduce((s, a) => s + a.revenue, 0) / totSpend,
    hook: wavg((a) => a.hook_rate),
    ret50: wavg((a) => a.ret50),
    ret75: wavg((a) => a.ret75),
    cvr: wavg((a) => a.cvr),
  };

  const serieDiaria = allRows
    .filter((r) => r.ad_name === adName)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => `${r.date}: gasto $${r.spend.toFixed(2)}, ROAS ${r.roas?.toFixed(2) ?? '—'}, hook ${r.hook_rate?.toFixed(1) ?? '—'}%, frec ${r.freq?.toFixed(1) ?? '—'}`)
    .join('\n');

  const dur = creative?.duration ? Math.round(creative.duration) : null;
  const system = mode === 'antivideo' ? SYSTEM_ANTIVIDEO(dur) : SYSTEM_GANADOR(dur);

  const parts: string[] = [];
  parts.push(`ANUNCIO: "${adName}" · Marca: ${brand?.name ?? ''} (${brand?.product ?? ''})`);
  parts.push(`\nMÉTRICAS REALES (acumulado ${ad.days} días): gasto $${ad.spend.toFixed(0)}, ingresos $${ad.revenue.toFixed(0)}, ROAS ${ad.roas?.toFixed(2) ?? 'N/D'} (breakeven ${eco.breakeven}, meta ${eco.target}), compras ${Math.round(ad.purchases)}, CPA $${ad.cpa?.toFixed(2) ?? 'N/D'}, hook rate ${ad.hook_rate?.toFixed(1) ?? 'N/D'}%, retención 25% ${ad.ret25?.toFixed(0) ?? 'N/D'}%, 50% ${ad.ret50?.toFixed(0) ?? 'N/D'}%, 75% ${ad.ret75?.toFixed(0) ?? 'N/D'}%, CTR→CVR ${ad.cvr?.toFixed(2) ?? 'N/D'}%, $/ATC $${ad.cost_atc?.toFixed(2) ?? 'N/D'}, CPC $${ad.cpc?.toFixed(2) ?? 'N/D'}, frecuencia ${ad.freq?.toFixed(1) ?? 'N/D'}. Veredicto de la plataforma: ${v.label} — ${v.why}`);
  parts.push(`\nPROMEDIOS DE LA CUENTA (para comparar): ROAS ${bench.roas.toFixed(2)}, hook ${bench.hook?.toFixed(1) ?? 'N/D'}%, ret50 ${bench.ret50?.toFixed(0) ?? 'N/D'}%, ret75 ${bench.ret75?.toFixed(0) ?? 'N/D'}%, CVR ${bench.cvr?.toFixed(2) ?? 'N/D'}%`);
  if (serieDiaria) parts.push(`\nSERIE DIARIA:\n${serieDiaria}`);
  if (creative?.transcript) parts.push(`\nTRANSCRIPCIÓN DEL VIDEO:\n${creative.transcript}`);
  if (creative?.analysis) {
    const an = JSON.stringify(creative.analysis);
    parts.push(`\nANÁLISIS PREVIO DEL VIDEO (frames, estructura, hook — JSON):\n${an.slice(0, 14000)}`);
  } else {
    parts.push(`\n(No hay video analizado en la Biblioteca para este anuncio: trabaja solo con métricas y expedientes.)`);
  }
  if (metaAd.dossier_meta) parts.push(`\nEXPEDIENTE — RESPUESTA DE LA IA DE META:\n${metaAd.dossier_meta.slice(0, 4000)}`);
  if (metaAd.dossier_video) parts.push(`\nEXPEDIENTE — NOTAS DE EDUARDO SOBRE EL VIDEO:\n${metaAd.dossier_video.slice(0, 4000)}`);

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 6000,
      system,
      messages: [{ role: 'user', content: parts.join('\n') }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    const header = mode === 'antivideo' ? '⛔ ANTIVIDEO (autopsia automática)\n\n' : '';
    await sb
      .from('meta_ads')
      .update({ fusion: header + text, fusion_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', metaAd.id);

    return { fusion: header + text, status: 200 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error generando el análisis';
    return { error: msg, status: 500 };
  }
}
