// =============================================================================
// AdDNA — Motor Meta: parser del export del socio, agregación y veredictos.
// Las columnas de este parser son la "estrella polar": el export estándar que
// se sube cada pocos días (nivel anuncio, desglose por día).
// =============================================================================

export interface DailyRow {
  ad_name: string;
  date: string; // YYYY-MM-DD
  status: string | null;
  created_date: string | null;
  spend: number;
  revenue: number | null;
  roas: number | null;
  cpa: number | null;
  cpc: number | null;
  cpm: number | null;
  v3s: number | null;
  hook_rate: number | null;
  v25: number | null;
  v50: number | null;
  v75: number | null;
  freq: number | null;
  cost_atc: number | null;
  link_clicks: number | null;
  cvr: number | null;
  result_rate: number | null;
}

export interface Economics {
  currency: string;
  breakeven: number; // ROAS de punto de equilibrio
  target: number;    // ROAS meta (ganador)
  kill: number;      // gasto sin compras para apagar (≈ 2× CPA breakeven)
}

export const DEFAULT_ECONOMICS: Economics = {
  currency: 'USD',
  breakeven: 1.46,
  target: 2.0,
  kill: 58,
};

// ---------------------------------------------------------------------------
// CSV parsing (maneja comillas, comas internas y BOM)
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const t = v.replace(/[$,%\s]/g, '').replace(/,/g, '');
  if (t === '' || t === '--') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Encuentra el índice de una columna por fragmentos del encabezado. */
function col(headers: string[], ...fragments: string[]): number {
  return headers.findIndex((h) => {
    const l = h.toLowerCase();
    return fragments.every((f) => l.includes(f.toLowerCase()));
  });
}

export interface ParsedCsv {
  rows: DailyRow[];
  warnings: string[];
  dateFrom: string | null;
  dateTo: string | null;
}

/** Parsea el export estándar del socio (nivel anuncio, por día). */
export function parseMetaExport(text: string): ParsedCsv {
  const raw = parseCsv(text);
  if (raw.length < 2) return { rows: [], warnings: ['El archivo está vacío.'], dateFrom: null, dateTo: null };
  const h = raw[0];

  const idx = {
    start: col(h, 'inicio del informe'),
    name: col(h, 'nombre del anuncio'),
    status: col(h, 'entrega del anuncio'),
    created: col(h, 'fecha de creaci'),
    spend: col(h, 'importe gastado'),
    revenue: col(h, 'valor de resultados'),
    roas: col(h, 'roas'),
    cpa: col(h, 'costo por compra'),
    cpc: col(h, 'costo por clic'),
    resultRate: col(h, 'tasa de resultados'),
    cpm: col(h, 'cpm'),
    v3s: col(h, '3 segundos'),
    hook: col(h, 'hook'),
    v25: col(h, 'hasta el 25'),
    v50: col(h, 'hasta el 50'),
    v75: col(h, 'hasta el 75'),
    freq: col(h, 'frecuencia'),
    costAtc: col(h, 'agregado al carrito'),
    clicks: col(h, 'clics en el enlace'),
    cvr: col(h, 'cvr'),
  };

  const warnings: string[] = [];
  const critical: Array<[keyof typeof idx, string]> = [
    ['start', 'Inicio del informe (¿exportaste con desglose por día?)'],
    ['name', 'Nombre del anuncio'],
    ['spend', 'Importe gastado'],
  ];
  for (const [k, label] of critical) if (idx[k] < 0) warnings.push(`Falta la columna: ${label}`);
  const nice: Array<[keyof typeof idx, string]> = [
    ['roas', 'ROAS de compras'], ['cpa', 'Costo por compra'], ['cpm', 'CPM'],
    ['hook', 'HOOK RATE'], ['v75', 'Reproducciones hasta el 75%'], ['freq', 'Frecuencia'],
    ['costAtc', 'Costo por ATC'], ['cvr', 'cvr'],
  ];
  for (const [k, label] of nice) if (idx[k] < 0) warnings.push(`Columna recomendada ausente: ${label}`);
  if (warnings.some((w) => w.startsWith('Falta'))) return { rows: [], warnings, dateFrom: null, dateTo: null };

  const rows: DailyRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const name = (r[idx.name] ?? '').trim();
    const date = (r[idx.start] ?? '').trim();
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    rows.push({
      ad_name: name,
      date,
      status: idx.status >= 0 ? (r[idx.status] ?? '').trim() || null : null,
      created_date: idx.created >= 0 && /^\d{4}-\d{2}-\d{2}/.test(r[idx.created] ?? '') ? r[idx.created].slice(0, 10) : null,
      spend: num(r[idx.spend]) ?? 0,
      revenue: idx.revenue >= 0 ? num(r[idx.revenue]) : null,
      roas: idx.roas >= 0 ? num(r[idx.roas]) : null,
      cpa: idx.cpa >= 0 ? num(r[idx.cpa]) : null,
      cpc: idx.cpc >= 0 ? num(r[idx.cpc]) : null,
      cpm: idx.cpm >= 0 ? num(r[idx.cpm]) : null,
      v3s: idx.v3s >= 0 ? num(r[idx.v3s]) : null,
      hook_rate: idx.hook >= 0 ? num(r[idx.hook]) : null,
      v25: idx.v25 >= 0 ? num(r[idx.v25]) : null,
      v50: idx.v50 >= 0 ? num(r[idx.v50]) : null,
      v75: idx.v75 >= 0 ? num(r[idx.v75]) : null,
      freq: idx.freq >= 0 ? num(r[idx.freq]) : null,
      cost_atc: idx.costAtc >= 0 ? num(r[idx.costAtc]) : null,
      link_clicks: idx.clicks >= 0 ? num(r[idx.clicks]) : null,
      cvr: idx.cvr >= 0 ? num(r[idx.cvr]) : null,
      result_rate: idx.resultRate >= 0 ? num(r[idx.resultRate]) : null,
    });
  }
  const dates = rows.map((r) => r.date).sort();
  return { rows, warnings, dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null };
}

