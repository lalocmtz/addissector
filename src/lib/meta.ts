// =============================================================================
// Meta CSV export parser + brand economics + per-ad verdict rules.
//
// Aggregation lives in src/lib/metrics.ts (canonical definitions). This file
// keeps the CSV path (still useful for accounts without API access) and the
// verdict rules that read a per-ad aggregate against the brand economics.
// Money is always formatted with the ISO currency code of the ad account.
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

/**
 * Brand economics: thresholds in the ACCOUNT currency. The currency itself is
 * not part of this object anymore — it is derived from Meta and lives in
 * ad_account.currency (never typed by hand).
 */
export interface Band { bad: number; good: number }

export interface Economics {
  breakeven: number; // ROAS de equilibrio = AOV / margen de contribucion
  target: number;    // ROAS objetivo (ganador) = AOV / CAC objetivo
  kill: number;      // piso de gasto sin compras que significa "apagar"
  /** Multiplo del CPA objetivo a partir del cual un veredicto es confiable. */
  signalMultiple: number;
  /** Caida de ROAS 7d vs 14d que enciende "Vigilar" (negativo, p.ej. -0.20). */
  fatigueDrop: number;
  /** Frecuencia a partir de la cual vigilar. */
  freqWatch: number;
  /** Bandas creativas, calibradas con p25/p75 de la propia cuenta. */
  hook: Band;
  hold: Band;
  ret75: Band;
  /** Economia unitaria, para poder explicar de donde sale el breakeven. */
  aov: number | null;
  cac: number | null;
  unitCost: number | null;
}

export const DEFAULT_ECONOMICS: Economics = {
  breakeven: 1.56,
  target: 2.0,
  kill: 58,
  signalMultiple: 2,
  fatigueDrop: -0.2,
  freqWatch: 2.5,
  hook: { bad: 0.10, good: 0.22 },
  hold: { bad: 0.17, good: 0.30 },
  ret75: { bad: 0.09, good: 0.20 },
  aov: null,
  cac: null,
  unitCost: null,
};

const pos = (v: unknown, fallback: number): number => (Number(v) > 0 ? Number(v) : fallback);
const banda = (v: unknown, fallback: Band): Band => {
  const b = (v ?? {}) as Partial<Band>;
  return { bad: pos(b.bad, fallback.bad), good: pos(b.good, fallback.good) };
};
const posOrNull = (v: unknown): number | null => (Number(v) > 0 ? Number(v) : null);

/** Mezcla el blob guardado en brands.economics con los defaults. */
export function resolveEconomics(raw: unknown): Economics {
  const e = (raw ?? {}) as Record<string, unknown>;
  const fatigue = Number(e.fatigueDrop);
  return {
    breakeven: pos(e.breakeven, DEFAULT_ECONOMICS.breakeven),
    target: pos(e.target, DEFAULT_ECONOMICS.target),
    kill: pos(e.kill, DEFAULT_ECONOMICS.kill),
    signalMultiple: pos(e.signalMultiple, DEFAULT_ECONOMICS.signalMultiple),
    fatigueDrop: Number.isFinite(fatigue) && fatigue < 0 ? fatigue : DEFAULT_ECONOMICS.fatigueDrop,
    freqWatch: pos(e.freqWatch, DEFAULT_ECONOMICS.freqWatch),
    hook: banda(e.hook, DEFAULT_ECONOMICS.hook),
    hold: banda(e.hold, DEFAULT_ECONOMICS.hold),
    ret75: banda(e.ret75, DEFAULT_ECONOMICS.ret75),
    aov: posOrNull(e.aov),
    cac: posOrNull(e.cac),
    unitCost: posOrNull(e.unitCost),
  };
}

/** CPA objetivo: el CAC declarado, o el que implica AOV / ROAS objetivo. */
export function targetCpa(e: Economics): number | null {
  if (e.cac) return e.cac;
  if (e.aov && e.target > 0) return e.aov / e.target;
  return null;
}

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
  const merged = mergeDuplicateDays(rows);
  const dates = merged.map((r) => r.date).sort();
  return { rows: merged, warnings, dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null };
}

/**
 * Fusiona filas repetidas del mismo anuncio+día (pasa cuando un ad corre en
 * más de una campaña). Suma los volúmenes y re-deriva las tasas; sin esto el
 * upsert de Postgres truena con "ON CONFLICT DO UPDATE ... a second time".
 */
