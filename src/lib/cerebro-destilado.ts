// =============================================================================
// El destilado del Cerebro: qué está funcionando en 7 y 30 días (y 15 de
// puente), con lo que el barrido ya extrajo de cada creativo — hook verbal,
// hook visual (lo que se ve en los primeros segundos), texto en pantalla,
// estructura, guion, receta ganadora; y en estáticos, el copy y la composición.
//
// Antes salía de las tablas de avatares/conceptos/hooks del Cerebro, que en
// Feel Ink nunca se ligaron a los anuncios: el bloque salía con nombres y ROAS
// nada más. Ahora sale de `creatives.analysis`, que sí existe para el top.
//
// Lo usan: GET /api/brain/digest (pantalla), POST /api/brain/digest/sintesis
// (Claude junta los patrones) y el cron semanal (/api/brain/digest/cron), que
// guarda una foto cada martes en `brain_digest`.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/fetch-all';
import { resolveEconomics, targetCpa, type Economics } from '@/lib/meta';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow, type AdAggregate } from '@/lib/metrics';
import { rolPorFrecuencia, ROL_LABEL } from '@/lib/semaforo';

export const VENTANAS_DESTILADO = [7, 15, 30] as const;

export interface Pieza {
  ad_id: string;
  nombre: string;
  formato: 'video' | 'estatico' | null;
  gasto: number;
  compras: number | null;
  roas: number | null;
  roasIncr: number | null;
  cpa: number | null;
  hookRate: number | null;
  holdRate: number | null;
  frecuencia: number | null;
  rol: string | null;
  analizado: boolean;
  thumbnail: string | null;
  // Video
  hookVerbal: string | null;
  hookVisual: string | null;
  textoPantalla: string | null;
  tipoHook: string | null;
  estructura: string | null;
  desarrollo: string | null;
  guion: string | null;
  cta: string | null;
  // Estático
  titular: string | null;
  copyImagen: string | null;
  composicion: string | null;
  anguloCopy: string | null;
  // Los dos
  receta: string[];
  conservar: string[];
  veredicto: string | null;
}

export interface Ventana {
  dias: number;
  desde: string;
  hasta: string;
  gasto: number;
  ingreso: number;
  roas: number | null;
  roasIncr: number | null;
  ganadores: number;
  perdedores: number;
  analizados: number;
  piezasGanadoras: Pieza[];
  piezasPerdedoras: Pieza[];
  prompt: string;
}

export interface Destilado {
  marca: string;
  currency: string | null;
  economics: Economics;
  anchor: string;
  ventanas: Ventana[];
}

const s = (v: unknown, n = 400): string | null => {
  if (v == null) return null;
  const t = (typeof v === 'string' ? v : JSON.stringify(v)).replace(/\s+/g, ' ').trim();
  return t ? (t.length > n ? `${t.slice(0, n)}…` : t) : null;
};
const lista = (v: unknown, max = 4): string[] =>
  (Array.isArray(v) ? v : []).map((x) => s(x, 220)).filter((x): x is string => Boolean(x)).slice(0, max);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Lo que el análisis del creativo dice de su hook, guion y receta. */
function extraer(analysis: unknown, transcript: string | null, tipo: string | null) {
  const a = obj(analysis);
  const dash = obj(a.dashboard);
  const hook = obj(dash.hook);
  const sa = obj(a.structural_analysis);
  const ws = obj(sa.winning_structure);
  const ca = obj(a.copy_analysis);
  const vb = obj(a.visual_breakdown);
  const frames = lista(hook.frame_descriptions, 2);
  const esImagen = tipo === 'image' || Boolean(ca.headline);
  const guion = s(a.original_script, 900) ?? s(transcript, 900);
  return {
    formato: (esImagen ? 'estatico' : tipo === 'video' || guion ? 'video' : null) as Pieza['formato'],
    hookVerbal: esImagen ? null : s(ws.hook, 260) ?? (guion ? s(guion.split(/(?<=[.?!])\s/)[0], 200) : null),
    hookVisual: esImagen ? null : (frames.length ? frames.join(' / ') : null) ?? s(hook.scroll_stop_mechanism, 200),
    textoPantalla: esImagen ? null : s(hook.text_overlay, 140),
    tipoHook: s(hook.type, 40),
    estructura: s(ws.format ?? sa.video_type, 160),
    desarrollo: s(ws.development, 380),
    guion: esImagen ? null : guion,
    cta: s(ws.cta ?? ca.cta_text, 160),
    titular: esImagen ? s([ca.headline, ca.subheadline].filter(Boolean).join(' / '), 200) : null,
    copyImagen: esImagen ? s(ca.body_text, 260) : null,
    composicion: esImagen ? s(vb.layout ?? vb.focal_point, 320) : null,
    anguloCopy: esImagen ? s(ca.copy_angle, 260) : null,
    receta: lista(a.winning_recipe, 4),
    conservar: lista(a.keep, 3),
    veredicto: s(a.verdict, 260),
  };
}