// ---------------------------------------------------------------------------
// Agregación por anuncio sobre un rango de fechas
// ---------------------------------------------------------------------------
export interface AdAggregate {
  ad_name: string;
  status: string | null;
  days: number;
  spend: number;
  revenue: number;
  purchases: number;
  roas: number | null;
  cpa: number | null;
  cpm: number | null;
  cpc: number | null;
  impressions: number;
  v3s: number;
  hook_rate: number | null;
  ret25: number | null;  // % de los que vieron 3s que llegaron al 25%
  ret50: number | null;
  ret75: number | null;
  freq: number | null;
  cost_atc: number | null;
  atc: number;
  link_clicks: number;
  cvr: number | null;
  last_date: string | null;
  spend_last3: number;
  roas_last3: number | null;
}

/** Agrega filas diarias por anuncio. Deriva impresiones (spend/cpm), compras (spend/cpa) y ATC (spend/$atc). */
export function aggregateAds(rows: DailyRow[]): AdAggregate[] {
  const by = new Map<string, DailyRow[]>();
  for (const r of rows) {
    const arr = by.get(r.ad_name) ?? [];
    arr.push(r);
    by.set(r.ad_name, arr);
  }
  const out: AdAggregate[] = [];
  for (const [name, days] of by) {
    days.sort((a, b) => a.date.localeCompare(b.date));
    let spend = 0, revenue = 0, purchases = 0, impressions = 0, v3s = 0, atc = 0, clicks = 0;
    let w25 = 0, w50 = 0, w75 = 0, freqW = 0, freqSpend = 0;
    for (const d of days) {
      spend += d.spend;
      if (d.revenue != null) revenue += d.revenue;
      else if (d.roas != null) revenue += d.roas * d.spend;
      if (d.cpa && d.cpa > 0) purchases += d.spend / d.cpa;
      if (d.cpm && d.cpm > 0) impressions += (d.spend / d.cpm) * 1000;
      if (d.v3s != null) v3s += d.v3s;
      if (d.cost_atc && d.cost_atc > 0) atc += d.spend / d.cost_atc;
      if (d.link_clicks != null) clicks += d.link_clicks;
      if (d.v25 != null) w25 += d.v25;
      if (d.v50 != null) w50 += d.v50;
      if (d.v75 != null) w75 += d.v75;
      if (d.freq != null) { freqW += d.freq * d.spend; freqSpend += d.spend; }
    }
    const last3 = days.slice(-3);
    const s3 = last3.reduce((a, d) => a + d.spend, 0);
    const r3 = last3.reduce((a, d) => a + (d.revenue ?? (d.roas != null ? d.roas * d.spend : 0)), 0);
    const status = days[days.length - 1].status;
    out.push({
      ad_name: name,
      status,
      days: days.length,
      spend,
      revenue,
      purchases: Math.round(purchases * 10) / 10,
      roas: spend > 0 && revenue > 0 ? revenue / spend : null,
      cpa: purchases > 0.05 ? spend / purchases : null,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
      cpc: clicks > 0 ? spend / clicks : null,
      impressions: Math.round(impressions),
      v3s,
      hook_rate: impressions > 0 && v3s > 0 ? (v3s / impressions) * 100 : null,
      ret25: v3s > 0 && w25 > 0 ? (w25 / v3s) * 100 : null,
      ret50: v3s > 0 && w50 > 0 ? (w50 / v3s) * 100 : null,
      ret75: v3s > 0 && w75 > 0 ? (w75 / v3s) * 100 : null,
      freq: freqSpend > 0 ? freqW / freqSpend : null,
      cost_atc: atc > 0.05 ? spend / atc : null,
      atc: Math.round(atc * 10) / 10,
      link_clicks: clicks,
      cvr: clicks > 0 && purchases > 0.05 ? (purchases / clicks) * 100 : null,
      last_date: days[days.length - 1].date,
      spend_last3: s3,
      roas_last3: s3 > 0 ? r3 / s3 : null,
    });
  }
  return out.sort((a, b) => b.spend - a.spend);
}

