// =============================================================================
// /api/plan/hooks — el banco de hooks (tabla `hook`, migración 013).
//
// POST / PATCH / DELETE siguen siendo el CRUD genérico. El GET es propio:
// devuelve cada hook con su tipo (voz = lo que se dijo · headline = lo que se
// leyó en pantalla) y los anuncios que lo corrieron con sus números de los
// últimos 30 días (terminando en el último día con datos en ad_daily).
// La forma de la respuesta sigue siendo `{ items }`.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { makeCrud } from '@/lib/crud';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow } from '@/lib/metrics';
import { fetchAll } from '@/lib/fetch-all';
import { resolveEconomics } from '@/lib/meta';

export const runtime = 'nodejs';

const SELECT = 'id,title,body,hook_type,status,source,evidence,ad_ids,created_at,updated_at';

const crud = makeCrud({
  table: 'hook',
  select: SELECT,
  writable: ['title', 'body', 'hook_type', 'status', 'source', 'evidence', 'ad_ids'],
  orderBy: { column: 'created_at', ascending: false },
  limit: 1000,
});

type HookKind = 'voz' | 'headline';

interface HookRow {
  id: string;
  title: string | null;
  body: string | null;
  hook_type: string | null;
  status: string | null;
  source: string | null;
  evidence: string | null;
  ad_ids: string[] | null;
  created_at: string;
  updated_at: string | null;
}

interface MetaAdRow {
  id: string;
  ad_id: string | null;
  name: string | null;
  thumbnail_url: string | null;
  asset_kind: string | null;
  /** Los llena el clasificador al analizar: por eso el banco se alimenta solo. */
  persona_id: string | null;
  angle_id: string | null;
}

interface HookAd {
  /** uuid de meta_ads */
  meta_id: string;
  /** id del anuncio en Meta */
  ad_id: string | null;
  name: string | null;
  thumbnail_url: string | null;
  asset_kind: string | null;
  /** A quién se le hizo y con qué concepto. Sale del análisis, no se escribe. */
  persona: string | null;
  concepto: string | null;
  spend: number;
  purchases: number | null;
  roas: number | null;
  cpa: number | null;
  hook_rate: number | null;
  hold_rate: number | null;
}

/** Filas viejas sin hook_type: son de voz salvo que el cuerpo diga que era texto en pantalla. */
function kindOf(row: HookRow): HookKind {
  if (row.hook_type === 'headline') return 'headline';
  if (row.hook_type === 'voz') return 'voz';
  return (row.body ?? '').trim().toLowerCase().startsWith('texto en pantalla') ? 'headline' : 'voz';
}

