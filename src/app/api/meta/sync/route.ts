// =============================================================================
// POST /api/meta/sync — el reemplazo del CSV.
//
// Fase "numeros"   : insights nivel ad, día por día  -> meta_daily + meta_ads
// Fase "creativos" : resuelve el asset descargable de cada anuncio y lo encola
//
// Idempotente: mismo upsert por (brand, ad_name, fecha) que ya usaba la subida
// manual, así que re-sincronizar un periodo no duplica nada y un periodo nuevo
// EXTIENDE la memoria. El CSV manual sigue funcionando en paralelo.
//
// Autenticación: sesión de usuario, o header `x-cron-secret` para el cron.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { mergeDuplicateDays } from '@/lib/meta';
import { fetchAds, fetchDailyInsights, resolveAsset, videoIdsOf, pageIdOf, sleep, esLimiteDePeticiones, MetaApiError, type RawAd } from '@/lib/meta-api';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Phase = 'numeros' | 'creativos' | 'todo';

interface Body {
  brandId?: string;
  phase?: Phase;
  days?: number;
  /** Gasto minimo para que un anuncio valga la pena analizar. Ver nota abajo. */
  gastoMinimo?: number;
  /** Cuántos anuncios resolver por corrida (la resolución es la parte lenta). */
  limiteCreativos?: number;
}

