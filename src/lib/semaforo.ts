// =============================================================================
// Semáforo de creativos — las reglas del SOP de cuenta (oct-2026), en código.
//
// Cada anuncio cae en UNA luz y cada luz tiene UNA acción. Los cortes salen de
// la economía de la marca (brands.economics), nunca de constantes:
//
//   CPA objetivo  = economics.cac (o AOV / King Goal)
//   sin juicio    = gasto 14 d < 2 × CPA            → no tocar, es pronto
//   apagar        = vida ≥ 2 × CPA sin compras, vida ≥ 3 × CPA con ≤ 1 compra,
//                   o 14 d ≥ 3 × CPA con ROAS < killRoas
//   limitar       = ≥ 10% del gasto de 14 d y ROAS 14 d < limitRoas
//   escalar       = ≥ 10% del gasto, ROAS 7 y 14 d ≥ King Goal y arriba del
//                   promedio de la cuenta en ambas ventanas, Y su ROAS
//                   INCREMENTAL de 14 d cubre el equilibrio (el siguiente peso
//                   tiene que regresar dinero, no solo el reportado)
//   iterar        = ROAS 14 d ≥ King Goal (con poco gasto: la cola de foco)
//   mantener      = entre el equilibrio y el King Goal
//   debajo        = debajo del equilibrio, sin llegar todavía al corte
//
// killRoas  = max(50% del King Goal, 87% del equilibrio)  → Feel Ink 1.25
// limitRoas = 125% del equilibrio                         → Feel Ink 1.80
// =============================================================================

import { targetCpa, type Economics } from '@/lib/meta';

export type Luz = 'escalar' | 'iterar' | 'mantener' | 'debajo' | 'limitar' | 'apagar' | 'sin_juicio';
export type Color = 'verde' | 'ambar' | 'rojo' | 'gris';

export interface VentanaAd {
  spend: number;
  purchases: number | null;
  revenue: number | null;
  roas: number | null;
  /** ROAS con atribución incremental de Meta; null si no hay datos. */
  roasIncr?: number | null;
}

export interface EntradaSemaforo {
  vida: VentanaAd;
  d3: VentanaAd | null;
  d7: VentanaAd | null;
  d14: VentanaAd | null;
  /** Parte del gasto de 14 días de la cuenta que se llevó este anuncio (0–1). */
  share14: number;
  cuentaRoas7: number | null;
  cuentaRoas14: number | null;
}

export interface Semaforo {
  luz: Luz;
  color: Color;
  titulo: string;
  porque: string;
  accion: string;
  /** El ROAS de 7 días cayó más que `fatigueDrop` contra el de 14. */
  cayendo: boolean;
}

export const LUCES: Record<Luz, { titulo: string; color: Color; accion: string; orden: number }> = {
  escalar: { titulo: 'Escalar', color: 'verde', accion: 'Duplícalo a Scale o a un pack de interés, sin pausar el original.', orden: 0 },
  iterar: { titulo: 'Foco: iterar', color: 'verde', accion: 'Haz 1 a 3 iteraciones cambiando una sola capa y lánzalas como pack.', orden: 1 },
  apagar: { titulo: 'Apagar', color: 'rojo', accion: 'Apaga este anuncio (no el conjunto).', orden: 2 },
  limitar: { titulo: 'Limitar', color: 'rojo', accion: 'Pon tope de gasto a su conjunto dentro de la CBO.', orden: 3 },
  debajo: { titulo: 'Debajo del equilibrio', color: 'rojo', accion: 'Vigílalo: si llega al corte, se apaga solo con la regla.', orden: 4 },
  mantener: { titulo: 'Mantener', color: 'ambar', accion: 'Deja que corra. No escalar.', orden: 5 },
  sin_juicio: { titulo: 'Sin juicio', color: 'gris', accion: 'No tocar: todavía no gasta lo suficiente.', orden: 6 },
};

export interface Umbrales {
  cpa: number;
  juicio: number;
  corte: number;
  killRoas: number;
  limitRoas: number;
  share: number;
}

export function umbralesDe(eco: Economics): Umbrales {
  const cpa = targetCpa(eco) ?? eco.kill / 2;
  return {
    cpa,
    juicio: 2 * cpa,
    corte: 3 * cpa,
    killRoas: Math.max(eco.target * 0.5, eco.breakeven * 0.87),
    limitRoas: eco.breakeven * 1.25,
    share: 0.10,
  };
}

const r2 = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));
const mx = (n: number) => `$${Math.round(n).toLocaleString('es-MX')}`;