async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const sb = getSupabase();

  const [hooksRes, brandRes, accountRes, lastRes] = await Promise.all([
    sb.from('hook').select(SELECT).eq('brand_id', brandId).eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1000),
    sb.from('brands').select('economics').eq('id', brandId).eq('user_id', user.id).maybeSingle(),
    sb.from('ad_account').select('currency').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle(),
    sb.from('ad_daily').select('date').eq('brand_id', brandId).not('ad_id', 'is', null)
      .order('date', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (hooksRes.error) return NextResponse.json({ error: hooksRes.error.message }, { status: 500 });

  const hooks = (hooksRes.data ?? []) as HookRow[];
  const economics = resolveEconomics(brandRes.data?.economics);
  const currency: string | null = (accountRes.data as { currency?: string | null } | null)?.currency ?? null;

  // Ventana: 30 días que terminan en el último día con datos.
  const lastDate = (lastRes.data as { date?: string } | null)?.date ?? new Date().toISOString().slice(0, 10);
  const from = new Date(`${lastDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 29);
  const fromStr = from.toISOString().slice(0, 10);

  // Solo hace falta cargar los anuncios que algún hook referencia.
  // Nombres de avatar y concepto: el hook no sirve sin saber a quién se le dijo.
  const [personasRes, conceptosRes] = await Promise.all([
    sb.from('personas').select('id,name').eq('brand_id', brandId),
    sb.from('angles').select('id,code,name').eq('brand_id', brandId),
  ]);
  const nombrePersona = new Map(((personasRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const nombreConcepto = new Map(((conceptosRes.data ?? []) as { id: string; code: string | null; name: string }[])
    .map((c) => [c.id, c.code ? `${c.code} · ${c.name}` : c.name]));

  const metaIds = Array.from(new Set(hooks.flatMap((h) => h.ad_ids ?? []).filter(Boolean)));
  let adsById = new Map<string, MetaAdRow>();
  let aggByAdId = new Map<string, ReturnType<typeof aggregateByAd>[number]>();

  if (metaIds.length > 0) {
    try {
      const metaRows = await fetchAll(() =>
        sb.from('meta_ads').select('id,ad_id,name,thumbnail_url,asset_kind,persona_id,angle_id')
          .eq('brand_id', brandId).in('id', metaIds).order('id'),
      ) as unknown as MetaAdRow[];
      adsById = new Map(metaRows.map((a) => [a.id, a]));

      const metaAdIds = metaRows.map((a) => a.ad_id).filter((x): x is string => !!x);
      if (metaAdIds.length > 0) {
        const daily = await fetchAll(() =>
          sb.from('ad_daily').select(AD_DAILY_COLUMNS)
            .eq('brand_id', brandId).in('ad_id', metaAdIds)
            .gte('date', fromStr).lte('date', lastDate)
            .order('date').order('ad_id'),
        ) as unknown as AdDailyRow[];
        aggByAdId = new Map(aggregateByAd(daily).map((a) => [a.ad_id, a]));
      }
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Query failed' }, { status: 500 });
    }
  }

  const items = hooks.map((h) => {
    const ads: HookAd[] = (h.ad_ids ?? [])
      .map((metaId) => adsById.get(metaId))
      .filter((a): a is MetaAdRow => !!a)
      .map((a) => {
        const agg = a.ad_id ? aggByAdId.get(a.ad_id) : undefined;
        return {
          meta_id: a.id,
          ad_id: a.ad_id,
          name: a.name,
          thumbnail_url: a.thumbnail_url,
          asset_kind: a.asset_kind,
          persona: a.persona_id ? nombrePersona.get(a.persona_id) ?? null : null,
          concepto: a.angle_id ? nombreConcepto.get(a.angle_id) ?? null : null,
          spend: agg?.spend ?? 0,
          purchases: agg?.purchases ?? null,
          roas: agg?.roas ?? null,
          cpa: agg?.cpa ?? null,
          hook_rate: agg?.hook_rate ?? null,
          hold_rate: agg?.hold_rate ?? null,
        };
      })
      .sort((x, y) => y.spend - x.spend);
    const spend = ads.reduce((s, a) => s + a.spend, 0);
    // Un hook se juzga por cuánta gente se quedó, no por cuánto se gastó en él.
    // Se pondera por gasto para que un anuncio de 5 pesos no mande.
    const conDatos = ads.filter((a) => a.hold_rate != null && a.spend > 0);
    const pesoTotal = conDatos.reduce((s, a) => s + a.spend, 0);
    const hold = pesoTotal > 0
      ? conDatos.reduce((s, a) => s + (a.hold_rate ?? 0) * a.spend, 0) / pesoTotal
      : null;
    const hookRate = pesoTotal > 0
      ? ads.filter((a) => a.hook_rate != null && a.spend > 0).reduce((s, a) => s + (a.hook_rate ?? 0) * a.spend, 0) / pesoTotal
      : null;
    return { ...h, kind: kindOf(h), ads, spend, hold_rate: hold, hook_rate: hookRate };
  });

  // Más gasto primero; sin anuncios al final (empate → más reciente primero).
  items.sort((a, b) => {
    if (a.ads.length === 0 && b.ads.length === 0) return b.created_at.localeCompare(a.created_at);
    if (a.ads.length === 0) return 1;
    if (b.ads.length === 0) return -1;
    return b.spend - a.spend || b.created_at.localeCompare(a.created_at);
  });

  return NextResponse.json({ items, economics, currency, window: { from: fromStr, to: lastDate } });
}

export { GET };
export const POST = crud.POST;
export const PATCH = crud.PATCH;
export const DELETE = crud.DELETE;
