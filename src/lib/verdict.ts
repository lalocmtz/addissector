// =============================================================================
// El veredicto de un anuncio — reglas explícitas, nunca una opinión.
//
// Seis estados. Ninguno se emite sin los datos que lo sostienen: si no hay
// gasto suficiente para distinguir señal de ruido, el veredicto es "sin datos"
// y se dice por qué, en vez de pintar un color que invita a apagar algo que
// Meta todavía no terminó de probar.
//
// Los cortes NO viven aquí: vienen de brands.economics (uno por marca), que a
// su vez sale de la economía unitaria — breakeven = AOV / margen de
// contribución, target = AOV / CAC objetivo. Cambiar el costo de guías cambia
// el breakeven y con él todos los veredictos, sin tocar una línea de código.
// =============================================================================

import type { Economics } from '@/lib/meta';
import { targetCpa } from '@/lib/meta';

export type VerdictId = 'apagar' | 'mantener' | 'potencial' | 'ganador' | 'vigilar' | 'sin_datos';

export interface VerdictWindow {
  spend: number;
  roas: number | null;
  purchases: number | null;
  freq?: number | null;
}

export interface VerdictResult {
  id: VerdictId;
  /** Una línea corta que explica el veredicto con los números que lo causaron. */
  why: string;
  /** Caída relativa de ROAS 7d contra 14d (−0.18 = 18% peor). */
  drop: number | null;
}

export const VERDICT_META: Record<VerdictId, { label: string; tone: 'danger' | 'warn' | 'ok' | 'accent' | 'muted' }> = {
  apagar: { label: 'Apagar', tone: 'danger' },
  mantener: { label: 'No escalar', tone: 'warn' },
  potencial: { label: 'Potencial', tone: 'accent' },
  ganador: { label: 'Ganador', tone: 'ok' },
  vigilar: { label: 'Vigilar', tone: 'warn' },
  sin_datos: { label: 'Sin datos', tone: 'muted' },
};

const r2 = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));

/**
 * Gasto mínimo para que el veredicto sea confiable: `signalMultiple` veces el
 * CPA objetivo. Sin CAC declarado cae al piso `kill`, que es lo que la
 * plataforma usaba antes.
 */
export function signalFloor(eco: Economics): number {
  const cpa = targetCpa(eco);
  return cpa ? cpa * eco.signalMultiple : eco.kill;
}

/**
 * Decide el veredicto de UN anuncio. `d7` manda, `d14` confirma o desmiente.
 * El orden de las reglas es el orden de la decisión: primero si hay señal,
 * luego si pierde dinero, luego si gana, y al final los matices.
 */
export function verdictOf(d7: VerdictWindow, d14: VerdictWindow | null, eco: Economics): VerdictResult {
  const piso = signalFloor(eco);
  const drop = d7.roas != null && d14?.roas != null && d14.roas > 0
    ? d7.roas / d14.roas - 1
    : null;

  // 1 · ¿Hay con qué opinar? Sin gasto suficiente no hay veredicto, haya o no
  //     compras: una compra sobre 12 dólares no prueba nada.
  if (d7.spend < piso) {
    const conRoas = d7.spend > 0 && d7.roas != null;
    return {
      id: conRoas && d7.roas! >= eco.target ? 'potencial' : 'sin_datos',
      why: conRoas && d7.roas! >= eco.target
        ? `ROAS 7d ${r2(d7.roas)} con poco gasto · aún no llega al piso de señal`
        : `Gasto 7d por debajo del piso de señal (${piso.toFixed(0)})`,
      drop,
    };
  }

  // 2 · Gastó lo suficiente y no devolvió el costo: apagar.
  if (d7.roas == null || d7.roas < eco.breakeven) {
    return {
      id: 'apagar',
      why: `ROAS 7d ${r2(d7.roas)} < equilibrio ${r2(eco.breakeven)} · gasto ${d7.spend.toFixed(0)}`,
      drop,
    };
  }

  // 3 · Llega al objetivo en 7d Y lo sostiene en 14d: ganador.
  if (d7.roas >= eco.target && (d14?.roas ?? 0) >= eco.target) {
    return {
      id: 'ganador',
      why: `ROAS 7d ${r2(d7.roas)} y 14d ${r2(d14!.roas)} ≥ objetivo ${r2(eco.target)}`,
      drop,
    };
  }

  // 4 · Llega al objetivo pero 14d no lo respalda: todavía no es ganador.
  if (d7.roas >= eco.target) {
    return {
      id: 'potencial',
      why: `ROAS 7d ${r2(d7.roas)} ≥ objetivo pero 14d ${r2(d14?.roas)} no lo confirma`,
      drop,
    };
  }

  // 5 · Sobre el equilibrio pero cayendo, o con la frecuencia arriba: vigilar.
  if (drop != null && drop <= eco.fatigueDrop) {
    return {
      id: 'vigilar',
      why: `ROAS 7d ${r2(d7.roas)} · ${Math.round(drop * 100)}% vs 14d ${r2(d14?.roas)}`,
      drop,
    };
  }
  if ((d7.freq ?? 0) >= eco.freqWatch) {
    return {
      id: 'vigilar',
      why: `Frecuencia ${(d7.freq ?? 0).toFixed(2)} ≥ ${eco.freqWatch} · ROAS 7d ${r2(d7.roas)}`,
      drop,
    };
  }

  // 6 · Paga el costo pero no el objetivo: vive, no se escala.
  return {
    id: 'mantener',
    why: `ROAS 7d ${r2(d7.roas)} entre equilibrio ${r2(eco.breakeven)} y objetivo ${r2(eco.target)}`,
    drop,
  };
}

/** verde / rojo / neutro de una métrica creativa contra la banda de la marca. */
export function bandTone(value: number | null | undefined, band: { bad: number; good: number }): 'ok' | 'danger' | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= band.good) return 'ok';
  if (value <= band.bad) return 'danger';
  return null;
}

/** verde / rojo de un ROAS contra la economía de la marca. */
export function roasTone(roas: number | null | undefined, eco: Economics): 'ok' | 'danger' | null {
  if (roas == null || !Number.isFinite(roas)) return null;
  if (roas >= eco.target) return 'ok';
  if (roas < eco.breakeven) return 'danger';
  return null;
}
