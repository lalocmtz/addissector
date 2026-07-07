// =============================================================================
// AdDNA — Detección de anuncios ganadores a partir de las métricas de Meta.
// Las métricas viven en ads.metrics (Record<encabezadoMeta, valorString>).
// Extraemos ROAS, CPA, Hook Rate, CTR y gasto, y puntuamos cada anuncio contra
// la MEDIANA de su propio conjunto (funciona sin benchmarks externos).
// =============================================================================

export type AdMetrics = { metrics: Record<string, string> | null; id: string };

export interface ExtractedMetrics {
  roas?: number;
  cpa?: number;
  hookRate?: number;
  ctr?: number;
  spend?: number;
}

const MATCHERS: Record<keyof ExtractedMetrics, RegExp> = {
  roas: /roas/i,
  cpa: /(cost per (result|purchase)|costo por (resultado|compra)|^cpa$)/i,
  hookRate: /(hook rate|tasa de gancho|retencion 3|3-second|reproducciones de video de 3)/i,
  ctr: /ctr/i,
  spend: /(amount spent|importe gastado|gasto)/i,
};

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** "$1,234.56" | "1.234,56" | "12,5%" | "4,5x" | "—" -> number | undefined */
export function parseMetricNumber(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  let s = String(raw).trim();
  if (!s || s === '-' || s === '—' || norm(s) === 'n/a') return undefined;
  s = s.replace(/[^\d.,-]/g, '');
  if (!s) return undefined;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) {
    s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lc > -1) {
    const after = s.length - lc - 1;
    s = after > 0 && after <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (ld > -1) {
    const after = s.length - ld - 1;
    const dots = (s.match(/\./g) || []).length;
    if (dots > 1 || after === 3) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Extrae las métricas clave del Record crudo de Meta. */
export function extractMetrics(metrics: Record<string, string> | null): ExtractedMetrics {
  const out: ExtractedMetrics = {};
  if (!metrics) return out;
  const entries = Object.entries(metrics);
  (Object.keys(MATCHERS) as (keyof ExtractedMetrics)[]).forEach((key) => {
    const hit = entries.find(([h]) => MATCHERS[key].test(norm(h)));
    if (hit) {
      const v = parseMetricNumber(hit[1]);
      if (v !== undefined) out[key] = v;
    }
  });
  return out;
}

export type Verdict = 'ganador' | 'promedio' | 'pausar' | 'sin-datos';

export interface AdScore {
  id: string;
  score: number;
  verdict: Verdict;
  reason: string;
  extracted: ExtractedMetrics;
  hasData: boolean;
}

function median(nums: number[]): number | undefined {
  const v = nums.filter((n) => typeof n === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : undefined;
}
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Puntúa todos los anuncios de un conjunto y devuelve verdict + razón por cada
 * uno. Ponderación: ROAS (x3) > CPA invertido (x2) > Hook (x1.5) > CTR (x1),
 * todo relativo a la mediana del conjunto.
 */
export function scoreSet(ads: AdMetrics[]): Map<string, AdScore> {
  const ext = ads.map((a) => ({ id: a.id, e: extractMetrics(a.metrics) }));
  const withData = ext.filter((x) => Object.keys(x.e).length > 0);

  const mRoas = median(withData.map((x) => x.e.roas!).filter((n) => n != null));
  const mCpa = median(withData.map((x) => x.e.cpa!).filter((n) => n != null));
  const mHook = median(withData.map((x) => x.e.hookRate!).filter((n) => n != null));
  const mCtr = median(withData.map((x) => x.e.ctr!).filter((n) => n != null));

  const result = new Map<string, AdScore>();
  for (const { id, e } of ext) {
    const hasData = Object.keys(e).length > 0;
    if (!hasData) {
      result.set(id, { id, score: 0, verdict: 'sin-datos', reason: 'Sube el reporte de Meta para evaluar.', extracted: e, hasData });
      continue;
    }
    let score = 0;
    const reasons: string[] = [];
    if (e.roas !== undefined && mRoas) {
      score += (e.roas / mRoas - 1) * 3;
      reasons.push(`ROAS ${r1(e.roas)} vs mediana ${r1(mRoas)}`);
    }
    if (e.cpa !== undefined && mCpa) {
      score += (mCpa / e.cpa - 1) * 2;
      reasons.push(`CPA ${r1(e.cpa)} vs mediana ${r1(mCpa)}`);
    }
    if (e.hookRate !== undefined && mHook) {
      score += (e.hookRate / mHook - 1) * 1.5;
      reasons.push(`Hook ${r1(e.hookRate)}% vs ${r1(mHook)}%`);
    }
    if (e.ctr !== undefined && mCtr) {
      score += (e.ctr / mCtr - 1) * 1;
    }
    const verdict: Verdict = score > 0.3 ? 'ganador' : score < -0.3 ? 'pausar' : 'promedio';
    result.set(id, { id, score: r1(score), verdict, reason: reasons.join(' · ') || 'Métricas cargadas', extracted: e, hasData });
  }
  return result;
}

/** Id del mejor anuncio del conjunto (o null si nadie tiene datos). */
export function winnerId(ads: AdMetrics[]): string | null {
  const scores = [...scoreSet(ads).values()].filter((s) => s.hasData);
  if (!scores.length) return null;
  scores.sort((a, b) => b.score - a.score);
  return scores[0].verdict === 'ganador' ? scores[0].id : null;
}

// ---------------------------------------------------------------------------
// Checklist de columnas de Meta y validación del export.
// REQUIRED = lo mínimo para determinar un ganador. El resto suma contexto.
// ---------------------------------------------------------------------------

export interface MetaColumn {
  key: string;
  label: string;
  matcher: RegExp;
  required: boolean;
  help: string;
}

export const META_COLUMNS: MetaColumn[] = [
  { key: 'name', label: 'Nombre del anuncio', required: true,
    matcher: /ad name|nombre del anuncio|^anuncio$|^ad$/,
    help: 'Imprescindible: empata cada anuncio con tu maqueta.' },
  { key: 'roas', label: 'ROAS (retorno de la inversión)', required: true,
    matcher: /roas/,
    help: 'Cuántos pesos regresas por cada peso gastado. Define rentabilidad.' },
  { key: 'cpa', label: 'Costo por resultado (CPA)', required: true,
    matcher: /cost per (result|purchase)|costo por (resultado|compra)|^cpa$/,
    help: 'Qué tan caro sale cada compra o resultado.' },
  { key: 'hook', label: 'Hook Rate (retención 3s / ThruPlay)', required: true,
    matcher: /hook rate|retencion 3|3-second|reproducciones de video de 3|thruplay/,
    help: 'Fuerza del gancho en los primeros segundos.' },
  { key: 'ctr', label: 'CTR (todos)', required: true,
    matcher: /ctr/,
    help: 'Qué % de quienes lo ven le dan clic.' },
  { key: 'spend', label: 'Gasto (importe gastado)', required: true,
    matcher: /amount spent|importe gastado|gasto/,
    help: 'Contexto de inversión: sin gasto suficiente no hay lectura confiable.' },
  { key: 'impressions', label: 'Impresiones', required: false,
    matcher: /impressions|impresiones/,
    help: 'Volumen de veces que se mostró.' },
  { key: 'video_pct', label: 'Reproducciones de video 25/50/75/95/100%', required: false,
    matcher: /video (plays|watches).*(25|50|75|95|100)|reproducciones de video (al|hasta)/,
    help: 'Curva de retención del video.' },
  { key: 'clicks', label: 'Clics (todos)', required: false,
    matcher: /clicks \(all\)|clics \(todos\)|^clicks$|^clics$/,
    help: 'Volumen de clics.' },
  { key: 'purchases', label: 'Compras / resultados', required: false,
    matcher: /purchases|compras|results|resultados/,
    help: 'Número de conversiones.' },
];

export interface HeaderCheck {
  presentKeys: string[];
  missingRequired: string[]; // labels
  ignoredExtras: number;      // columnas que no usamos
}

/** Revisa los encabezados del export: qué obligatorias faltan y cuántas
 *  columnas extra se ignoran. */
export function checkHeaders(headers: string[]): HeaderCheck {
  const present = new Set<string>();
  const used = new Set<number>();
  headers.forEach((h, i) => {
    const nh = norm(h);
    for (const col of META_COLUMNS) {
      if (col.matcher.test(nh)) { present.add(col.key); used.add(i); }
    }
  });
  const missingRequired = META_COLUMNS
    .filter((c) => c.required && !present.has(c.key))
    .map((c) => c.label);
  const ignoredExtras = headers.filter((h, i) => h && !used.has(i)).length;
  return { presentKeys: [...present], missingRequired, ignoredExtras };
}