const r2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(2));
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(0)}%`);
const money = (n: number, cur: string | null) => `$${Math.round(n).toLocaleString('es-MX')}${cur ? ` ${cur}` : ''}`;

function fichaMd(p: Pieza, cur: string | null): string {
  const L: string[] = [];
  const met = [
    `ROAS ${r2(p.roas)}`, p.roasIncr != null ? `incremental ${r2(p.roasIncr)}` : null,
    `gasto ${money(p.gasto, cur)}`, `${p.compras ?? 0} compras`, p.cpa != null ? `CPA ${money(p.cpa, null)}` : null,
    p.hookRate != null ? `hook rate ${pct(p.hookRate)}` : null, p.holdRate != null ? `retención ${pct(p.holdRate)}` : null,
    p.frecuencia != null ? `frec. diaria ${r2(p.frecuencia)}${p.rol ? ` (${p.rol})` : ''}` : null,
  ].filter(Boolean).join(' · ');
  L.push(`### ${p.nombre} — ${p.formato === 'estatico' ? 'estático' : p.formato === 'video' ? 'video' : 'formato ?'}`);
  L.push(met);
  if (!p.analizado) { L.push('_Sin análisis todavía (no entró al barrido). Solo hay números._'); return L.join('\n'); }
  if (p.formato === 'estatico') {
    if (p.titular) L.push(`- Titular: "${p.titular}"`);
    if (p.copyImagen) L.push(`- Copy en la imagen: ${p.copyImagen}`);
    if (p.composicion) L.push(`- Composición: ${p.composicion}`);
    if (p.anguloCopy) L.push(`- Ángulo: ${p.anguloCopy}`);
  } else {
    if (p.hookVerbal) L.push(`- Hook verbal${p.tipoHook ? ` (${p.tipoHook})` : ''}: "${p.hookVerbal}"`);
    if (p.hookVisual) L.push(`- Hook visual (lo que se ve en 0-3 s): ${p.hookVisual}`);
    if (p.textoPantalla) L.push(`- Texto en pantalla: "${p.textoPantalla}"`);
    if (p.estructura) L.push(`- Estructura: ${p.estructura}`);
    if (p.desarrollo) L.push(`- Desarrollo: ${p.desarrollo}`);
  }
  if (p.cta) L.push(`- CTA: ${p.cta}`);
  if (p.receta.length) L.push(`- Por qué funciona: ${p.receta.join(' · ')}`);
  if (p.conservar.length) L.push(`- No tocar al iterar: ${p.conservar.join(' · ')}`);
  if (p.formato !== 'estatico' && p.guion) L.push(`- Guion: "${p.guion}"`);
  return L.join('\n');
}

function lineaPerdedor(p: Pieza, cur: string | null): string {
  const h = p.formato === 'estatico' ? p.titular : p.hookVerbal;
  return `- ${p.nombre} · ROAS ${r2(p.roas)} · gasto ${money(p.gasto, cur)}${h ? ` · ${p.formato === 'estatico' ? 'titular' : 'hook'}: "${h}"` : ''}${p.veredicto ? ` — ${p.veredicto}` : ''}`;
}

function promptVentana(v: Omit<Ventana, 'prompt'>, marca: string, eco: Economics, cur: string | null): string {
  const L: string[] = [];
  L.push(`# ${marca} — qué está funcionando · ${v.dias} días (${v.desde} → ${v.hasta})`);
  L.push('');
  L.push(`Cuenta: gasto ${money(v.gasto, cur)} · ROAS ${r2(v.roas)}${v.roasIncr != null ? ` · incremental ${r2(v.roasIncr)}` : ''}. Equilibrio ${r2(eco.breakeven)} · King Goal ${r2(eco.target)}.`);
  L.push(`Ganador = gastó al menos 1 CPA objetivo y su ROAS llegó a ${r2(eco.target)}. Perdedor = gastó al menos 2 CPA y quedó debajo de ${r2(eco.breakeven)}. ${v.analizados} de ${v.ganadores} ganadores tienen análisis completo.`);
  L.push('');
  L.push('## Lo que ganó — copia la razón, cambia la ejecución');
  if (!v.piezasGanadoras.length) L.push(`Ningún anuncio llegó a ${r2(eco.target)} con gasto suficiente en esta ventana.`);
  for (const p of v.piezasGanadoras) { L.push(''); L.push(fichaMd(p, cur)); }
  L.push('');
  if (v.piezasPerdedoras.length) {
    L.push('## Lo que perdió — no repitas esto');
    for (const p of v.piezasPerdedoras) L.push(lineaPerdedor(p, cur));
    L.push('');
  }
  L.push('## Cómo usar esto');
  L.push('Para el siguiente lote: toma de los ganadores el hook (verbal y visual), la estructura y la razón por la que funciona; conserva lo que dice "No tocar al iterar" y cambia UNA capa (mensaje, mecanismo, avatar, educación, oferta o visual). Los hooks son de un avatar: revisa a quién le habla antes de reutilizarlo.');
  return L.join('\n');
}

