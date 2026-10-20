// =============================================================================
// computeHoy — la pantalla "Hoy": la cuenta en 5 ventanas, el
// semáforo de cada anuncio vivo y la salud de la estructura.
//
// Todo sale de ad_daily (un solo fetch de la historia de la marca) y de la
// economía de la marca. Las ventanas se anclan al último día sincronizado:
// "hoy" es ese día (parcial), "ayer" el anterior, y 3/7/14 los incluyen.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/fetch-all';
import { aggregateByAd, sumRows, ratesOf, AD_DAILY_COLUMNS, type AdDailyRow, type AdAggregate } from '@/lib/metrics';
import { resolveEconomics, targetCpa } from '@/lib/meta';
import { semaforoDe, umbralesDe, rolPorFrecuencia, contribucion, LUCES, type Rol, type VentanaAd } from '@/lib/semaforo';


const VENTANAS = [
  { id: 'hoy', label: 'Hoy', desde: 0, hasta: 0 },
  { id: 'ayer', label: 'Ayer', desde: 1, hasta: 1 },
  { id: 'd3', label: '3 días', desde: 2, hasta: 0 },
  { id: 'd7', label: '7 días', desde: 6, hasta: 0 },
  { id: 'd14', label: '14 días', desde: 13, hasta: 0 },
] as const;

function menosDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const v = (a: AdAggregate | undefined, cobertura = 1): VentanaAd | null =>
  a ? { spend: a.spend, purchases: a.purchases, revenue: a.revenue, roas: a.roas, roasIncr: incrDe(a, cobertura) } : null;

/**
 * ROAS incremental de un agregado, solo si la atribución incremental cubre su
 * gasto (los días anteriores a meta-sync v7 no la traen). Sin cobertura,
 * comparar incremental de una parte contra gasto total mentiría.
 */
function incrDe(a: { spend: number; revenue_incr: number | null; purchases_incr: number | null }, cobertura = 1): number | null {
  if (a.spend <= 0 || cobertura < 0.9) return null;
  // Un anuncio sin compras no trae la ventana: en un día cubierto eso es 0.
  return (a.revenue_incr ?? 0) / a.spend;
}

export class HoyError extends Error {
  status: number;
  constructor(msg: string, status = 500) { super(msg); this.status = status; }
}

