// =============================================================================
// Meta asset download (server-side) — shared by /api/meta/asset (the browser
// proxy) and /api/meta/analyze-fast (the Gemini engine).
//
// The signed `source` URLs Meta hands out expire. This opens the stored URL
// and, when it is dead, re-resolves the ad against the Graph API with the
// account token, updates the row and tries again. Never throws: returns the
// upstream Response or the reason it could not be obtained.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAsset, type RawAd, GRAPH_VERSION, adToken } from '@/lib/meta-api';

export const AD_FIELDS =
  'id,name,status,effective_status,created_time,adset_id,campaign_id,' +
  'creative{id,video_id,image_url,thumbnail_url,effective_object_story_id,object_story_spec,asset_feed_spec}';

export const META_ASSET_COLUMNS =
  'id,name,ad_id,video_id,brand_id,asset_url,asset_kind,asset_strategy,thumbnail_url,duration,brands(meta_ad_account_id)';

export interface MetaAssetRow {
  id: string;
  name: string;
  ad_id: string | null;
  video_id?: string | null;
  brand_id: string;
  asset_url: string | null;
  asset_kind: string | null;
  asset_strategy?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  brands?: { meta_ad_account_id?: string | null } | { meta_ad_account_id?: string | null }[] | null;
}

export interface MetaAssetOpen {
  upstream: Response | null;
  /** Why it could not be opened (already written to meta_ads.asset_error). */
  error: string | null;
  /** True when the file lives in OUR bucket (manual upload), not in Meta's CDN. */
  ownBucket: boolean;
}

/** True when the URL points at our Supabase storage bucket rather than Meta. */
export function isOwnBucketUrl(url: string | null | undefined): boolean {
  return Boolean(url && /\/storage\/v1\/object\/(public|sign)\/creative-videos\//.test(url));
}

async function open(url: string): Promise<Response | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok && r.body ? r : null;
  } catch {
    return null;
  }
}

export async function openMetaAsset(sb: SupabaseClient, row: MetaAssetRow): Promise<MetaAssetOpen> {
  // The token and the account live in ad_account (the owner pastes the token
  // in /meta/barrido). The env var is only a fallback; re-resolving an expired
  // URL with a dead env token is exactly how every download came back 502.
  const { data: acc } = await sb.from('ad_account').select('ad_account_id,access_token')
    .eq('brand_id', row.brand_id).eq('active', true).limit(1).maybeSingle();
  const brand = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  const actId = acc?.ad_account_id ?? brand?.meta_ad_account_id ?? null;
  let token: string | null = null;
  try { token = adToken(acc?.access_token ?? null); } catch { token = null; }
  let resolveError: string | null = null;
  let ownBucket = isOwnBucketUrl(row.asset_url);

  let upstream = row.asset_url ? await open(row.asset_url) : null;

  // URL caducada -> re-resolver contra la API y actualizar la fila.
  if (!upstream && row.ad_id && actId && token) {
    try {
      const u = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${row.ad_id}`);
      u.searchParams.set('fields', AD_FIELDS);
      u.searchParams.set('access_token', token);
      const ad = (await (await fetch(u, { cache: 'no-store' })).json()) as RawAd & { error?: { message?: string } };
      if (ad.error) throw new Error(ad.error.message ?? 'Meta rechazó la consulta');
      const fresh = await resolveAsset(ad, actId, token);
      if (!fresh.url) resolveError = fresh.error ?? 'Meta no entregó el archivo';
      if (fresh.url) {
        await sb.from('meta_ads').update({
          asset_url: fresh.url, asset_kind: fresh.kind,
          asset_strategy: fresh.strategy, thumbnail_url: fresh.thumbnail, asset_error: null,
        }).eq('id', row.id);
        row.asset_url = fresh.url;
        row.asset_kind = fresh.kind;
        row.thumbnail_url = fresh.thumbnail;
        ownBucket = false;
        upstream = await open(fresh.url);
      }
    } catch (e) {
      resolveError = e instanceof Error ? e.message : 'No se pudo re-resolver el creativo';
    }
  }

  if (!upstream) {
    // Leave the reason on the row so the Top 30 board can say "súbelo tú".
    const error = resolveError ?? 'La URL del creativo caducó y Meta no la renovó';
    await sb.from('meta_ads').update({ asset_error: error, updated_at: new Date().toISOString() }).eq('id', row.id);
    return { upstream: null, error, ownBucket };
  }
  return { upstream, error: null, ownBucket };
}

/**
 * Reads a Response body into memory with a hard size cap. Streams chunk by
 * chunk so a huge file fails fast instead of exhausting the function's RAM.
 */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new Error(`El archivo pesa ${Math.round(declared / 1048576)} MB; el máximo es ${Math.round(maxBytes / 1048576)} MB`);
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`El archivo pasa de ${Math.round(maxBytes / 1048576)} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)), total);
}