// ---------------------------------------------------------------------------
// Veredicto por anuncio (reglas de la cuenta)
// ---------------------------------------------------------------------------
export type VerdictId = 'ganador' | 'prometedor' | 'dejar' | 'apagar' | 'sin_datos';

export interface Verdict {
  id: VerdictId;
  label: string;
  why: string;
}

export function verdictFor(ad: AdAggregate, eco: Economics): Verdict {
  const minSpend = eco.kill * 0.5; // gasto mínimo para opinar
  if (ad.spend < minSpend) {
    return { id: 'sin_datos', label: 'Sin datos', why: `Gasto ${fmtMoney(ad.spend, eco.currency)} < ${fmtMoney(minSpend, eco.currency)}: dejar correr, no diagnosticar con ruido.` };
  }
  if (ad.spend >= eco.kill && ad.purchases < 0.5) {
    return { id: 'apagar', label: 'Apagar', why: `${fmtMoney(ad.spend, eco.currency)} gastados sin compras (kill = ${fmtMoney(eco.kill, eco.currency)}).` };
  }
  const roas = ad.roas ?? 0;
  if (roas >= eco.target && ad.spend >= eco.kill) {
    const fatiga = ad.roas_last3 != null && ad.roas_last3 < eco.breakeven && ad.spend_last3 > eco.kill * 0.3;
    if (fatiga) return { id: 'prometedor', label: 'Ganador ↓', why: `ROAS acumulado ${roas.toFixed(2)} pero los últimos 3 días cayó a ${ad.roas_last3!.toFixed(2)}: posible fatiga, preparar variante.` };
    return { id: 'ganador', label: 'Ganador', why: `ROAS ${roas.toFixed(2)} ≥ meta ${eco.target} con ${fmtMoney(ad.spend, eco.currency)} de gasto real.` };
  }
  if (roas >= eco.breakeven) {
    return { id: 'prometedor', label: 'Prometedor', why: `ROAS ${roas.toFixed(2)} entre breakeven ${eco.breakeven} y meta ${eco.target}: dejar y vigilar.` };
  }
  if (roas > 0) {
    return { id: 'dejar', label: 'Recortar', why: `ROAS ${roas.toFixed(2)} < breakeven ${eco.breakeven} con gasto suficiente: recortar o apagar.` };
  }
  return { id: 'dejar', label: 'Vigilar', why: `Sin ROAS registrado con ${fmtMoney(ad.spend, eco.currency)} de gasto.` };
}

export function fmtMoney(n: number, currency = 'USD'): string {
  const sym = currency === 'MXN' ? '$' : '$';
  return `${sym}${n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)}`;
}

/** Prompt listo para pegar en la IA de Meta según el veredicto del anuncio. */
export function metaAiPrompt(ad: AdAggregate, v: Verdict, eco: Economics): string {
  const base = `Analiza el anuncio "${ad.ad_name}" (últimos ${ad.days} días: gasto ${fmtMoney(ad.spend, eco.currency)}, ROAS ${ad.roas?.toFixed(2) ?? 'N/D'}, hook rate ${ad.hook_rate?.toFixed(1) ?? 'N/D'}%, retención al 75% ${ad.ret75?.toFixed(0) ?? 'N/D'}%, frecuencia ${ad.freq?.toFixed(1) ?? 'N/D'}).`;
  const ask: Record<VerdictId, string> = {
    ganador: '¿Qué está haciendo que este anuncio gane? Dame la curva de retención por segundo, desglose por edad/género/ubicación y qué audiencia está convirtiendo mejor vs el resto de la cuenta.',
    prometedor: '¿Qué le falta para escalar? Compara su CTR, retención y CVR contra el promedio de la cuenta y dime dónde está la fuga.',
    dejar: '¿Dónde pierde a la gente este anuncio? Curva de retención por segundo y en qué segundo cae más vs los ganadores de la cuenta.',
    apagar: '¿Hubo algún segmento (edad/género/placement) donde sí funcionó antes de apagarlo?',
    sin_datos: '¿Cómo va la fase de aprendizaje de este anuncio vs otros lanzados la misma semana?',
  };
  return `${base}\n\n${ask[v.id]}\n\nDame también: curva de retención por segundo, comparativa vs el promedio de la cuenta, y desglose por edad, género y placement.`;
}
