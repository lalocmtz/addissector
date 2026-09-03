// =============================================================================
// AdDNA — Motor de Planificación.
// Nomenclatura, agregación por concepto/ángulo y veredictos de nivel superior.
//
// La cadena: Persona → Ángulo → Concepto → Anuncio.
// El puente con Meta es planned_ads.meta_ad_id. El nombre generado aquí solo
// sirve para el PRIMER emparejamiento (src/lib/ad-matching.ts); después el id
// queda fijo y el nombre deja de importar.
// =============================================================================

import { fmtMoney, type Economics } from '@/lib/meta';
import type { AdAggregate } from '@/lib/metrics';

// ---------------------------------------------------------------------------
// Nomenclatura
// ---------------------------------------------------------------------------

/** Prefijo de 2-3 letras a partir del nombre de la marca. SKINGLOW → SG. */
export function brandPrefix(brandName: string | null | undefined): string {
  const clean = (brandName ?? 'MARCA').toUpperCase().replace(/[^A-Z\s]/g, '').trim();
  if (!clean) return 'MK';
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).slice(0, 2);
  const w = words[0];
  // Una sola palabra: primera + primera consonante siguiente (SKINGLOW → SG)
  const consonant = w.slice(1).split('').find((c) => !'AEIOU'.includes(c));
  return (w[0] + (consonant ?? w[1] ?? 'X')).slice(0, 2);
}

