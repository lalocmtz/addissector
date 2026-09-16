// =============================================================================
// Escalabilidad — cómo se comporta UN anuncio cuando le subes el presupuesto.
//
// La incrementalidad de verdad ("¿esta venta existiría sin el anuncio?") no se
// puede calcular por anuncio con datos observados: no hay contrafactual sin un
// grupo de control. Eso vive a nivel cuenta y necesita un holdout.
//
// Lo que SÍ se puede calcular por anuncio es otra cosa, y es la que se usa para
// decidir a quién subirle presupuesto: cada anuncio ya corrió días baratos y
// días caros. Comparar esos dos grupos contra su propio historial responde la
// pregunta directa — cuando este anuncio gastó más, ¿el dinero extra compró?
//
//   ROAS marginal = (ingreso/día arriba − ingreso/día abajo)
//                   ÷ (gasto/día arriba − gasto/día abajo)
//
// Un anuncio con ROAS promedio 2.4 puede tener marginal 0.3: rinde a 20 al día
// y se cae a 80. El promedio lo esconde porque está dominado por los días
// baratos. Por eso el promedio no sirve para decidir escalamiento.
//
// Dos guardias, porque sin ellas el número miente:
//   · menos de MIN_DIAS días con entrega  → no hay muestra.
//   · el gasto nunca se movió (MIN_SPREAD) → no hay experimento que leer; el
//     anuncio corrió plano y no se le puede preguntar qué pasa al escalar.
// =============================================================================

import type { Economics } from '@/lib/meta';

export interface ScaleDay {
  date: string;
  spend: number;
  revenue: number | null;
}

export type ScaleId = 'aguanta' | 'aguanta_justo' | 'se_cae' | 'colapsa' | 'plano' | 'sin_datos';

export interface Scalability {
  id: ScaleId;
  /** Una línea con los números que lo decidieron. */
  why: string;
  /** Δingreso/día ÷ Δgasto/día entre el tercio caro y el tercio barato. */
  mroas: number | null;
  /** Gasto promedio por día del tercio barato y del caro. */
  loSpend: number;
  hiSpend: number;
  loRoas: number | null;
  hiRoas: number | null;
  /** hiSpend / loSpend. Debajo de MIN_SPREAD el anuncio corrió plano. */
  spread: number | null;
  days: number;
}

/** Días con entrega mínimos para que los tercios signifiquen algo. */
const MIN_DIAS = 6;
/** El gasto del tercio caro tiene que ser al menos 40% mayor que el del barato. */
const MIN_SPREAD = 1.4;

export const SCALE_META: Record<ScaleId, { label: string; short: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  aguanta:       { label: 'Aguanta escalar', short: 'Aguanta', tone: 'ok' },
  aguanta_justo: { label: 'Aguanta justo',   short: 'Justo',   tone: 'warn' },
  se_cae:        { label: 'Se cae al subir', short: 'Se cae',  tone: 'danger' },
  colapsa:       { label: 'Colapsa',         short: 'Colapsa', tone: 'danger' },
  plano:         { label: 'Corrió plano',    short: 'Plano',   tone: 'muted' },
  sin_datos:     { label: 'Sin muestra',     short: '—',       tone: 'muted' },
};

const media = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r2 = (n: number | null) => (n == null ? '—' : n.toFixed(2));

/**
 * El veredicto de escalamiento de un anuncio (o de un conjunto: la firma es la
 * misma, solo cambia de dónde salen los días).
 */
export function scalabilityOf(dias: ScaleDay[], eco: Economics): Scalability {
  const vivos = dias.filter((d) => d.spend > 0).sort((a, b) => a.spend - b.spend);
  const vacio: Omit<Scalability, 'id' | 'why'> = {
    mroas: null, loSpend: 0, hiSpend: 0, loRoas: null, hiRoas: null, spread: null, days: vivos.length,
  };

  if (vivos.length < MIN_DIAS) {
    return { ...vacio, id: 'sin_datos', why: `Solo ${vivos.length} día${vivos.length === 1 ? '' : 's'} con entrega: hacen falta ${MIN_DIAS}.` };
  }

  // Tercio barato contra tercio caro de SU PROPIA historia. Se descarta el
  // tercio de en medio a propósito: separa los dos regímenes en vez de
  // promediarlos.
  const k = Math.max(2, Math.floor(vivos.length / 3));
  const bajo = vivos.slice(0, k);
  const alto = vivos.slice(-k);

  const loSpend = media(bajo.map((d) => d.spend));
  const hiSpend = media(alto.map((d) => d.spend));
  const loRev = media(bajo.map((d) => d.revenue ?? 0));
  const hiRev = media(alto.map((d) => d.revenue ?? 0));
  const loRoas = loSpend > 0 ? loRev / loSpend : null;
  const hiRoas = hiSpend > 0 ? hiRev / hiSpend : null;
  const spread = loSpend > 0 ? hiSpend / loSpend : null;

  const base = { ...vacio, loSpend, hiSpend, loRoas, hiRoas, spread, days: vivos.length };

  if (spread == null || spread < MIN_SPREAD) {
    return {
      ...base, id: 'plano', mroas: null,
      why: `Su gasto nunca se movió lo suficiente (×${spread?.toFixed(2) ?? '—'}): no hay con qué medir el escalamiento.`,
    };
  }

  const mroas = (hiRev - loRev) / (hiSpend - loSpend);
  const detalle = `${loSpend.toFixed(0)}/día → ROAS ${r2(loRoas)} · ${hiSpend.toFixed(0)}/día → ROAS ${r2(hiRoas)}`;

  if (mroas < 0) {
    return { ...base, id: 'colapsa', mroas, why: `Gastando más vendió menos (marginal ${r2(mroas)}). ${detalle}` };
  }
  if (mroas < eco.breakeven) {
    return {
      ...base, id: 'se_cae', mroas,
      why: `El gasto extra devolvió ${r2(mroas)}, debajo del equilibrio ${r2(eco.breakeven)}. ${detalle}`,
    };
  }
  if (mroas < eco.target) {
    return {
      ...base, id: 'aguanta_justo', mroas,
      why: `El gasto extra devolvió ${r2(mroas)}: paga el costo pero no llega al objetivo ${r2(eco.target)}. ${detalle}`,
    };
  }
  return {
    ...base, id: 'aguanta', mroas,
    why: `El gasto extra devolvió ${r2(mroas)}, arriba del objetivo ${r2(eco.target)}. ${detalle}`,
  };
}

/**
 * Suma los días de varios anuncios en una sola serie por fecha. Es lo que
 * convierte la escalabilidad de un anuncio en la de un conjunto o una campaña:
 * la pregunta es la misma, la unidad cambia.
 */
export function mergeDays(series: ScaleDay[][]): ScaleDay[] {
  const porFecha = new Map<string, ScaleDay>();
  for (const s of series) {
    for (const d of s) {
      const cur = porFecha.get(d.date) ?? { date: d.date, spend: 0, revenue: 0 };
      cur.spend += d.spend;
      cur.revenue = (cur.revenue ?? 0) + (d.revenue ?? 0);
      porFecha.set(d.date, cur);
    }
  }
  return [...porFecha.values()].sort((a, b) => a.date.localeCompare(b.date));
}
