// =============================================================================
// Incrementalidad — la pregunta que ninguna tabla de anuncios contesta:
// ¿el dinero que Meta se apunta existe en la tienda, y qué pasa cuando escalas?
//
// Tres números, en este orden, porque así se leen:
//
//   1 · MER (ROAS del negocio)  ventas de la tienda / TODO el gasto publicitario.
//       No se puede inflar: el denominador es lo que saliste del banco y el
//       numerador es lo que entró. Si el MER está debajo del equilibrio, la
//       cuenta pierde dinero aunque cada anuncio se vea verde.
//
//   2 · Brecha de atribución     lo que Meta dice que vendió / las ventas reales.
//       Arriba de 1 significa que Meta se está apuntando ventas que la tienda
//       no vio, o que las está contando dos veces. Es el termómetro de cuánto
//       creerle a la columna ROAS.
//
//   3 · ROAS marginal            Δventas / Δgasto entre dos periodos.
//       ESTA es la métrica de "¿qué pasa cuando escalo?". El ROAS promedio te
//       dice qué tan bien te fue con el dinero que YA gastaste; el marginal te
//       dice qué te devolvió el dinero que AGREGASTE. Una cuenta puede tener
//       ROAS promedio 2.0 y ROAS marginal 0.4: los dólares nuevos no compran
//       nada, solo diluyen el promedio. Eso fue exactamente lo que pasó en
//       Skinglow al triplicar el gasto semanal.
//
// Marginal ≠ momentum. Momentum es de UN anuncio (hacia dónde va). Marginal es
// de la CUENTA (qué te devuelve el siguiente peso). Nunca se responden lo mismo.
// =============================================================================

/** Un día de la tienda, como lo guarda triple_account_daily. */
export interface StoreDay {
  date: string;
  /** Ventas totales de la tienda ese día, en la moneda de la tienda. */
  sales: number;
  /** Gasto publicitario total (todas las plataformas), moneda de la tienda. */
  blendedSpend: number;
  /** Gasto de Meta según Triple Whale, moneda de la tienda. */
  metaSpend: number;
  /** Ventas que Triple Whale le atribuye a Meta, moneda de la tienda. */
  metaAttributed: number | null;
  orders: number | null;
}

/** Un día de la cuenta publicitaria, como lo guarda ad_daily (moneda de la cuenta). */
export interface AdDay {
  date: string;
  spend: number;
  revenue: number | null;
  purchases: number | null;
}

export interface Bucket {
  from: string;
  to: string;
  days: number;
  /** Gasto publicitario total del periodo, en moneda de la CUENTA. */
  spend: number;
  /** Ventas de la tienda del periodo, en moneda de la CUENTA. */
  sales: number;
  orders: number | null;
  /** ventas / gasto total. El ROAS que sí paga la nómina. */
  mer: number | null;
  /** Gasto de Meta del periodo (ad_daily), moneda de la cuenta. */
  metaSpend: number;
  /** Ingreso que Meta se apunta (ad_daily.revenue), moneda de la cuenta. */
  metaRevenue: number | null;
  /** ROAS atribuido por Meta. */
  metaRoas: number | null;
  /** metaRevenue / sales. Arriba de 1 = Meta se apunta más de lo que existe. */
  gap: number | null;
}

