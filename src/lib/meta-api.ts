// =============================================================================
// AdDNA — Cliente de la Meta Marketing API.
//
// Reemplaza el export CSV del socio por lectura directa de la cuenta. Dos
// diferencias importantes contra el parser de CSV (src/lib/meta.ts):
//
//   1. Aquí llega `ad_id` REAL, así que el vínculo entre números y creativo
//      deja de depender del matching por nombre.
//   2. Impresiones y reproducciones vienen REALES, no derivadas de
//      spend/cpm ni de hook_rate x impresiones.
//
// TRAMPA DOCUMENTADA: /act_<id>/ads con `creative{}` anidado y limit=200
// devuelve `data: []` SIN error. Por eso PAGE_LIMIT nunca pasa de 100.
// =============================================================================

import type { DailyRow } from './meta';

export const GRAPH_VERSION = 'v25.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PAGE_LIMIT = 100;

export class MetaApiError extends Error {
  code?: number;
  subcode?: number;
  constructor(message: string, code?: number, subcode?: number) {
    super(message);
    this.name = 'MetaApiError';
    this.code = code;
    this.subcode = subcode;
  }
}

/** Token de la cuenta publicitaria (ads_read + ads_management). */
export function adToken(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new MetaApiError('Falta META_ACCESS_TOKEN en las variables de entorno');
  return t;
}

/**
 * Token de Página, OPCIONAL. Los videos que usan los anuncios viven bajo la
 * Página, no bajo la videoteca de la cuenta publicitaria: sin este token el
 * campo `source` responde error #10 y no se puede bajar el MP4.
 */
export function pageToken(): string | null {
  return process.env.META_PAGE_TOKEN || null;
}

interface GraphQuery {
  [k: string]: string | number | undefined;
}

async function graph<T>(path: string, query: GraphQuery = {}, token?: string): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('access_token', token ?? adToken());
  const res = await fetch(url, { cache: 'no-store' });
  const json = (await res.json()) as T & { error?: { message: string; code: number; error_subcode?: number } };
  if (json.error) throw new MetaApiError(json.error.message, json.error.code, json.error.error_subcode);
  return json;
}