/** Normaliza un código de ángulo: mayúsculas, sin acentos ni espacios. */
export function normalizeCode(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

/** SG_028_YAPROBE — el código del concepto (sin variante). */
export function conceptCode(prefix: string, num: number, angleCode?: string | null): string {
  const nn = String(num).padStart(3, '0');
  return [prefix, nn, angleCode ? normalizeCode(angleCode) : null].filter(Boolean).join('_');
}

/** SG_028_YAPROBE_C — el nombre exacto que se pega en Meta. */
export function plannedAdName(conceptCodeStr: string, variant: string): string {
  return `${conceptCodeStr}_${variant.toUpperCase()}`;
}

/** Letras de variante: A, B, C… Z, luego AA, AB… */
export function variantLetter(index: number): string {
  let i = index, out = '';
  do { out = String.fromCharCode(65 + (i % 26)) + out; i = Math.floor(i / 26) - 1; } while (i >= 0);
  return out;
}

export interface ParsedPlannedName {
  prefix: string | null;
  number: number | null;
  angleCode: string | null;
  variant: string | null;
  canonical: boolean;
}

/** Lee un nombre canónico (SG_028_YAPROBE_C) y, si no lo es, intenta heurísticas
 *  sobre los formatos reales de la cuenta (#28_C, ##13_A, B07_10, CR_00496_C). */
export function parsePlannedName(raw: string): ParsedPlannedName {
  const name = raw
    .replace(/\.(mp4|mov|m4v|jpe?g|png|webp|gif)$/i, '')
    .replace(/_720p|_1080p|\(HD\)/gi, '')
    .trim();

  const canon = /^([A-Z]{2,3})_(\d{2,4})_([A-Z0-9]+)_([A-Z0-9]{1,3})$/.exec(name);
  if (canon) {
    return { prefix: canon[1], number: Number(canon[2]), angleCode: canon[3], variant: canon[4], canonical: true };
  }

  // "SK Crema Aclarante AD #28_C" · "SK Crema Aclarante ##13_A" · "#45_ B"
  const hash = /#{1,2}\s*(\d{1,4})\s*_\s*([A-Z](?:_[A-Z])?)\b/i.exec(name);
  if (hash) {
    return { prefix: null, number: Number(hash[1]), angleCode: null, variant: hash[2].toUpperCase(), canonical: false };
  }

  // "SG#63_V1" · "B08 | SG#5_V1" · "SG40_V1"
  const sg = /SG\s*#?(\d{1,3})_(V\d{1,2})/i.exec(name);
  if (sg) {
    return { prefix: 'SG', number: Number(sg[1]), angleCode: null, variant: sg[2].toUpperCase(), canonical: false };
  }

  // "CR_00496_C"
  const cr = /^CR_(\d{3,5})_([A-Z])$/i.exec(name);
  if (cr) {
    return { prefix: 'CR', number: Number(cr[1]), angleCode: null, variant: cr[2].toUpperCase(), canonical: false };
  }

  // "B07_10" — lote con variante numérica
  const lote = /^(B\d{2})_(\d{1,2})$/i.exec(name);
  if (lote) {
    return { prefix: lote[1].toUpperCase(), number: null, angleCode: null, variant: lote[2], canonical: false };
  }

  return { prefix: null, number: null, angleCode: null, variant: null, canonical: false };
}

// ---------------------------------------------------------------------------
// Agregación por concepto / ángulo
// ---------------------------------------------------------------------------

export interface RollupMetrics {
  ads: number;
  adsWithData: number;
  spend: number;
  revenue: number;
  purchases: number;
  roas: number | null;
  cpa: number | null;
  impressions: number;
  v3s: number;
  hookRate: number | null;   // ponderado por impresiones
  ret75: number | null;      // ponderado por v3s
  clicks: number;
  cvr: number | null;
  spendLast3: number;
  roasLast3: number | null;
}

const EMPTY: RollupMetrics = {
  ads: 0, adsWithData: 0, spend: 0, revenue: 0, purchases: 0, roas: null, cpa: null,
  impressions: 0, v3s: 0, hookRate: null, ret75: null, clicks: 0, cvr: null,
  spendLast3: 0, roasLast3: null,
};

/**
 * Suma correctamente un grupo de anuncios.
 * REGLA: ROAS = suma(ingresos)/suma(gasto). Nunca el promedio de los ROAS.
 * Las tasas (hook, ret75, cvr) se ponderan por su denominador real, no por
 * conteo de anuncios — con gastos de $0.33 y $339 en la misma tabla, el
 * promedio simple miente.
 */
export function rollup(ads: AdAggregate[], totalPlanned = 0): RollupMetrics {
  if (!ads.length) return { ...EMPTY, ads: totalPlanned };
  let spend = 0, revenue = 0, purchases = 0, impressions = 0, v3s = 0, clicks = 0;
  let w75 = 0, spend3 = 0, rev3 = 0;
  for (const a of ads) {
    spend += a.spend;
    revenue += a.revenue ?? 0;
    purchases += a.purchases ?? 0;
    impressions += a.impressions ?? 0;
    v3s += a.v3s ?? 0;
    clicks += a.link_clicks ?? 0;
    if (a.ret75 != null && (a.v3s ?? 0) > 0) w75 += (a.ret75 / 100) * (a.v3s ?? 0);
    spend3 += a.spend_last3;
    if (a.roas_last3 != null) rev3 += a.roas_last3 * a.spend_last3;
  }
  return {
    ads: totalPlanned || ads.length,
    adsWithData: ads.length,
    spend,
    revenue,
    purchases: Math.round(purchases * 10) / 10,
    roas: spend > 0 && revenue > 0 ? revenue / spend : null,
    cpa: purchases > 0.05 ? spend / purchases : null,
    impressions,
    v3s,
    hookRate: impressions > 0 && v3s > 0 ? (v3s / impressions) * 100 : null,
    ret75: v3s > 0 && w75 > 0 ? (w75 / v3s) * 100 : null,
    clicks,
    cvr: clicks > 0 && purchases > 0.05 ? (purchases / clicks) * 100 : null,
    spendLast3: spend3,
    roasLast3: spend3 > 0 && rev3 > 0 ? rev3 / spend3 : null,
  };
}

// ---------------------------------------------------------------------------
// Veredictos de nivel superior
// ---------------------------------------------------------------------------

export type GroupVerdictId = 'ganador' | 'fatiga' | 'prometedor' | 'recortar' | 'sin_datos' | 'sin_gasto';

export interface GroupVerdict {
  id: GroupVerdictId;
  label: string;
  why: string;
  /** Lo que hay que hacer. Es distinto en concepto que en ángulo. */
  action: string;
}

export function conceptVerdict(m: RollupMetrics, eco: Economics, currency: string | null = null): GroupVerdict {
  const money = (n: number) => fmtMoney(n, currency);
  if (m.adsWithData === 0) {
    return { id: 'sin_gasto', label: 'Sin subir', why: 'Todavía no tiene anuncios con datos en Meta.', action: 'Producir y subir.' };
  }
  if (m.spend < eco.kill * 0.5) {
    return { id: 'sin_datos', label: 'Sin datos', why: `Solo ${money(m.spend)} de gasto: es ruido, no señal.`, action: 'Dejar correr.' };
  }
  const roas = m.roas ?? 0;
  if (roas >= eco.target) {
    const fatiga = m.roasLast3 != null && m.roasLast3 < eco.breakeven && m.spendLast3 > eco.kill * 0.3;
    if (fatiga) {
      return {
        id: 'fatiga', label: 'Ganador ↓',
        why: `ROAS ${roas.toFixed(2)} acumulado, pero los últimos 3 días cayó a ${m.roasLast3!.toFixed(2)}.`,
        action: 'Fatiga. Saca variantes de hook esta semana, no lo apagues.',
      };
    }
    return {
      id: 'ganador', label: 'Ganador',
      why: `ROAS ${roas.toFixed(2)} ≥ meta ${eco.target} con ${money(m.spend)} de gasto real.`,
      action: 'Concepto validado. Haz 3 iteraciones y sube presupuesto máximo 20%.',
    };
  }
  if (roas >= eco.breakeven) {
    return {
      id: 'prometedor', label: 'Prometedor',
      why: `ROAS ${roas.toFixed(2)} entre breakeven ${eco.breakeven} y meta ${eco.target}.`,
      action: m.hookRate != null && m.hookRate < 20
        ? 'El hook es el cuello de botella. Cámbialo, no toques el cuerpo.'
        : 'Dejar y vigilar. Si no sube en 5 días, itera el cuerpo.',
    };
  }
  return {
    id: 'recortar', label: 'Recortar',
    why: `ROAS ${roas.toFixed(2)} < breakeven ${eco.breakeven} con ${money(m.spend)} de gasto.`,
    action: 'El empaque falló. El ángulo puede seguir vivo — prueba otro concepto antes de matarlo.',
  };
}

/**
 * Veredicto de ÁNGULO. La diferencia con el concepto es semántica y vale más
 * que el número: un ángulo con un solo concepto fallido NO está muerto —
 * está sin probar de verdad. Matar un ángulo por una mala ejecución es el
 * error más caro de la estrategia creativa.
 */
export function angleVerdict(m: RollupMetrics, conceptsTested: number, eco: Economics, currency: string | null = null): GroupVerdict {
  const base = conceptVerdict(m, eco, currency);
  if (base.id === 'recortar' && conceptsTested < 3) {
    return {
      ...base,
      label: 'No concluyente',
      why: `${base.why} Pero solo probaste ${conceptsTested} concepto${conceptsTested === 1 ? '' : 's'}.`,
      action: `No mates este ángulo todavía. Prueba ${3 - conceptsTested} concepto(s) más con otro formato narrativo.`,
    };
  }
  if (base.id === 'recortar') {
    return { ...base, action: `${conceptsTested} conceptos probados y ninguno funcionó. La razón de compra no existe para esta audiencia. Archivar.` };
  }
  if (base.id === 'ganador') {
    return { ...base, action: 'Ángulo validado. Es tu mina: sácale más conceptos con formatos narrativos distintos.' };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Estados de la planificación
// ---------------------------------------------------------------------------

export const CONCEPT_STATUS = [
  { id: 'idea', label: 'Idea', cls: 'border-line-strong text-ink-3' },
  { id: 'brief', label: 'Brief listo', cls: 'border-warn/40 text-warn' },
  { id: 'produccion', label: 'En producción', cls: 'border-accent/40 text-accent' },
  { id: 'listo', label: 'Listo para subir', cls: 'border-accent/40 text-accent' },
  { id: 'subido', label: 'Subido', cls: 'border-ok/40 text-ok' },
  { id: 'evaluado', label: 'Evaluado', cls: 'border-ink-4/40 text-ink-3' },
] as const;

export const ANGLE_STATUS = [
  { id: 'sin_probar', label: 'Sin probar', cls: 'border-line-strong text-ink-3' },
  { id: 'probando', label: 'Probando', cls: 'border-warn/40 text-warn' },
  { id: 'ganador', label: 'Ganador', cls: 'border-ok/40 text-ok' },
  { id: 'descansando', label: 'Descansando', cls: 'border-ink-4/40 text-ink-3' },
  { id: 'muerto', label: 'Muerto', cls: 'border-danger/40 text-danger' },
] as const;

export const NARRATIVE_FORMATS = [
  'Duelo de productos', 'Testimonio', 'Antes / después', 'Listicle', 'Demo',
  'Reseña respondida', 'Carta de fundador', 'Educativo', 'Comparativa', 'Unboxing',
] as const;

/**
 * Owner roles. Real people live in the `member` table (Phase B); until then a
 * planned ad is owned by a ROLE, never by a hardcoded first name.
 */
export const OWNER_ROLES = ['designer', 'editor', 'ai', 'strategist'] as const;
/** @deprecated legacy values still stored in concepts.owner / planned_ads.owner */
export const LEGACY_OWNER_MAP: Record<string, (typeof OWNER_ROLES)[number]> = {
  'diseñador': 'designer', editor: 'editor', ia: 'ai', eduardo: 'strategist',
};
export const OWNERS = OWNER_ROLES;
