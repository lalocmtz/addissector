// =============================================================================
// POST /api/meta/sync — orchestrates the two halves of the Meta sync.
//
// Phase "numbers"   : delegates to the Supabase edge function `meta-sync`, the
//                     single writer of ad_daily (counts only, keyed by ad_id).
//                     Vercel Hobby only allows one cron a day; the edge function
//                     runs hourly from pg_cron and has network access to Meta.
// Phase "creatives" : resolves the downloadable asset of each ad (Page tokens,
//                     5 fallbacks) and queues it for analysis. This is the part
//                     that only runs here because it needs META_ACCESS_TOKEN.
//
// Idempotent. Everything is keyed by (brand_id, ad_id) — names are attributes.
// Auth: user session, or `Authorization: Bearer <CRON_SECRET>` / x-cron-secret.
//
// Body / query (legacy Spanish aliases still accepted):
//   phase        numbers | creatives | all       (numeros | creativos | todo)
//   days         window for the numbers phase (default 14, max 90)
//   minSpend     spend threshold below which a creative is not analyzed (gastoMinimo)
//   creativeLimit how many creatives to resolve per run (limiteCreativos)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { fetchAds, resolveAsset, videoIdsOf, pageIdOf, sleep, esLimiteDePeticiones, MetaApiError, type RawAd } from '@/lib/meta-api';
import { fetchAll } from '@/lib/fetch-all';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Phase = 'numbers' | 'creatives' | 'all';

interface Body {
  brandId?: string;
  phase?: string;
  days?: number;
  minSpend?: number;
  creativeLimit?: number;
  /** @deprecated aliases */
  gastoMinimo?: number;
  limiteCreativos?: number;
}

interface AccountRow {
  id: string;
  brand_id: string;
  user_id: string | null;
  ad_account_id: string;
  currency: string | null;
  brand: { name: string } | { name: string }[] | null;
}

function normalizePhase(p: string | undefined): Phase {
  switch (p) {
    case 'numbers': case 'numeros': return 'numbers';
    case 'creatives': case 'creativos': return 'creatives';
    default: return 'all';
  }
}

/** Accounts to sync: the requested brand's, or every active account. */
async function targetAccounts(sb: ReturnType<typeof getSupabase>, userId: string | null, brandId?: string): Promise<AccountRow[]> {
  let q = sb.from('ad_account').select('id,brand_id,user_id,ad_account_id,currency,brand:brands(name)').eq('active', true);
  if (brandId) q = q.eq('brand_id', brandId);
  if (userId) q = q.eq('user_id', userId);
  const { data } = await q;
  return (data ?? []) as unknown as AccountRow[];
}