export interface MarginalStep {
  from: string;
  to: string;
  /** El periodo contra el que se compara. */
  prevFrom: string;
  prevTo: string;
  dSpend: number;
  dSales: number;
  /** Δventas / Δgasto. null cuando el gasto no se movió lo suficiente. */
  mroas: number | null;
  spend: number;
  mer: number | null;
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const sum = <T>(xs: T[], f: (x: T) => number | null | undefined): number =>
  xs.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/**
 * El tipo de cambio implícito entre la moneda de la tienda y la de la cuenta.
 * Sale de comparar el MISMO gasto visto por las dos fuentes en los mismos días.
 *
 * Es necesario porque las dos marcas viven en mundos distintos: Feel Ink cobra
 * y anuncia en MXN (factor ≈ 1), Skinglow vende en MXN pero su cuenta de Meta
 * está en USD (factor ≈ 17). Sin esto, un MER "1.70" y un gasto "$3,922" serían
 * números de monedas diferentes puestos en el mismo renglón.
 *
 * Devuelve null cuando no hay traslape suficiente: mejor no convertir que
 * convertir con un factor inventado.
 */
export function impliedFx(store: StoreDay[], ads: AdDay[]): number | null {
  const porFecha = new Map(ads.map((a) => [a.date, a]));
  let tienda = 0, cuenta = 0, dias = 0;
  for (const d of store) {
    const a = porFecha.get(d.date);
    if (!a || a.spend <= 0 || d.metaSpend <= 0) continue;
    tienda += d.metaSpend;
    cuenta += a.spend;
    dias += 1;
  }
  if (dias < 5 || cuenta <= 0) return null;
  const fx = tienda / cuenta;
  // Un factor absurdo significa que una de las dos fuentes no es lo que cree:
  // preferimos no mostrar nada a mostrar una conversión falsa.
  return fx > 0.05 && fx < 1000 ? fx : null;
}

/**
 * Parte la historia en tramos de `size` días terminando en el último día con
 * datos, y arma un bucket por tramo con TODO ya en moneda de la cuenta.
 * Los tramos van del más viejo al más nuevo; el último puede quedar incompleto
 * y por eso trae `days`: un tramo de 3 días no se compara con uno de 7.
 */
export function bucketize(
  store: StoreDay[],
  ads: AdDay[],
  opts: { size: number; buckets: number; fx: number | null },
): Bucket[] {
  if (!store.length && !ads.length) return [];
  const fx = opts.fx && opts.fx > 0 ? opts.fx : 1;
  const fechas = [...new Set([...store.map((d) => d.date), ...ads.map((d) => d.date)])].sort();
  const fin = fechas[fechas.length - 1];
  if (!fin) return [];

  const dia = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const out: Bucket[] = [];
  for (let i = 0; i < opts.buckets; i += 1) {
    const to = dia(fin, -i * opts.size);
    const from = dia(to, -(opts.size - 1));
    const s = store.filter((d) => d.date >= from && d.date <= to);
    const a = ads.filter((d) => d.date >= from && d.date <= to);
    if (!s.length && !a.length) continue;

    // Gasto total del periodo: el blended de la tienda si existe (incluye
    // Google, TikTok, lo que sea), y si no, el de Meta. Convertido a la moneda
    // de la cuenta para que se pueda sumar con lo demás de la pantalla.
    const blended = sum(s, (d) => d.blendedSpend) / fx;
    const metaSpend = sum(a, (d) => d.spend);
    const spend = blended > 0 ? blended : metaSpend;
    const sales = sum(s, (d) => d.sales) / fx;
    const metaRevenue = a.length ? sum(a, (d) => d.revenue) : 0;
    const orders = s.length ? sum(s, (d) => d.orders) : null;

    out.push({
      from, to,
      days: new Set([...s.map((d) => d.date), ...a.map((d) => d.date)]).size,
      spend, sales, orders,
      mer: div(sales, spend),
      metaSpend,
      metaRevenue: a.length ? metaRevenue : null,
      metaRoas: div(metaRevenue, metaSpend),
      // Los dos ya están en moneda de la cuenta: metaRevenue viene de ad_daily,
      // sales se convirtió arriba. La división es limpia.
      gap: a.length ? div(metaRevenue, sales) : null,
    });
  }
  return out.reverse();
}

/**
 * El ROAS marginal de cada tramo contra el anterior. Solo tiene sentido cuando
 * el gasto se movió de verdad: con Δgasto chico, Δventas/Δgasto explota o se
 * va a infinito y no dice nada. `minDelta` es esa guardia, en proporción.
 */
export function marginalOf(buckets: Bucket[], minDelta = 0.1): MarginalStep[] {
  const out: MarginalStep[] = [];
  for (let i = 1; i < buckets.length; i += 1) {
    const cur = buckets[i], prev = buckets[i - 1];
    // Tramos de distinta duración no se comparan: el último puede estar a medias.
    if (cur.days !== prev.days) continue;
    const dSpend = cur.spend - prev.spend;
    const dSales = cur.sales - prev.sales;
    const movido = prev.spend > 0 && Math.abs(dSpend) / prev.spend >= minDelta;
    out.push({
      from: cur.from, to: cur.to,
      prevFrom: prev.from, prevTo: prev.to,
      dSpend, dSales,
      mroas: movido ? dSales / dSpend : null,
      spend: cur.spend,
      mer: cur.mer,
    });
  }
  return out;
}

export type ScaleVerdictId = 'escala_bien' | 'escala_caro' | 'escala_destruye' | 'recorte_sano' | 'estable' | 'sin_datos';

export const SCALE_VERDICT: Record<ScaleVerdictId, { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  escala_bien: { label: 'Escala bien', tone: 'ok' },
  escala_caro: { label: 'Escala caro', tone: 'warn' },
  escala_destruye: { label: 'Escalar destruye', tone: 'danger' },
  recorte_sano: { label: 'Recortar ayudó', tone: 'ok' },
  estable: { label: 'Sin movimiento', tone: 'muted' },
  sin_datos: { label: 'Sin datos', tone: 'muted' },
};

/**
 * Qué te dice el último tramo sobre escalar. Las reglas son del mismo tipo que
 * las del veredicto por anuncio: el corte es el equilibrio de la marca, no una
 * opinión sobre si el número "se ve bien".
 */
export function scaleVerdict(step: MarginalStep | undefined, breakeven: number): { id: ScaleVerdictId; why: string } {
  if (!step) return { id: 'sin_datos', why: 'Faltan dos periodos completos para comparar.' };
  if (step.mroas == null) {
    return { id: 'estable', why: 'El gasto casi no se movió: no hay nada que medir todavía.' };
  }
  const m = step.mroas.toFixed(2);
  if (step.dSpend < 0) {
    return step.mroas >= breakeven
      ? { id: 'escala_bien', why: `Bajaste el gasto y las ventas cayeron en proporción (${m}): estabas comprando ventas rentables.` }
      : { id: 'recorte_sano', why: `Bajaste el gasto y las ventas casi no cayeron (${m}): ese dinero no estaba comprando nada.` };
  }
  if (step.mroas < 0) return { id: 'escala_destruye', why: `Gastaste más y vendiste menos (marginal ${m}).` };
  if (step.mroas < breakeven * 0.5) return { id: 'escala_destruye', why: `Cada peso nuevo devolvió ${m}, muy por debajo del equilibrio ${breakeven.toFixed(2)}.` };
  if (step.mroas < breakeven) return { id: 'escala_caro', why: `Cada peso nuevo devolvió ${m}: no llega al equilibrio ${breakeven.toFixed(2)}, aunque el promedio siga arriba.` };
  return { id: 'escala_bien', why: `Cada peso nuevo devolvió ${m}, arriba del equilibrio ${breakeven.toFixed(2)}.` };
}