export function mergeDuplicateDays(rows: DailyRow[]): DailyRow[] {
  const by = new Map<string, DailyRow[]>();
  for (const r of rows) {
    const k = `${r.ad_name}|${r.date}`;
    const arr = by.get(k) ?? [];
    arr.push(r);
    by.set(k, arr);
  }
  const out: DailyRow[] = [];
  for (const group of by.values()) {
    if (group.length === 1) { out.push(group[0]); continue; }
    const spend = group.reduce((s, r) => s + (r.spend ?? 0), 0);
    let revenue = 0, hasRev = false;
    let purchases = 0, impressions = 0, atc = 0, clicks = 0, hasClicks = false;
    let v3s = 0, hasV3s = false, v25 = 0, has25 = false, v50 = 0, has50 = false, v75 = 0, has75 = false;
    let freqW = 0, freqSpend = 0, rrW = 0, rrSpend = 0;
    for (const r of group) {
      if (r.revenue != null) { revenue += r.revenue; hasRev = true; }
      else if (r.roas != null) { revenue += r.roas * r.spend; hasRev = true; }
      if (r.cpa && r.cpa > 0) purchases += r.spend / r.cpa;
      if (r.cpm && r.cpm > 0) impressions += (r.spend / r.cpm) * 1000;
      if (r.cost_atc && r.cost_atc > 0) atc += r.spend / r.cost_atc;
      if (r.link_clicks != null) { clicks += r.link_clicks; hasClicks = true; }
      if (r.v3s != null) { v3s += r.v3s; hasV3s = true; }
      if (r.v25 != null) { v25 += r.v25; has25 = true; }
      if (r.v50 != null) { v50 += r.v50; has50 = true; }
      if (r.v75 != null) { v75 += r.v75; has75 = true; }
      if (r.freq != null) { freqW += r.freq * r.spend; freqSpend += r.spend; }
      if (r.result_rate != null) { rrW += r.result_rate * r.spend; rrSpend += r.spend; }
    }
    const base = group.reduce((a, b) => (b.spend > a.spend ? b : a));
    out.push({
      ...base,
      spend,
      revenue: hasRev ? revenue : null,
      roas: hasRev && spend > 0 ? revenue / spend : null,
      cpa: purchases > 0.001 ? spend / purchases : null,
      cpc: clicks > 0 ? spend / clicks : null,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
      v3s: hasV3s ? v3s : null,
      hook_rate: impressions > 0 && v3s > 0 ? (v3s / impressions) * 100 : base.hook_rate,
      v25: has25 ? v25 : null,
      v50: has50 ? v50 : null,
      v75: has75 ? v75 : null,
      freq: freqSpend > 0 ? freqW / freqSpend : null,
      cost_atc: atc > 0.001 ? spend / atc : null,
      link_clicks: hasClicks ? clicks : null,
      cvr: clicks > 0 && purchases > 0.001 ? (purchases / clicks) * 100 : null,
      result_rate: rrSpend > 0 ? rrW / rrSpend : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-ad verdict (account rules). Labels are i18n keys resolved by the UI.
// ---------------------------------------------------------------------------
/**
 * OJO: el vocabulario del veredicto vive en src/lib/verdict.ts. Este alias
 * existe solo para el prompt de abajo y se mantiene laxo a proposito, para no
 * crear una dependencia circular entre meta.ts y verdict.ts.
 */
export type VerdictId = string;

export interface Verdict {
  id: VerdictId;
  /** i18n key, e.g. verdict.winner */
  labelKey: string;
  /** English explanation with the numbers behind the call (used in prompts and as fallback copy). */
  why: string;
}

/** The subset of an aggregate the verdict needs. */
export interface VerdictInput {
  spend: number;
  purchases: number | null;
  roas: number | null;
  spend_last3: number;
  roas_last3: number | null;
}

export function verdictFor(ad: VerdictInput, eco: Economics, currency: string | null = null): Verdict {
  const m = (n: number) => fmtMoney(n, currency);
  const minSpend = eco.kill * 0.5; // minimum spend to have an opinion
  const purchases = ad.purchases ?? 0;
  if (ad.spend < minSpend) {
    return { id: 'sin_datos', labelKey: 'verdict.noData', why: `Spend ${m(ad.spend)} < ${m(minSpend)}: let it run, do not diagnose noise.` };
  }
  if (ad.spend >= eco.kill && purchases < 0.5) {
    return { id: 'apagar', labelKey: 'verdict.kill', why: `${m(ad.spend)} spent without purchases (kill = ${m(eco.kill)}).` };
  }
  const roas = ad.roas ?? 0;
  if (roas >= eco.target && ad.spend >= eco.kill) {
    const fatigue = ad.roas_last3 != null && ad.roas_last3 < eco.breakeven && ad.spend_last3 > eco.kill * 0.3;
    if (fatigue) return { id: 'prometedor', labelKey: 'verdict.winnerFading', why: `Cumulative ROAS ${roas.toFixed(2)} but the last 3 days dropped to ${ad.roas_last3!.toFixed(2)}: possible fatigue, prepare a variant.` };
    return { id: 'ganador', labelKey: 'verdict.winner', why: `ROAS ${roas.toFixed(2)} ≥ target ${eco.target} with ${m(ad.spend)} of real spend.` };
  }
  if (roas >= eco.breakeven) {
    return { id: 'prometedor', labelKey: 'verdict.promising', why: `ROAS ${roas.toFixed(2)} between break-even ${eco.breakeven} and target ${eco.target}: keep and watch.` };
  }
  if (roas > 0) {
    return { id: 'dejar', labelKey: 'verdict.cut', why: `ROAS ${roas.toFixed(2)} < break-even ${eco.breakeven} with enough spend: cut or kill.` };
  }
  return { id: 'dejar', labelKey: 'verdict.watch', why: `No ROAS recorded with ${m(ad.spend)} of spend.` };
}

/**
 * Money with the ISO code, never a bare "$": "USD 1,240" / "MXN 18,500".
 * Without a known currency the number is shown with a generic sign so a wrong
 * currency is never implied.
 */
export function fmtMoney(n: number, currency: string | null | undefined): string {
  const digits = Math.abs(n) >= 100 ? 0 : 2;
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, currencyDisplay: 'code',
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(n).replace(/\u00a0/g, ' ');
  }
  return `¤${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Prompt ready to paste into Meta's AI, per verdict. */
export function metaAiPrompt(
  ad: VerdictInput & { ad_name: string; days: number; hook_rate: number | null; ret75: number | null; freq: number | null },
  v: { id: string; why: string }, eco: Economics, currency: string | null = null
): string {
  const base = `Analiza el anuncio "${ad.ad_name}" (últimos ${ad.days} días: gasto ${fmtMoney(ad.spend, currency)}, ROAS ${ad.roas?.toFixed(2) ?? 'N/D'}, hook rate ${ad.hook_rate?.toFixed(1) ?? 'N/D'}%, retención al 75% ${ad.ret75?.toFixed(0) ?? 'N/D'}%, frecuencia ${ad.freq?.toFixed(1) ?? 'N/D'}).`;
  const ask: Record<string, string> = {
    ganador: '¿Qué está haciendo que este anuncio gane? Dame la curva de retención por segundo, desglose por edad/género/ubicación y qué audiencia está convirtiendo mejor vs el resto de la cuenta.',
    prometedor: '¿Qué le falta para escalar? Compara su CTR, retención y CVR contra el promedio de la cuenta y dime dónde está la fuga.',
    potencial: '¿Qué le falta para escalar? Compara su CTR, retención y CVR contra el promedio de la cuenta y dime dónde está la fuga.',
    mantener: '¿Dónde pierde a la gente este anuncio? Curva de retención por segundo y en qué segundo cae más vs los ganadores de la cuenta.',
    vigilar: '¿Está fatigándose? Dame frecuencia, alcance nuevo vs repetido y cómo cambió la retención en los últimos 7 días contra los 7 previos.',
    dejar: '¿Dónde pierde a la gente este anuncio? Curva de retención por segundo y en qué segundo cae más vs los ganadores de la cuenta.',
    apagar: '¿Hubo algún segmento (edad/género/placement) donde sí funcionó antes de apagarlo?',
    sin_datos: '¿Cómo va la fase de aprendizaje de este anuncio vs otros lanzados la misma semana?',
  };
  void eco;
  return `${base}\n\n${(ask[v.id] ?? ask.sin_datos)}\n\nDame también: curva de retención por segundo, comparativa vs el promedio de la cuenta, y desglose por edad, género y placement.`;
}