/** Qué está funcionando, por ventana, con el análisis de cada creativo. */
export async function computeDestilado(sb: SupabaseClient, brandId: string): Promise<Destilado> {
  const { data: brand } = await sb.from('brands').select('id,name,economics').eq('id', brandId).maybeSingle();
  if (!brand) throw new Error('Marca no encontrada');
  const eco = resolveEconomics(brand.economics);
  const marca = String(brand.name ?? 'Marca');

  const [{ data: acc }, { data: last }] = await Promise.all([
    sb.from('ad_account').select('currency').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle(),
    sb.from('ad_daily').select('date').eq('brand_id', brandId).not('ad_id', 'is', null).order('date', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const cur = (acc?.currency as string | null) ?? null;
  const hasta = (last?.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
  const menos = (n: number) => { const d = new Date(`${hasta}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (n - 1)); return d.toISOString().slice(0, 10); };
  const desdeMax = menos(Math.max(...VENTANAS_DESTILADO));

  const daily = (await fetchAll(() => sb.from('ad_daily').select(AD_DAILY_COLUMNS)
    .eq('brand_id', brandId).not('ad_id', 'is', null).gte('date', desdeMax).lte('date', hasta).order('date').order('ad_id'))) as unknown as AdDailyRow[];

  // Cobertura del incremental por fecha (antes de meta-sync v7 no existe).
  const fechasIncr = new Set(daily.filter((r) => r.purchases_incr != null || r.revenue_incr != null).map((r) => r.date));

  const piso = targetCpa(eco) ?? eco.cac ?? eco.kill ?? 0;
  const pisoPerdedor = piso * 2;

  // Candidatos de cualquier ventana → un solo fetch de análisis.
  const porVentana = VENTANAS_DESTILADO.map((dias) => {
    const desde = menos(dias);
    const filas = aggregateByAd(daily.filter((r) => r.date >= desde && r.date <= hasta));
    const fechas = new Set(daily.filter((r) => r.date >= desde).map((r) => r.date));
    const cubiertas = [...fechas].filter((f) => fechasIncr.has(f)).length;
    const cobertura = fechas.size ? cubiertas / fechas.size : 0;
    const gan = filas.filter((a) => a.spend >= piso && (a.roas ?? 0) >= eco.target).sort((x, y) => y.spend - x.spend).slice(0, 12);
    const per = filas.filter((a) => a.spend >= pisoPerdedor && (a.roas ?? 0) < eco.breakeven).sort((x, y) => y.spend - x.spend).slice(0, 8);
    return { dias, desde, filas, gan, per, cobertura };
  });
  const ids = [...new Set(porVentana.flatMap((v) => [...v.gan, ...v.per].map((a) => a.ad_id)))];
  const metas = ids.length
    ? ((await fetchAll(() => sb.from('meta_ads').select('ad_id,creative_id,thumbnail_url,asset_kind,media_type').eq('brand_id', brandId).in('ad_id', ids).order('ad_id'))) as Record<string, unknown>[])
    : [];
  const cids = [...new Set(metas.map((m) => m.creative_id as string | null).filter(Boolean))] as string[];
  const crs = cids.length
    ? ((await fetchAll(() => sb.from('creatives').select('id,type,transcript,analysis').in('id', cids).order('id'))) as Record<string, unknown>[])
    : [];
  const crPor = new Map(crs.map((c) => [c.id as string, c]));
  const metaPor = new Map(metas.map((m) => [m.ad_id as string, m]));

  const pieza = (a: AdAggregate, cobertura: number): Pieza => {
    const m = metaPor.get(a.ad_id);
    const c = m?.creative_id ? crPor.get(m.creative_id as string) : undefined;
    const tipo = (c?.type as string | undefined) ?? (m?.asset_kind === 'image' || m?.media_type === 'image' ? 'image' : (m?.asset_kind as string | undefined) ?? null);
    const x = extraer(c?.analysis, (c?.transcript as string | null) ?? null, tipo);
    const analizado = Boolean(c?.analysis && typeof c.analysis === 'object' && Object.keys(c.analysis as object).length);
    return {
      ad_id: a.ad_id, nombre: a.ad_name, gasto: a.spend, compras: a.purchases, roas: a.roas,
      roasIncr: cobertura >= 0.9 && a.spend > 0 ? (a.revenue_incr ?? 0) / a.spend : null,
      cpa: a.cpa, hookRate: a.hook_rate, holdRate: a.hold_rate, frecuencia: a.freq,
      rol: (() => { const r = rolPorFrecuencia(a.freq); return r ? ROL_LABEL[r] : null; })(),
      analizado, thumbnail: (m?.thumbnail_url as string | null) ?? null,
      ...x,
      formato: x.formato ?? (tipo === 'image' ? 'estatico' : tipo === 'video' ? 'video' : null),
    };
  };

  const ventanas: Ventana[] = porVentana.map((v) => {
    const gasto = v.filas.reduce((t, a) => t + a.spend, 0);
    const ingreso = v.filas.reduce((t, a) => t + (a.revenue ?? 0), 0);
    const incr = v.filas.reduce((t, a) => t + (a.revenue_incr ?? 0), 0);
    const piezasGanadoras = v.gan.map((a) => pieza(a, v.cobertura));
    const piezasPerdedoras = v.per.map((a) => pieza(a, v.cobertura));
    const base = {
      dias: v.dias, desde: v.desde, hasta, gasto, ingreso,
      roas: gasto > 0 ? ingreso / gasto : null,
      roasIncr: v.cobertura >= 0.9 && gasto > 0 ? incr / gasto : null,
      ganadores: piezasGanadoras.length, perdedores: piezasPerdedoras.length,
      analizados: piezasGanadoras.filter((p) => p.analizado).length,
      piezasGanadoras, piezasPerdedoras,
    };
    return { ...base, prompt: promptVentana(base, marca, eco, cur) };
  });

  return { marca, currency: cur, economics: eco, anchor: hasta, ventanas };
}

/** Sube un nivel todos los títulos de un bloque markdown. */
const bajarTitulos = (md: string) => md.replace(/^(#+) /gm, '#$1 ');

/** El archivo para subir al proyecto de Claude: síntesis + 7 y 30 días. */
export function archivoSemanal(d: Destilado, sintesis: string | null): string {
  const v7 = d.ventanas.find((v) => v.dias === 7);
  const v30 = d.ventanas.find((v) => v.dias === 30);
  return [
    `# Cerebro ${d.marca} — semana al ${d.anchor}`,
    '',
    'Generado por AdDissector con los anuncios de Meta y el análisis de cada creativo. Reemplaza al archivo de la semana anterior en el proyecto de Claude.',
    '',
    sintesis ? `## Síntesis: lo que se repite en lo que funciona\n\n${sintesis}\n` : '',
    v7 ? bajarTitulos(v7.prompt) : '',
    '',
    v30 ? bajarTitulos(v30.prompt) : '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Fotos semanales: archivos .md en brand-assets/<user>/<marca>/cerebro/.
// ---------------------------------------------------------------------------
export const BUCKET_CEREBRO = 'brand-assets';
export const carpetaCerebro = (userId: string, brandId: string) => `${userId}/${brandId}/cerebro`;

export async function guardarSemanal(sb: SupabaseClient, userId: string, brandId: string, d: Destilado, markdown: string) {
  const slug = d.marca.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'marca';
  const path = `${carpetaCerebro(userId, brandId)}/cerebro-${slug}-${d.anchor}.md`;
  const { error } = await sb.storage.from(BUCKET_CEREBRO).upload(path, new TextEncoder().encode(markdown), { contentType: 'text/markdown; charset=utf-8', upsert: true });
  if (error) throw new Error(error.message);
  return { path, url: sb.storage.from(BUCKET_CEREBRO).getPublicUrl(path).data.publicUrl };
}

export async function listarSemanales(sb: SupabaseClient, userId: string, brandId: string) {
  const carpeta = carpetaCerebro(userId, brandId);
  const { data } = await sb.storage.from(BUCKET_CEREBRO).list(carpeta, { limit: 12, sortBy: { column: 'name', order: 'desc' } });
  return (data ?? []).filter((f) => f.name.endsWith('.md')).map((f) => ({
    nombre: f.name,
    fecha: f.name.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] ?? null,
    url: sb.storage.from(BUCKET_CEREBRO).getPublicUrl(`${carpeta}/${f.name}`).data.publicUrl,
  }));
}
