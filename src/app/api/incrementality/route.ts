// =============================================================================
// GET /api/incrementality?brand=&size=7&buckets=8
//
// Lo que la tabla de anuncios no puede contestar: ¿el dinero que Meta se apunta
// existe en la tienda, y qué devolvió el gasto que AGREGASTE?
//
// Junta dos fuentes que hasta ahora nunca se habían visto en la misma pantalla:
//   · triple_account_daily — ventas y gasto total de la tienda (Triple Whale)
//   · ad_daily             — gasto e ingreso atribuido por Meta
//
// Viven en monedas distintas (la tienda cobra en MXN; la cuenta de Skinglow
// está en USD). El factor NO se hardcodea: sale de comparar el mismo gasto de
// Meta visto por las dos fuentes en los mismos días. Sin traslape suficiente se
// devuelve `fx: null` y los absolutos de la tienda se marcan como tales en vez
// de convertirse con un número inventado.
//
// La matemática vive en src/lib/incrementality.ts y no toca la base.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { fetchAll } from '@/lib/fetch-all';
import { resolveEconomics } from '@/lib/meta';
import {
  bucketize, marginalOf, impliedFx, scaleVerdict,
  type StoreDay, type AdDay,
} from '@/lib/incrementality';

export const runtime = 'nodejs';
export const maxDuration = 30;

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
interface TripleAccount { last_synced_at: string | null; last_sync_error: string | null; shop_domain: string | null }

const nOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const brandId = sp.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const size = Math.min(30, Math.max(1, Number(sp.get('size')) || 7));
  const buckets = Math.min(26, Math.max(2, Number(sp.get('buckets')) || 8));

  const sb = getSupabase();
  const { data: brand } = await sb.from('brands').select('id,economics').eq('id', brandId).eq('user_id', user.id).maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });
  const eco = resolveEconomics(brand.economics);

  // Solo la historia que los tramos pueden usar, con una semana de colchón para
  // que el tramo más viejo tenga con qué compararse.
  const desde = new Date();
  desde.setUTCDate(desde.getUTCDate() - (size * (buckets + 1) + 2));
  const from = desde.toISOString().slice(0, 10);

  let storeRows: Record<string, unknown>[] = [];
  let adRows: Record<string, unknown>[] = [];
  let account: { currency: string | null } | null = null;
  let tw: TripleAccount | null = null;
  try {
    const [s, a, acc, t] = await Promise.all([
      fetchAll(() => sb.from('triple_account_daily')
        .select('date,total_sales,net_sales,total_orders,meta_spend,blended_spend,tw_meta_value')
        .eq('brand_id', brandId).gte('date', from).order('date')),
      fetchAll(() => sb.from('ad_daily')
        .select('date,spend,revenue,purchases')
        .eq('brand_id', brandId).not('ad_id', 'is', null).gte('date', from).order('date')),
      sb.from('ad_account').select('currency').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle(),
      sb.from('triple_account').select('last_synced_at,last_sync_error,shop_domain').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle(),
    ]);
    storeRows = s as Record<string, unknown>[];
    adRows = a as Record<string, unknown>[];
    account = acc.data as { currency: string | null } | null;
    tw = t.data as TripleAccount | null;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falló la consulta' }, { status: 500 });
  }

  const store: StoreDay[] = storeRows.map((r) => ({
    date: String(r.date),
    sales: n(r.total_sales),
    blendedSpend: n(r.blended_spend),
    metaSpend: n(r.meta_spend),
    metaAttributed: nOrNull(r.tw_meta_value),
    orders: nOrNull(r.total_orders),
  }));

  // ad_daily viene por anuncio y por día: se colapsa a un día por fila.
  const porDia = new Map<string, AdDay>();
  for (const r of adRows) {
    const date = String(r.date);
    const cur = porDia.get(date) ?? { date, spend: 0, revenue: 0, purchases: 0 };
    cur.spend += n(r.spend);
    cur.revenue = (cur.revenue ?? 0) + n(r.revenue);
    cur.purchases = (cur.purchases ?? 0) + n(r.purchases);
    porDia.set(date, cur);
  }
  const ads: AdDay[] = [...porDia.values()].sort((x, y) => x.date.localeCompare(y.date));

  const fx = impliedFx(store, ads);
  const tramos = bucketize(store, ads, { size, buckets, fx });
  const marginal = marginalOf(tramos);
  const ultimo = marginal[marginal.length - 1];
  const veredicto = scaleVerdict(ultimo, eco.breakeven);

  // Cabecera: el acumulado de todos los tramos completos, no solo el último.
  const completos = tramos.filter((b) => b.days >= size);
  const spend = completos.reduce((s, b) => s + b.spend, 0);
  const sales = completos.reduce((s, b) => s + b.sales, 0);
  const metaSpend = completos.reduce((s, b) => s + b.metaSpend, 0);
  const metaRevenue = completos.reduce((s, b) => s + (b.metaRevenue ?? 0), 0);

  return NextResponse.json({
    currency: account?.currency ?? null,
    /** Cuántas unidades de la tienda vale una de la cuenta (null = sin traslape). */
    fx,
    hasStore: store.length > 0,
    triple: tw ? { lastSyncedAt: tw.last_synced_at, error: tw.last_sync_error, shop: tw.shop_domain } : null,
    economics: eco,
    window: { size, buckets: tramos.length, from: tramos[0]?.from ?? null, to: tramos[tramos.length - 1]?.to ?? null },
    headline: {
      spend, sales,
      mer: spend > 0 ? sales / spend : null,
      metaSpend,
      metaRevenue: metaSpend > 0 ? metaRevenue : null,
      metaRoas: metaSpend > 0 ? metaRevenue / metaSpend : null,
      gap: sales > 0 && metaRevenue > 0 ? metaRevenue / sales : null,
      breakeven: eco.breakeven,
    },
    buckets: tramos,
    marginal,
    verdict: veredicto,
  });
}