/** Todo lo que muestra /hoy. Lo usan la pantalla, Lanzar y el generador de guiones. */
export async function computeHoy(sb: SupabaseClient, brandId: string, userId: string) {
  const { data: brand } = await sb.from('brands').select('id,name,economics').eq('id', brandId).eq('user_id', userId).maybeSingle();
  if (!brand) throw new HoyError('Marca no encontrada', 404);
  const eco = resolveEconomics(brand.economics);
  const u = umbralesDe(eco);
  const contrib = contribucion(eco);

  const { data: acc } = await sb.from('ad_account').select('currency,last_synced_at,last_sync_error')
    .eq('brand_id', brandId).eq('active', true).order('created_at').limit(1).maybeSingle();

  let all: AdDailyRow[];
  try {
    all = (await fetchAll(() => sb.from('ad_daily').select(AD_DAILY_COLUMNS).eq('brand_id', brandId)
      .not('ad_id', 'is', null).order('date', { ascending: true }).order('ad_id'))) as unknown as AdDailyRow[];
  } catch (e) {
    throw new HoyError(e instanceof Error ? e.message : 'Falló la consulta', 500);
  }
  if (!all.length) return { empty: true as const, economics: eco };

  const anchor = all[all.length - 1].date;
  // Días que ya pasaron por meta-sync v7 (traen ventanas de atribución). Se
  // mide por día y no por fila: una fila sin compras no trae la ventana.
  const fechasIncr = new Set(all.filter((r) => r.purchases_incr != null || r.revenue_incr != null).map((r) => r.date));
  const filas = (desde: number, hasta: number) => {
    const a = menosDias(anchor, desde), b = menosDias(anchor, hasta);
    return all.filter((r) => r.date >= a && r.date <= b);
  };

  // --- La cuenta en 5 ventanas ------------------------------------------------
  const cuenta = VENTANAS.map((w) => {
    const rows = filas(w.desde, w.hasta);
    const t = sumRows(rows);
    const r = ratesOf(t);
    const compras = t.purchases ?? 0;
    const aov = compras > 0 && t.revenue != null ? t.revenue / compras : null;
    const gpt = aov != null && r.cpa != null ? aov - r.cpa : null;
    const margen = contrib != null && t.revenue != null ? t.revenue * contrib - t.spend : null;
    // Cobertura del incremental: parte del gasto en días que ya traen la ventana.
    const gastoConIncr = rows.filter((x) => fechasIncr.has(x.date)).reduce((s, x) => s + (x.spend ?? 0), 0);
    const cobertura = t.spend > 0 ? gastoConIncr / t.spend : 0;
    const roasIncr = incrDe(t, cobertura);
    const margenIncr = roasIncr != null && contrib != null ? t.spend * roasIncr * contrib - t.spend : null;
    return {
      id: w.id, label: w.label, desde: menosDias(anchor, w.desde), hasta: menosDias(anchor, w.hasta),
      spend: t.spend, revenue: t.revenue, purchases: t.purchases, roas: r.roas, cpa: r.cpa, cpm: r.cpm,
      freq: t.freq, aov, gpt, margen, margenPct: margen != null && t.revenue ? margen / t.revenue : null,
      roasIncr, comprasIncr: roasIncr != null ? (t.purchases_incr ?? 0) : null,
      cpaIncr: roasIncr != null ? r.cpa_incr : null,
      margenIncr,
      vistaPct: r.view_share,
      cobertura,
    };
  });
  const porId = Object.fromEntries(cuenta.map((c) => [c.id, c]));

  // ¿Se puede subir presupuesto? King Goal en 7 y 14 días y 3 días sin caer >20%.
  const r3 = porId.d3?.roas ?? null, r7 = porId.d7?.roas ?? null, r14 = porId.d14?.roas ?? null;
  const i7 = porId.d7?.roasIncr ?? null;
  const motivos: string[] = [];
  // El siguiente peso regresa lo que dice el incremental, no el reportado.
  if (i7 != null && i7 < eco.breakeven) motivos.push(`el ROAS incremental de 7 d (${i7.toFixed(2)}) no cubre el equilibrio de ${eco.breakeven}`);
  if (r7 == null || r7 < eco.target) motivos.push(`ROAS 7 d ${r7?.toFixed(2) ?? '—'} debajo de ${eco.target}`);
  if (r14 == null || r14 < eco.target) motivos.push(`ROAS 14 d ${r14?.toFixed(2) ?? '—'} debajo de ${eco.target}`);
  if (r3 != null && r7 != null && r7 > 0 && r3 / r7 - 1 < -0.2) motivos.push(`los últimos 3 días caen ${Math.round((1 - r3 / r7) * 100)}% contra 7 d`);
  const presupuesto = {
    subir: motivos.length === 0,
    porque: motivos.length === 0
      ? `ROAS 7 d ${r7!.toFixed(2)} y 14 d ${r14!.toFixed(2)} arriba de ${eco.target}${i7 != null ? ` e incremental ${i7.toFixed(2)} sobre el equilibrio` : ''}: sube 10 a 15% (máximo cada 72 h).`
      : `No se sube: ${motivos.join('; ')}. La palanca es creativa.`,
  };

  // --- Semáforo por anuncio ---------------------------------------------------
  const vida = new Map(aggregateByAd(all).map((a) => [a.ad_id, a]));
  const m3 = new Map(aggregateByAd(filas(2, 0)).map((a) => [a.ad_id, a]));
  const m7 = new Map(aggregateByAd(filas(6, 0)).map((a) => [a.ad_id, a]));
  const m14 = new Map(aggregateByAd(filas(13, 0)).map((a) => [a.ad_id, a]));
  const mHoy = new Map(aggregateByAd(filas(0, 0)).map((a) => [a.ad_id, a]));
  const gasto14 = porId.d14?.spend ?? 0;
  // Si la cuenta todavía no tiene el incremental en toda la ventana, ningún
  // anuncio lo muestra en esa ventana (se ve "—" en vez de un número parcial).
  const cov3 = porId.d3?.cobertura ?? 0, cov7 = porId.d7?.cobertura ?? 0, cov14 = porId.d14?.cobertura ?? 0;

  const vivos = [...m7.values()].filter((a) => a.spend > 0).map((a) => a.ad_id);
  const { data: metas } = vivos.length
    ? await sb.from('meta_ads').select('id,ad_id,thumbnail_url,asset_kind,creative_id,analyzed_at,queue_status').eq('brand_id', brandId).in('ad_id', vivos)
    : { data: [] };
  const metaPor = new Map((metas ?? []).map((m) => [m.ad_id as string, m]));

  const anuncios = vivos.map((id) => {
    const a14 = m14.get(id), a7 = m7.get(id), a3 = m3.get(id), av = vida.get(id)!, ah = mHoy.get(id);
    const share14 = gasto14 > 0 ? (a14?.spend ?? 0) / gasto14 : 0;
    const s = semaforoDe({
      vida: v(av)!, d3: v(a3, cov3), d7: v(a7, cov7), d14: v(a14, cov14), share14,
      cuentaRoas7: r7, cuentaRoas14: r14,
    }, eco);
    const m = metaPor.get(id);
    const compras14 = a14?.purchases ?? 0;
    const aov14 = compras14 > 0 && a14?.revenue != null ? a14.revenue / compras14 : null;
    return {
      ad_id: id,
      nombre: av.ad_name,
      campana: a14?.campaign_name ?? av.campaign_name ?? null,
      conjunto: a14?.adset_name ?? av.adset_name ?? null,
      thumbnail_url: m?.thumbnail_url ?? null,
      kind: m?.asset_kind ?? null,
      analizado: Boolean(m?.creative_id || m?.analyzed_at),
      meta_id: m?.id ?? null,
      ...s,
      share14,
      gastaHoy: (ah?.spend ?? 0) > 0,
      sinGasto3d: (a3?.spend ?? 0) === 0,
      hoy: ah ? { spend: ah.spend, purchases: ah.purchases, roas: ah.roas } : null,
      d3: a3 ? { spend: a3.spend, purchases: a3.purchases, roas: a3.roas } : null,
      d7: a7 ? { spend: a7.spend, purchases: a7.purchases, roas: a7.roas, cpa: a7.cpa, roasIncr: incrDe(a7, cov7), freq: a7.freq, cpm: a7.cpm } : null,
      d14: a14 ? { spend: a14.spend, purchases: a14.purchases, roas: a14.roas, cpa: a14.cpa, cpm: a14.cpm, freq: a14.freq, hook: a14.hook_rate, roasIncr: incrDe(a14, cov14), vistaPct: a14.view_share } : null,
      gpt14: aov14 != null && a14?.cpa != null ? aov14 - a14.cpa : null,
      vidaGasto: av.spend,
      vidaCompras: av.purchases,
      rol: rolPorFrecuencia(a14?.freq),
    };
  }).sort((a, b) => LUCES[a.luz].orden - LUCES[b.luz].orden || (b.d14?.spend ?? 0) - (a.d14?.spend ?? 0));

  const conteo = Object.fromEntries(Object.keys(LUCES).map((k) => [k, anuncios.filter((x) => x.luz === k).length]));

  // --- Estructura y reparto por rol -------------------------------------------
  const a7 = [...m7.values()].filter((a) => a.spend > 0);
  const conjuntos = new Set(a7.map((a) => a.adset_id ?? a.adset_name).filter(Boolean));
  const campanas = new Set(a7.map((a) => a.campaign_id ?? a.campaign_name).filter(Boolean));
  const top = [...m14.values()].sort((a, b) => b.spend - a.spend)[0];
  const estructura = {
    anuncios7: a7.length,
    anunciosConVenta7: a7.filter((a) => (a.purchases ?? 0) > 0).length,
    conjuntos7: conjuntos.size,
    campanas7: campanas.size,
    porConjunto: conjuntos.size ? a7.length / conjuntos.size : null,
    topNombre: top?.ad_name ?? null,
    topShare: top && gasto14 > 0 ? top.spend / gasto14 : null,
  };
  const roles: Record<Rol, number> = { arriba: 0, medio: 0, abajo: 0, retargeting: 0 };
  for (const a of m14.values()) {
    const r = rolPorFrecuencia(a.freq);
    if (r) roles[r] += a.spend;
  }

  return {
    marca: brand.name as string,
    anchor,
    currency: acc?.currency ?? null,
    lastSyncedAt: acc?.last_synced_at ?? null,
    syncError: acc?.last_sync_error ?? null,
    economics: { ...eco, targetCpa: targetCpa(eco), contribucion: contrib },
    umbrales: u,
    cuenta,
    presupuesto,
    anuncios,
    conteo,
    estructura,
    roles: Object.fromEntries(Object.entries(roles).map(([k, s]) => [k, gasto14 > 0 ? s / gasto14 : 0])),
  };
}

export type HoyResult = Awaited<ReturnType<typeof computeHoy>>;