interface Paged<T> {
  data: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

/** Recorre todas las páginas de un edge. `maxPages` acota el gasto de cuota. */
async function graphAll<T>(
  path: string,
  query: GraphQuery = {},
  { token, maxPages = 25 }: { token?: string; maxPages?: number } = {}
): Promise<T[]> {
  const out: T[] = [];
  let first = true;
  let next: string | null = null;
  const tk = token ?? adToken();

  for (let page = 0; page < maxPages; page++) {
    let json: Paged<T>;
    if (first) {
      json = await graph<Paged<T>>(path, { ...query, limit: PAGE_LIMIT }, tk);
      first = false;
    } else {
      if (!next) break;
      const url = new URL(next);
      url.searchParams.set('access_token', tk);
      const res = await fetch(url, { cache: 'no-store' });
      const raw = (await res.json()) as Paged<T> & { error?: { message: string; code: number } };
      if (raw.error) throw new MetaApiError(raw.error.message, raw.error.code);
      json = raw;
    }
    out.push(...(json.data ?? []));
    next = json.paging?.next ?? null;
    if (!next) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Insights: la serie diaria por anuncio (reemplazo del CSV)
// ---------------------------------------------------------------------------

const INSIGHT_FIELDS = [
  'ad_id', 'ad_name', 'date_start', 'spend', 'impressions', 'frequency', 'cpm', 'cpc',
  'purchase_roas', 'actions', 'action_values', 'cost_per_action_type',
  'video_play_actions', 'video_p25_watched_actions', 'video_p50_watched_actions',
  'video_p75_watched_actions',
].join(',');

interface ActionEntry { action_type: string; value: string }
interface RawInsight {
  ad_id: string;
  ad_name: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  frequency?: string;
  cpm?: string;
  cpc?: string;
  purchase_roas?: ActionEntry[];
  actions?: ActionEntry[];
  action_values?: ActionEntry[];
  cost_per_action_type?: ActionEntry[];
  video_play_actions?: ActionEntry[];
  video_p25_watched_actions?: ActionEntry[];
  video_p50_watched_actions?: ActionEntry[];
  video_p75_watched_actions?: ActionEntry[];
}

const n = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Suma las variantes de un action_type (omni_purchase, offsite_conversion..., etc). */
function actionSum(list: ActionEntry[] | undefined, ...types: string[]): number | null {
  if (!list?.length) return null;
  let total = 0;
  let found = false;
  for (const a of list) {
    if (types.some((t) => a.action_type === t)) {
      const v = Number(a.value);
      if (Number.isFinite(v)) { total += v; found = true; }
    }
  }
  return found ? total : null;
}

/** Primer valor de un action_type (para ROAS, que no se suma). */
function actionFirst(list: ActionEntry[] | undefined, ...types: string[]): number | null {
  if (!list?.length) return null;
  for (const a of list) {
    if (types.some((t) => a.action_type === t)) {
      const v = Number(a.value);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

export interface ApiDailyRow extends DailyRow {
  ad_id: string;
}

/** Traduce una fila de insights al mismo shape que ya consume la plataforma. */
export function insightToDailyRow(r: RawInsight): ApiDailyRow {
  const spend = n(r.spend) ?? 0;
  const impressions = n(r.impressions) ?? 0;

  const purchases = actionSum(r.actions, 'purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase');
  const revenue = actionSum(r.action_values, 'purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase');
  const atc = actionSum(r.actions, 'add_to_cart', 'omni_add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart');
  const linkClicks = actionSum(r.actions, 'link_click');

  const roas = actionFirst(r.purchase_roas, 'purchase', 'omni_purchase')
    ?? (revenue != null && spend > 0 ? revenue / spend : null);

  // v3s: Meta ya no expone de forma estable "3 segundos"; video_play_actions es
  // el equivalente vivo. Se guarda REAL, no derivado de hook_rate.
  const v3s = actionSum(r.video_play_actions, 'video_view');
  const v25 = actionSum(r.video_p25_watched_actions, 'video_view');
  const v50 = actionSum(r.video_p50_watched_actions, 'video_view');
  const v75 = actionSum(r.video_p75_watched_actions, 'video_view');

  return {
    ad_id: r.ad_id,
    ad_name: r.ad_name,
    date: r.date_start,
    status: null,
    created_date: null,
    spend,
    revenue,
    roas,
    cpa: purchases && purchases > 0 ? spend / purchases : null,
    cpc: n(r.cpc),
    cpm: n(r.cpm),
    v3s,
    hook_rate: v3s != null && impressions > 0 ? (v3s / impressions) * 100 : null,
    v25,
    v50,
    v75,
    freq: n(r.frequency),
    cost_atc: atc && atc > 0 ? spend / atc : null,
    link_clicks: linkClicks,
    cvr: linkClicks && linkClicks > 0 && purchases ? (purchases / linkClicks) * 100 : null,
    result_rate: linkClicks && impressions > 0 ? (linkClicks / impressions) * 100 : null,
  };
}

export interface FetchInsightsOpts {
  since?: string; // YYYY-MM-DD
  until?: string;
  datePreset?: string;
  maxPages?: number;
}

/** Serie diaria por anuncio. Devuelve también las impresiones reales por fila. */
export async function fetchDailyInsights(
  actId: string,
  opts: FetchInsightsOpts = {}
): Promise<{ rows: ApiDailyRow[]; impressions: Map<string, number> }> {
  const query: GraphQuery = {
    level: 'ad',
    time_increment: 1,
    fields: INSIGHT_FIELDS,
  };
  if (opts.since && opts.until) {
    query.time_range = JSON.stringify({ since: opts.since, until: opts.until });
  } else {
    query.date_preset = opts.datePreset ?? 'last_30d';
  }
  const raw = await graphAll<RawInsight>(`${actId}/insights`, query, { maxPages: opts.maxPages ?? 40 });
  const impressions = new Map<string, number>();
  const rows = raw.map((r) => {
    const row = insightToDailyRow(r);
    impressions.set(`${row.ad_id}|${row.date}`, Number(r.impressions ?? 0));
    return row;
  });
  return { rows, impressions };
}

// ---------------------------------------------------------------------------
// Anuncios y sus creativos
// ---------------------------------------------------------------------------

export interface RawAd {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  created_time?: string;
  adset_id?: string;
  campaign_id?: string;
  creative?: {
    id?: string;
    video_id?: string;
    image_url?: string;
    thumbnail_url?: string;
    effective_object_story_id?: string;
    object_story_spec?: {
      page_id?: string;
      instagram_actor_id?: string;
      video_data?: { video_id?: string; image_url?: string };
      link_data?: { image_hash?: string; picture?: string };
    };
    asset_feed_spec?: { videos?: Array<{ video_id?: string }>; images?: Array<{ hash?: string; url?: string }> };
  };
}

const AD_FIELDS =
  'id,name,status,effective_status,created_time,adset_id,campaign_id,' +
  'creative{id,video_id,image_url,thumbnail_url,effective_object_story_id,object_story_spec,asset_feed_spec}';

/** Todos los anuncios de la cuenta con su creativo. Pagina de 100 en 100. */
export async function fetchAds(actId: string, maxPages = 40): Promise<RawAd[]> {
  return graphAll<RawAd>(`${actId}/ads`, { fields: AD_FIELDS }, { maxPages });
}

/** Extrae todos los video_id que referencia un anuncio (incluye dynamic creative). */
export function videoIdsOf(ad: RawAd): string[] {
  const c = ad.creative ?? {};
  const ids = new Set<string>();
  if (c.video_id) ids.add(c.video_id);
  if (c.object_story_spec?.video_data?.video_id) ids.add(c.object_story_spec.video_data.video_id);
  for (const v of c.asset_feed_spec?.videos ?? []) if (v.video_id) ids.add(v.video_id);
  return [...ids];
}

/** URL de imagen de un anuncio estático (no necesita permisos extra). */
export function imageUrlOf(ad: RawAd): string | null {
  const c = ad.creative ?? {};
  return (
    c.image_url ??
    c.object_story_spec?.video_data?.image_url ??
    c.object_story_spec?.link_data?.picture ??
    c.asset_feed_spec?.images?.[0]?.url ??
    c.thumbnail_url ??
    null
  );
}

// ---------------------------------------------------------------------------
// Resolución del MP4 — cadena de estrategias con degradación elegante
// ---------------------------------------------------------------------------

export type AssetKind = 'video' | 'image' | 'none';

export interface ResolvedAsset {
  kind: AssetKind;
  url: string | null;
  /** Qué estrategia funcionó. Se guarda en la BD para poder diagnosticar. */
  strategy: string;
  thumbnail: string | null;
  duration: number | null;
  videoId: string | null;
  error?: string;
}

/** Catálogo de la videoteca de la cuenta, cacheado por proceso. */
const catalogCache = new Map<string, Map<string, { source?: string; length?: number; picture?: string }>>();

export async function advideoCatalog(actId: string) {
  const hit = catalogCache.get(actId);
  if (hit) return hit;
  const map = new Map<string, { source?: string; length?: number; picture?: string }>();
  try {
    const vids = await graphAll<{ id: string; source?: string; length?: number; picture?: string }>(
      `${actId}/advideos`,
      { fields: 'id,source,length,picture' },
      { maxPages: 20 }
    );
    for (const v of vids) map.set(v.id, v);
  } catch {
    /* sin catálogo, las otras estrategias siguen vivas */
  }
  catalogCache.set(actId, map);
  return map;
}

/**
 * Resuelve el asset descargable de un anuncio probando, en orden:
 *   1. nodo /{video_id} con TOKEN DE PÁGINA  (la ruta buena)
 *   2. nodo /{video_id} con token de la cuenta
 *   3. la videoteca /act_<id>/advideos
 *   4. el post de la página vía effective_object_story_id
 *   5. imagen del creativo (estáticos)
 * Nunca lanza: si todo falla devuelve kind 'none' con el motivo.
 */
export async function resolveAsset(ad: RawAd, actId: string): Promise<ResolvedAsset> {
  const vids = videoIdsOf(ad);
  const errors: string[] = [];
  const pt = pageToken();

  for (const vid of vids) {
    // 1 y 2 — nodo del video, primero con token de página
    for (const [label, tk] of [['page-token', pt], ['ad-token', adToken()]] as const) {
      if (!tk) continue;
      try {
        const v = await graph<{ source?: string; length?: number; picture?: string }>(
          vid, { fields: 'id,source,length,picture' }, tk
        );
        if (v.source) {
          return { kind: 'video', url: v.source, strategy: `video-node:${label}`,
                   thumbnail: v.picture ?? null, duration: v.length ?? null, videoId: vid };
        }
      } catch (e) {
        errors.push(`${label}:${(e as Error).message.slice(0, 60)}`);
      }
    }
    // 3 — videoteca de la cuenta
    try {
      const cat = await advideoCatalog(actId);
      const v = cat.get(vid);
      if (v?.source) {
        return { kind: 'video', url: v.source, strategy: 'advideos-catalog',
                 thumbnail: v.picture ?? null, duration: v.length ?? null, videoId: vid };
      }
    } catch { /* sigue */ }
  }

  // 4 — el post de la página
  const storyId = ad.creative?.effective_object_story_id;
  if (storyId && pt) {
    try {
      const post = await graph<{ attachments?: { data?: Array<{ media?: { source?: string; image?: { src?: string } } }> } }>(
        storyId, { fields: 'attachments{media_type,media}' }, pt
      );
      const src = post.attachments?.data?.[0]?.media?.source;
      if (src) {
        return { kind: 'video', url: src, strategy: 'page-story',
                 thumbnail: post.attachments?.data?.[0]?.media?.image?.src ?? null,
                 duration: null, videoId: vids[0] ?? null };
      }
    } catch (e) {
      errors.push(`story:${(e as Error).message.slice(0, 60)}`);
    }
  }

  // 5 — estático
  const img = imageUrlOf(ad);
  if (img && vids.length === 0) {
    return { kind: 'image', url: img, strategy: 'creative-image', thumbnail: img, duration: null, videoId: null };
  }

  return {
    kind: 'none', url: null,
    strategy: vids.length ? 'video-bloqueado' : 'sin-asset',
    thumbnail: imageUrlOf(ad), duration: null, videoId: vids[0] ?? null,
    error: errors.slice(0, 2).join(' · ') || undefined,
  };
}