// ---------------------------------------------------------------------------
// Phase 1 — numbers: call the edge function
// ---------------------------------------------------------------------------
async function syncNumbers(brandId: string, days: number) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  const url = `${base}/functions/v1/meta-sync?days=${days}&brand=${encodeURIComponent(brandId)}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean; error?: string;
    results?: Array<{ account: string; ok: boolean; rows?: number; ads?: number; error?: string; rateLimited?: boolean; waitMin?: number }>;
  };
  if (!res.ok) throw new Error(`meta-sync edge function: ${json.error ?? res.status}`);
  const r = json.results?.[0];
  if (!r) return { rows: 0, ads: 0 };
  if (!r.ok) {
    if (r.rateLimited) throw new MetaApiError(r.error ?? 'rate limited', 4, undefined, r.waitMin ?? 0);
    throw new Error(r.error ?? 'meta-sync failed');
  }
  return { rows: r.rows ?? 0, ads: r.ads ?? 0 };
}

// ---------------------------------------------------------------------------
// Phase 2 — creatives: resolve the asset and queue
// ---------------------------------------------------------------------------
async function syncCreatives(
  sb: ReturnType<typeof getSupabase>, acc: AccountRow, limit: number, minSpend: number
) {
  const actId = acc.ad_account_id;
  const brandId = acc.brand_id;
  const ads: RawAd[] = await fetchAds(actId);

  // Lifetime spend per ad_id. A creative with irrelevant spend is not analyzed:
  // it did not fail, it never had a chance — and feeding it to the brain as an
  // example of "what does not work" poisons the conclusions.
  const spendByAd = new Map<string, number>();
  if (minSpend > 0) {
    const data = await fetchAll(() => sb.from('ad_daily').select('ad_id,spend').eq('brand_id', brandId).not('ad_id', 'is', null).order('ad_id').order('date'));
    for (const d of data) spendByAd.set(d.ad_id as string, (spendByAd.get(d.ad_id as string) ?? 0) + Number(d.spend ?? 0));
  }

  const { data: rows } = await sb
    .from('meta_ads')
    .select('id,name,ad_id,asset_kind,asset_url,queue_status,creative_id')
    .eq('brand_id', brandId);
  const byAdId = new Map((rows ?? []).map((r) => [r.ad_id as string, r]));

  // Videos already analyzed → dedup (many ads share one video)
  const { data: done } = await sb
    .from('creatives').select('id,meta_video_id').eq('brand_id', brandId).not('meta_video_id', 'is', null);
  const analyzedVideos = new Map((done ?? []).map((c) => [c.meta_video_id as string, c.id]));

  let resolved = 0, queued = 0, deduped = 0, blocked = 0, remaining = 0, waitMin = 0, lowSpend = 0;
  let limited = false;
  const strategies: Record<string, number> = {};
  let pending: Record<string, unknown>[] = [];

  // Flush progress: with 150+ ads Meta's limit lands mid-run; without this all
  // the work done up to that point would be lost.
  const flush = async () => {
    if (pending.length === 0) return;
    const { error } = await sb.from('meta_ads').upsert(pending, { onConflict: 'brand_id,ad_id' });
    if (error) throw new Error(`meta_ads(creatives): ${error.message}`);
    pending = [];
  };

  for (const ad of ads) {
    const prev = byAdId.get(ad.id);
    const alreadyDone = Boolean(prev?.asset_url) || prev?.queue_status === 'listo' || prev?.queue_status === 'omitido';
    if (alreadyDone) continue;
    if (resolved >= limit || limited) { remaining++; continue; }

    const vids = videoIdsOf(ad);
    const alreadyAnalyzed = vids.find((v) => analyzedVideos.has(v));

    const base = {
      ...(prev ? { id: prev.id } : {}),
      user_id: acc.user_id,
      brand_id: brandId,
      name: ad.name,
      ad_id: ad.id,
      adset_id: ad.adset_id ?? null,
      campaign_id: ad.campaign_id ?? null,
      creative_meta_id: ad.creative?.id ?? null,
      page_id: pageIdOf(ad),
      status: (ad.effective_status ?? ad.status ?? null)?.toLowerCase() ?? null,
      created_date: ad.created_time ? ad.created_time.slice(0, 10) : null,
      updated_at: new Date().toISOString(),
    };

    // Spend gate BEFORE asking Meta anything: saves quota and tokens.
    const spend = spendByAd.get(ad.id) ?? 0;
    if (minSpend > 0 && spend < minSpend) {
      pending.push({
        ...base, video_id: vids[0] ?? null, queue_status: 'omitido',
        asset_strategy: 'poco-gasto',
        queue_error: `spend ${spend.toFixed(0)} < ${minSpend} ${acc.currency ?? ''}: not enough signal to analyze`.trim(),
      });
      lowSpend++;
      if (pending.length >= 25) await flush();
      continue;
    }

    if (alreadyAnalyzed) {
      pending.push({
        ...base, video_id: alreadyAnalyzed, queue_status: 'listo', asset_kind: 'video',
        asset_strategy: 'dedup-video', creative_id: analyzedVideos.get(alreadyAnalyzed),
        analyzed_at: new Date().toISOString(),
      });
      deduped++;
    } else {
      try {
        const asset = await resolveAsset(ad, actId);
        resolved++;
        strategies[asset.strategy] = (strategies[asset.strategy] ?? 0) + 1;
        pending.push({
          ...base,
          asset_kind: asset.kind,
          asset_url: asset.url,
          asset_strategy: asset.strategy,
          asset_error: asset.error ?? null,
          thumbnail_url: asset.thumbnail,
          duration: asset.duration,
          video_id: asset.videoId ?? vids[0] ?? null,
          queue_status: asset.kind === 'none' ? 'omitido' : 'pendiente',
          queue_error: asset.kind === 'none' ? (asset.error ?? 'no downloadable asset') : null,
        });
        if (asset.kind === 'none') blocked++; else queued++;
        await sleep(250); // Meta limits by rhythm, not by total
      } catch (e) {
        if (esLimiteDePeticiones(e)) {
          limited = true;
          waitMin = Math.max(waitMin, (e as MetaApiError).esperaMin ?? 0);
          remaining++;
          continue;
        }
        throw e;
      }
    }

    if (pending.length >= 25) await flush();
  }

  await flush();
  return { adsSeen: ads.length, resolved, queued, deduped, blocked, lowSpend, remaining, limited, waitMin, strategies };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
async function run(request: NextRequest, body: Body) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  const cronOk = Boolean(secret && (auth === `Bearer ${secret}` || request.headers.get('x-cron-secret') === secret));
  const user = cronOk ? null : await getSessionUser();
  if (!cronOk && !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const sb = getSupabase();
  const phase = normalizePhase(body.phase);
  const days = Math.min(Math.max(body.days ?? 14, 1), 90);
  const limit = Math.min(Math.max(body.creativeLimit ?? body.limiteCreativos ?? 60, 1), 300);
  const minSpend = Math.max(body.minSpend ?? body.gastoMinimo ?? 58, 0);

  const accounts = await targetAccounts(sb, user?.id ?? null, body.brandId);
  if (accounts.length === 0) {
    return NextResponse.json({ error: 'No active ad_account for this brand', accounts: 0 }, { status: 400 });
  }

  const out: Record<string, unknown>[] = [];
  for (const acc of accounts) {
    const started = new Date().toISOString();
    const brandName = Array.isArray(acc.brand) ? acc.brand[0]?.name : acc.brand?.name;
    const r: Record<string, unknown> = { brand: brandName, account: acc.ad_account_id, currency: acc.currency };
    try {
      // Phases are isolated: a quota cut while syncing numbers must not erase
      // the creatives progress, nor the other way around.
      if (phase === 'numbers' || phase === 'all') {
        try {
          r.numbers = await syncNumbers(acc.brand_id, days);
        } catch (e) {
          if (!esLimiteDePeticiones(e)) throw e;
          r.numbers = { rows: 0, ads: 0, limited: true };
          r.waitMin = (e as MetaApiError).esperaMin ?? 0;
          r.limited = true;
        }
      }
      if (phase === 'creatives' || phase === 'all') {
        try {
          r.creatives = await syncCreatives(sb, acc, limit, minSpend);
          if ((r.creatives as { limited?: boolean })?.limited) r.limited = true;
        } catch (e) {
          if (!esLimiteDePeticiones(e)) throw e;
          r.creatives = { adsSeen: 0, resolved: 0, queued: 0, deduped: 0, lowSpend: 0, blocked: 0, remaining: -1, limited: true, strategies: {} };
          r.waitMin = Math.max((r.waitMin as number) ?? 0, (e as MetaApiError).esperaMin ?? 0);
          r.limited = true;
        }
      }
      await sb.from('meta_sync_runs').insert({
        user_id: acc.user_id, brand_id: acc.brand_id, kind: phase, status: 'ok',
        dias_escritos: (r.numbers as { rows?: number } | undefined)?.rows ?? 0,
        ads_vistos: (r.creatives as { adsSeen?: number } | undefined)?.adsSeen ?? 0,
        encolados: (r.creatives as { queued?: number } | undefined)?.queued ?? 0,
        detalle: r, started_at: started, finished_at: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof MetaApiError ? `[${err.code}] ${err.message}` : err instanceof Error ? err.message : 'Unknown error';
      r.error = message;
      await sb.from('meta_sync_runs').insert({
        user_id: acc.user_id, brand_id: acc.brand_id, kind: phase, status: 'error',
        error: message, detalle: r, started_at: started, finished_at: new Date().toISOString(),
      });
    }
    out.push(r);
  }
  return NextResponse.json({ ok: true, accounts: out, marcas: out });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  return run(request, body);
}

/** GET for the Vercel cron (and for a quick check from the browser). */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const n = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  return run(request, {
    brandId: sp.get('brand') ?? undefined,
    phase: sp.get('phase') ?? undefined,
    days: n('days'),
    minSpend: n('minSpend') ?? n('gastoMin'),
    creativeLimit: n('limit') ?? n('limite'),
  });
}
