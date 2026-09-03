// =============================================================================
// Meta Marketing API client — ads, creatives and the MP4 resolution chain.
//
// Daily insights are NOT fetched from here anymore: the single writer of
// ad_daily is the Supabase edge function `meta-sync` (supabase/functions/
// meta-sync), which has network access to graph.facebook.com and runs hourly.
// This module keeps what only Vercel can do: resolve the downloadable asset
// of each ad with Page tokens generated on the fly (see tokenForPage).
//
// TRAMPA DOCUMENTADA: /act_<id>/ads con `creative{}` anidado y limit=200
// devuelve `data: []` SIN error. Por eso PAGE_LIMIT nunca pasa de 100.
// =============================================================================

export const GRAPH_VERSION = 'v25.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const PAGE_LIMIT = 100;

export class MetaApiError extends Error {
  code?: number;
  subcode?: number;
  /** Minutos que Meta dice que faltan para recuperar el acceso (encabezado de cuota). */
  esperaMin?: number;
  constructor(message: string, code?: number, subcode?: number, esperaMin?: number) {
    super(message);
    this.name = 'MetaApiError';
    this.code = code;
    this.subcode = subcode;
    this.esperaMin = esperaMin;
  }
}

/**
 * Meta reporta el consumo de cuota en encabezados, no en el cuerpo. Ahí viene
 * `estimated_time_to_regain_access` en minutos, que es la única forma honesta
 * de decirle al usuario cuánto falta en vez de "reintenta a ver".
 */
function leerCuota(res: Response): { usoPct: number; esperaMin: number } {
  let usoPct = 0, esperaMin = 0;
  for (const h of ['x-business-use-case-usage', 'x-ad-account-usage', 'x-app-usage']) {
    const raw = res.headers.get(h);
    if (!raw) continue;
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      const entradas = Array.isArray(j) ? j : Object.values(j).flat();
      for (const e of entradas as Array<Record<string, number>>) {
        if (!e) continue;
        usoPct = Math.max(usoPct, e.call_count ?? 0, e.total_cputime ?? 0, e.total_time ?? 0);
        esperaMin = Math.max(esperaMin, e.estimated_time_to_regain_access ?? 0);
      }
    } catch { /* encabezado con formato inesperado: se ignora */ }
  }
  return { usoPct, esperaMin };
}

/** Token de la cuenta publicitaria (ads_read + ads_management). */
export function adToken(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new MetaApiError('Falta META_ACCESS_TOKEN en las variables de entorno');
  return t;
}

/**
 * Override manual de token de Página (rara vez necesario: normalmente se
 * generan solos, ver tokenForPage).
 */
export function pageTokenOverride(): string | null {
  return process.env.META_PAGE_TOKEN || null;
}

interface GraphQuery {
  [k: string]: string | number | undefined;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Códigos con los que Meta dice "vas muy rápido": conviene esperar y reintentar. */
export function esLimiteDePeticiones(e: unknown): boolean {
  const c = (e as MetaApiError)?.code;
  return c === 4 || c === 17 || c === 32 || c === 613 || c === 80004;
}

async function graph<T>(path: string, query: GraphQuery = {}, token?: string): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('access_token', token ?? adToken());

  // Meta limita por app, no por endpoint: al pasarse responde #4 y TODO empieza
  // a fallar. Dos reintentos con espera creciente absorben los picos; si aun
  // asi insiste, se propaga para que el llamador guarde lo hecho y se detenga.
  let ultimo: unknown = null;
  for (let intento = 0; intento < 3; intento++) {
    const res = await fetch(url, { cache: 'no-store' });
    const cuota = leerCuota(res);
    const json = (await res.json()) as T & { error?: { message: string; code: number; error_subcode?: number } };
    if (!json.error) return json;
    const err = new MetaApiError(json.error.message, json.error.code, json.error.error_subcode, cuota.esperaMin);
    // Si Meta dice cuántos minutos faltan, reintentar aquí es tirar el tiempo:
    // se propaga para que el llamador guarde lo hecho y avise cuánto esperar.
    if (!esLimiteDePeticiones(err) || intento === 2 || cuota.esperaMin > 0) throw err;
    ultimo = err;
    await sleep(3000 * (intento + 1));
  }
  throw ultimo as MetaApiError;
}

interface Paged<T> {
  data: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

/** Recorre todas las páginas de un edge. `maxPages` acota el gasto de cuota. */
async function graphAll<T>(
  path: string,
  query: GraphQuery = {},
  { token, maxPages = 25, pageSize = PAGE_LIMIT }: { token?: string; maxPages?: number; pageSize?: number } = {}
): Promise<T[]> {
  const out: T[] = [];
  let first = true;
  let next: string | null = null;
  const tk = token ?? adToken();

  for (let page = 0; page < maxPages; page++) {
    let json: Paged<T>;
    if (first) {
      json = await graph<Paged<T>>(path, { ...query, limit: pageSize }, tk);
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

/** page_id al que pertenece el creativo del anuncio. */
export function pageIdOf(ad: RawAd): string | null {
  return ad.creative?.object_story_spec?.page_id ?? null;
}

/**
 * Token de la Página, generado al vuelo desde el token de usuario.
 *
 * ESTE ES EL DESBLOQUEO. Los videos que usan los anuncios no viven en la
 * videoteca de la cuenta publicitaria sino bajo la Página, y el nodo
 * /{video_id} solo entrega `source` a quien tiene token de esa Página.
 * Con un token de usuario que traiga pages_show_list + pages_read_engagement,
 * /{page_id}?fields=access_token devuelve ese token — así que basta guardar
 * UN token y el servidor se fabrica los de cada página solo.
 */
const pageTokenCache = new Map<string, string | null>();

export async function tokenForPage(pageId: string): Promise<string | null> {
  const override = pageTokenOverride();
  if (override) return override;
  if (pageTokenCache.has(pageId)) return pageTokenCache.get(pageId)!;
  let token: string | null = null;
  try {
    const r = await graph<{ access_token?: string }>(pageId, { fields: 'access_token' });
    token = r.access_token ?? null;
  } catch {
    token = null;
  }
  pageTokenCache.set(pageId, token);
  return token;
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
  const pageId = pageIdOf(ad);
  const pt = pageId ? await tokenForPage(pageId) : pageTokenOverride();

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