interface BrandRow {
  id: string;
  user_id: string;
  name: string;
  meta_ad_account_id: string | null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Marcas a sincronizar: la pedida, o todas las que tengan cuenta configurada. */
async function targetBrands(
  sb: ReturnType<typeof getSupabase>,
  userId: string | null,
  brandId?: string
): Promise<BrandRow[]> {
  let q = sb.from('brands').select('id,user_id,name,meta_ad_account_id');
  if (brandId) q = q.eq('id', brandId);
  else q = q.not('meta_ad_account_id', 'is', null);
  if (userId) q = q.eq('user_id', userId);
  const { data } = await q;
  return ((data ?? []) as BrandRow[]).filter((b) => b.meta_ad_account_id);
}

// ---------------------------------------------------------------------------
// Fase 1 — números
// ---------------------------------------------------------------------------
async function syncNumeros(sb: ReturnType<typeof getSupabase>, brand: BrandRow, days: number) {
  const actId = brand.meta_ad_account_id!;
  const until = new Date();
  const since = new Date(until.getTime() - days * 86400000);

  const { rows, impressions } = await fetchDailyInsights(actId, {
    since: ymd(since),
    until: ymd(until),
  });
  if (rows.length === 0) return { dias: 0, ads: 0 };

  const merged = mergeDuplicateDays(rows);
  const adIdByName = new Map<string, string>();
  for (const r of rows) adIdByName.set(r.ad_name, r.ad_id);

  const daily = merged.map((r) => {
    const adId = adIdByName.get(r.ad_name) ?? null;
    return {
      user_id: brand.user_id,
      brand_id: brand.id,
      ad_id: adId,
      ad_name: r.ad_name,
      date: r.date,
      status: r.status,
      spend: r.spend ?? 0,
      revenue: r.revenue,
      roas: r.roas,
      cpa: r.cpa,
      cpc: r.cpc,
      cpm: r.cpm,
      impressions: adId ? impressions.get(`${adId}|${r.date}`) ?? null : null,
      v3s: r.v3s,
      hook_rate: r.hook_rate,
      v25: r.v25,
      v50: r.v50,
      v75: r.v75,
      freq: r.freq,
      cost_atc: r.cost_atc,
      link_clicks: r.link_clicks,
      cvr: r.cvr,
      result_rate: r.result_rate,
    };
  });

  for (let i = 0; i < daily.length; i += 500) {
    const { error } = await sb
      .from('meta_daily')
      .upsert(daily.slice(i, i + 500), { onConflict: 'brand_id,ad_name,date' });
    if (error) throw new Error(`meta_daily: ${error.message}`);
  }

  // Dimensión de anuncios (rango visto + ids reales)
  const byAd = new Map<string, { first: string; last: string; adId: string | null }>();
  for (const r of merged) {
    const adId = adIdByName.get(r.ad_name) ?? null;
    const cur = byAd.get(r.ad_name);
    if (!cur) byAd.set(r.ad_name, { first: r.date, last: r.date, adId });
    else {
      if (r.date < cur.first) cur.first = r.date;
      if (r.date > cur.last) cur.last = r.date;
    }
  }
  const { data: existing } = await sb
    .from('meta_ads').select('id,name,first_seen,last_seen').eq('brand_id', brand.id);
  const prevMap = new Map((existing ?? []).map((e) => [e.name, e]));

  const upserts = [...byAd.entries()].map(([name, info]) => {
    const prev = prevMap.get(name);
    return {
      ...(prev ? { id: prev.id } : {}),
      user_id: brand.user_id,
      brand_id: brand.id,
      name,
      ad_id: info.adId,
      first_seen: prev?.first_seen && prev.first_seen < info.first ? prev.first_seen : info.first,
      last_seen: prev?.last_seen && prev.last_seen > info.last ? prev.last_seen : info.last,
      updated_at: new Date().toISOString(),
    };
  });
  for (let i = 0; i < upserts.length; i += 200) {
    const { error } = await sb
      .from('meta_ads').upsert(upserts.slice(i, i + 200), { onConflict: 'brand_id,name' });
    if (error) throw new Error(`meta_ads: ${error.message}`);
  }

  return { dias: daily.length, ads: upserts.length };
}

// ---------------------------------------------------------------------------
// Fase 2 — creativos: resolver el asset y encolar
// ---------------------------------------------------------------------------
async function syncCreativos(
  sb: ReturnType<typeof getSupabase>, brand: BrandRow, limite: number, gastoMinimo: number
) {
  const actId = brand.meta_ad_account_id!;
  const ads: RawAd[] = await fetchAds(actId);

  // Gasto acumulado por anuncio. Un creativo con gasto irrelevante no se
  // analiza: no es solo ahorro, es calidad. Un anuncio que gasto $8 no
  // "fracaso" — nunca tuvo oportunidad, y meterlo al Cerebro como ejemplo de
  // lo que no funciona envenena las conclusiones.
  const gastoPorAd = new Map<string, number>();
  if (gastoMinimo > 0) {
    const { data: dias } = await sb
      .from('meta_daily').select('ad_name,spend').eq('brand_id', brand.id).limit(50000);
    for (const d of dias ?? []) {
      gastoPorAd.set(d.ad_name, (gastoPorAd.get(d.ad_name) ?? 0) + Number(d.spend ?? 0));
    }
  }

  const { data: rows } = await sb
    .from('meta_ads')
    .select('id,name,ad_id,asset_kind,asset_url,queue_status,creative_id')
    .eq('brand_id', brand.id);
  const byName = new Map((rows ?? []).map((r) => [r.name, r]));

  // Videos ya analizados -> dedup (muchos anuncios comparten el mismo video)
  const { data: yaHechos } = await sb
    .from('creatives').select('id,meta_video_id').eq('brand_id', brand.id).not('meta_video_id', 'is', null);
  const videosAnalizados = new Map((yaHechos ?? []).map((c) => [c.meta_video_id as string, c.id]));

  let resueltos = 0, encolados = 0, omitidos = 0, bloqueados = 0, restantes = 0, esperaMin = 0, pocoGasto = 0;
  let limitado = false;
  const estrategias: Record<string, number> = {};
  let pendientesDeEscribir: Record<string, unknown>[] = [];

  // Guarda lo avanzado. Con cuentas de 150+ anuncios el limite de Meta llega a
  // media corrida: sin esto se perderia TODO el trabajo hecho hasta ese punto.
  const volcar = async () => {
    if (pendientesDeEscribir.length === 0) return;
    const { error } = await sb
      .from('meta_ads').upsert(pendientesDeEscribir, { onConflict: 'brand_id,name' });
    if (error) throw new Error(`meta_ads(creativos): ${error.message}`);
    pendientesDeEscribir = [];
  };

  for (const ad of ads) {
    const prev = byName.get(ad.name);
    // Ya resuelto de verdad (con asset descargable) o ya analizado: no regastar cuota
    const yaResuelto = Boolean(prev?.asset_url) || prev?.queue_status === 'listo' || prev?.queue_status === 'omitido';
    if (yaResuelto) continue;
    if (resueltos >= limite || limitado) { restantes++; continue; }

    const vids = videoIdsOf(ad);
    const yaAnalizado = vids.find((v) => videosAnalizados.has(v));

    const base = {
      ...(prev ? { id: prev.id } : {}),
      user_id: brand.user_id,
      brand_id: brand.id,
      name: ad.name,
      ad_id: ad.id,
      adset_id: ad.adset_id ?? null,
      campaign_id: ad.campaign_id ?? null,
      creative_meta_id: ad.creative?.id ?? null,
      page_id: pageIdOf(ad),
      status: ad.effective_status ?? ad.status ?? null,
      created_date: ad.created_time ? ad.created_time.slice(0, 10) : null,
      updated_at: new Date().toISOString(),
    };

    // Descarte por gasto ANTES de pedirle nada a Meta: ahorra cuota y tokens.
    const gasto = gastoPorAd.get(ad.name) ?? 0;
    if (gastoMinimo > 0 && gasto < gastoMinimo) {
      pendientesDeEscribir.push({
        ...base, video_id: vids[0] ?? null, queue_status: 'omitido',
        asset_strategy: 'poco-gasto',
        queue_error: `Gasto $${gasto.toFixed(0)} < $${gastoMinimo}: sin señal suficiente para analizar`,
      });
      pocoGasto++;
      if (pendientesDeEscribir.length >= 25) await volcar();
      continue;
    }

    if (yaAnalizado) {
      pendientesDeEscribir.push({
        ...base, video_id: yaAnalizado, queue_status: 'listo', asset_kind: 'video',
        asset_strategy: 'dedup-video', creative_id: videosAnalizados.get(yaAnalizado),
        analyzed_at: new Date().toISOString(),
      });
      omitidos++;
    } else {
      try {
        const asset = await resolveAsset(ad, actId);
        resueltos++;
        estrategias[asset.strategy] = (estrategias[asset.strategy] ?? 0) + 1;
        pendientesDeEscribir.push({
          ...base,
          asset_kind: asset.kind,
          asset_url: asset.url,
          asset_strategy: asset.strategy,
          asset_error: asset.error ?? null,
          thumbnail_url: asset.thumbnail,
          duration: asset.duration,
          video_id: asset.videoId ?? vids[0] ?? null,
          queue_status: asset.kind === 'none' ? 'omitido' : 'pendiente',
          queue_error: asset.kind === 'none' ? (asset.error ?? 'sin asset descargable') : null,
        });
        if (asset.kind === 'none') bloqueados++; else encolados++;
        // Respiro entre anuncios: el limite de Meta es por ritmo, no por total.
        await sleep(250);
      } catch (e) {
        if (esLimiteDePeticiones(e)) {
          limitado = true;
          esperaMin = Math.max(esperaMin, (e as MetaApiError).esperaMin ?? 0);
          restantes++;
          continue;
        }
        throw e;
      }
    }

    if (pendientesDeEscribir.length >= 25) await volcar();
  }

  await volcar();
  return { adsVistos: ads.length, resueltos, encolados, omitidos, bloqueados, pocoGasto, restantes, limitado, esperaMin, estrategias };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
async function run(request: NextRequest, body: Body) {
  // Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`; el header propio
  // sirve para dispararlo a mano desde un script.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  const cronOk = Boolean(
    secret && (auth === `Bearer ${secret}` || request.headers.get('x-cron-secret') === secret)
  );
  const user = cronOk ? null : await getSessionUser();
  if (!cronOk && !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const sb = getSupabase();
  const phase: Phase = body.phase ?? 'todo';
  const days = Math.min(Math.max(body.days ?? 14, 1), 365);
  const limite = Math.min(Math.max(body.limiteCreativos ?? 60, 1), 300);
  // Por defecto usa el "kill" de la economia de la marca (lo que ya define
  // cuanto gasto hace falta para opinar de un anuncio). 0 = analizar todo.
  const gastoMinimo = Math.max(body.gastoMinimo ?? 58, 0);

  const brands = await targetBrands(sb, user?.id ?? null, body.brandId);
  if (brands.length === 0) {
    return NextResponse.json(
      { error: 'Ninguna marca tiene meta_ad_account_id configurado', marcas: 0 },
      { status: 400 }
    );
  }

  const resultado: Record<string, unknown>[] = [];
  for (const brand of brands) {
    const started = new Date().toISOString();
    const r: Record<string, unknown> = { marca: brand.name, cuenta: brand.meta_ad_account_id };
    try {
      // Cada fase se aísla: que Meta corte la cuota bajando números no debe
      // borrar el avance de creativos, ni al revés.
      if (phase === 'numeros' || phase === 'todo') {
        try {
          r.numeros = await syncNumeros(sb, brand, days);
        } catch (e) {
          if (!esLimiteDePeticiones(e)) throw e;
          r.numeros = { dias: 0, ads: 0, limitado: true };
          r.esperaMin = (e as MetaApiError).esperaMin ?? 0;
          r.limitado = true;
        }
      }
      if (phase === 'creativos' || phase === 'todo') {
        try {
          r.creativos = await syncCreativos(sb, brand, limite, gastoMinimo);
          const c = r.creativos as { limitado?: boolean };
          if (c?.limitado) r.limitado = true;
        } catch (e) {
          if (!esLimiteDePeticiones(e)) throw e;
          r.creativos = { adsVistos: 0, resueltos: 0, encolados: 0, omitidos: 0, pocoGasto: 0,
                          bloqueados: 0, restantes: -1, limitado: true, estrategias: {} };
          r.esperaMin = Math.max((r.esperaMin as number) ?? 0, (e as MetaApiError).esperaMin ?? 0);
          r.limitado = true;
        }
      }
      await sb.from('meta_sync_runs').insert({
        user_id: brand.user_id, brand_id: brand.id, kind: phase, status: 'ok',
        dias_escritos: (r.numeros as { dias?: number } | undefined)?.dias ?? 0,
        ads_vistos: (r.creativos as { adsVistos?: number } | undefined)?.adsVistos ?? 0,
        encolados: (r.creativos as { encolados?: number } | undefined)?.encolados ?? 0,
        detalle: r, started_at: started, finished_at: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof MetaApiError
        ? `[${err.code}] ${err.message}`
        : err instanceof Error ? err.message : 'Error desconocido';
      r.error = message;
      await sb.from('meta_sync_runs').insert({
        user_id: brand.user_id, brand_id: brand.id, kind: phase, status: 'error',
        error: message, detalle: r, started_at: started, finished_at: new Date().toISOString(),
      });
    }
    resultado.push(r);
  }
  return NextResponse.json({ ok: true, marcas: resultado });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  return run(request, body);
}

/** GET para el cron de Vercel (y para diagnosticar desde el navegador). */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  return run(request, {
    brandId: sp.get('brand') ?? undefined,
    phase: (sp.get('phase') as Phase) ?? undefined,
    days: sp.get('days') ? Number(sp.get('days')) : undefined,
    gastoMinimo: sp.get('gastoMin') ? Number(sp.get('gastoMin')) : undefined,
    limiteCreativos: sp.get('limite') ? Number(sp.get('limite')) : undefined,
  });
}