export function semaforoDe(x: EntradaSemaforo, eco: Economics): Semaforo {
  const u = umbralesDe(eco);
  const r7 = x.d7?.roas ?? null;
  const r14 = x.d14?.roas ?? null;
  const s14 = x.d14?.spend ?? 0;
  const p14 = x.d14?.purchases ?? 0;
  const comprasVida = x.vida.purchases ?? 0;
  const cayendo = r7 != null && r14 != null && r14 > 0 && r7 / r14 - 1 <= eco.fatigueDrop;
  const pct = `${Math.round(x.share14 * 100)}% del gasto`;

  const sale = (luz: Luz, porque: string): Semaforo => ({
    luz, color: LUCES[luz].color, titulo: LUCES[luz].titulo, accion: LUCES[luz].accion, porque, cayendo,
  });

  // 1 · Apagar: lo que ya gastó lo suficiente para saber que no regresa.
  if (x.vida.spend >= u.juicio && comprasVida === 0) {
    return sale('apagar', `Gastó ${mx(x.vida.spend)} sin una sola compra (corte: ${mx(u.juicio)}).`);
  }
  if (x.vida.spend >= u.corte && comprasVida <= 1) {
    return sale('apagar', `Gastó ${mx(x.vida.spend)} con ${comprasVida} compra (corte: ${mx(u.corte)}).`);
  }
  if (s14 >= u.corte && r14 != null && r14 < u.killRoas) {
    return sale('apagar', `ROAS 14 d de ${r2(r14)} con ${mx(s14)} gastados: debajo de ${r2(u.killRoas)}.`);
  }

  // 2 · Sin juicio: muy poco gasto para opinar.
  if (s14 < u.juicio) {
    return sale('sin_juicio', `Lleva ${mx(s14)} en 14 d; se juzga a partir de ${mx(u.juicio)}.`);
  }

  // 3 · Limitar: se come el presupuesto y deja poco margen.
  if (x.share14 >= u.share && r14 != null && r14 < u.limitRoas) {
    return sale('limitar', `Se lleva ${pct} con ROAS ${r2(r14)}: debajo de ${r2(u.limitRoas)}, deja poco margen.`);
  }

  // 4 · Escalar: ganador de ruptura, confirmado por el incremental.
  const i14 = x.d14?.roasIncr ?? null;
  const incrOk = i14 == null || i14 >= eco.breakeven;
  if (
    x.share14 >= u.share && r7 != null && r14 != null &&
    r7 >= eco.target && r14 >= eco.target &&
    r7 > (x.cuentaRoas7 ?? 0) && r14 > (x.cuentaRoas14 ?? 0) && incrOk
  ) {
    const inc = i14 != null ? `; incremental ${r2(i14)}` : '';
    return sale('escalar', `Se lleva ${pct} con ROAS ${r2(r7)} (7 d) y ${r2(r14)} (14 d), arriba del King Goal y de la cuenta${inc}.`);
  }

  // 5 · Iterar: funciona y todavía tiene espacio.
  if (r14 != null && r14 >= eco.target) {
    const extra = x.share14 >= u.share
      ? (!incrOk ? ` Gasta mucho, pero su ROAS incremental (${r2(i14)}) no cubre el equilibrio: no escalar.` : ' Gasta mucho, pero 7 d no confirma para escalar.')
      : '';
    return sale('iterar', `ROAS 14 d de ${r2(r14)} con ${p14} compras y solo ${pct}.${extra}`);
  }

  // 6 · Mantener o debajo.
  if (r14 != null && r14 >= eco.breakeven) {
    return sale('mantener', `ROAS 14 d de ${r2(r14)}: deja margen, pero no llega al King Goal (${r2(eco.target)}).`);
  }
  return sale('debajo', `ROAS 14 d de ${r2(r14)}: debajo del equilibrio (${r2(eco.breakeven)}).`);
}

/** Rol que Meta le dio al anuncio, leído de su frecuencia DIARIA. */
export type Rol = 'arriba' | 'medio' | 'abajo' | 'retargeting';
export function rolPorFrecuencia(freq: number | null | undefined): Rol | null {
  if (freq == null || !Number.isFinite(freq)) return null;
  if (freq < 1.15) return 'arriba';
  if (freq < 1.25) return 'medio';
  if (freq < 1.35) return 'abajo';
  return 'retargeting';
}
export const ROL_LABEL: Record<Rol, string> = {
  arriba: 'Arriba del embudo',
  medio: 'Medio',
  abajo: 'Abajo',
  retargeting: 'Retargeting',
};

/** Margen de contribución por peso vendido antes de anuncios (0–1), o null. */
export function contribucion(eco: Economics): number | null {
  if (!eco.aov || !eco.unitCost || eco.aov <= 0) return null;
  return 1 - eco.unitCost / eco.aov;
}
