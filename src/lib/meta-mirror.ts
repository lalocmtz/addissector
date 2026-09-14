// =============================================================================
// Espejo de creativos — de la CDN de Meta a nuestro bucket.
//
// POR QUÉ EXISTE: `meta_ads.asset_url` guardaba el link firmado de fbcdn, no el
// archivo. Esos links caducan en días, así que la Biblioteca se quedaba con el
// análisis intacto y el reproductor en negro. La subida manual sí dejaba el
// archivo en el bucket `creative-videos` y por eso esa sí sobrevivía.
//
// La regla ahora: cada vez que abrimos el archivo de un anuncio (el proxy, el
// motor de Gemini o el backfill), si los bytes vienen de Meta los copiamos al
// bucket y dejamos en la fila la URL del bucket. A partir de ahí el creativo es
// nuestro y ya no depende de que Meta renueve nada.
//
// Es idempotente: una fila que ya apunta al bucket no se vuelve a subir.
// Y nunca tumba al que lo llama — si el espejo falla, el archivo igual se
// entrega y la fila se queda como estaba.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { openMetaAsset, readBodyCapped, isOwnBucketUrl, type MetaAssetRow } from '@/lib/meta-asset';

export const MIRROR_BUCKET = 'creative-videos';
export const MAX_MIRROR_BYTES = 100 * 1024 * 1024;
const MAX_THUMB_BYTES = 15 * 1024 * 1024;

/** Extensión a partir del mime; el bucket sirve por extensión, no por header. */
function extFor(mime: string, kind: 'video' | 'image'): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('quicktime')) return 'mov';
  if (m.includes('webm')) return 'webm';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.startsWith('image/')) return 'jpg';
  return kind === 'image' ? 'jpg' : 'mp4';
}

/** Ruta estable por anuncio: un anuncio = un archivo, se sobrescribe. */
function pathFor(row: MetaAssetRow, ext: string, suffix = ''): string {
  const id = (row.ad_id ?? row.id).replace(/[^A-Za-z0-9._-]/g, '');
  return `${row.brand_id}/meta/${id}${suffix}.${ext}`;
}

async function upload(
  sb: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string | null> {
  const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { error } = await sb.storage.from(MIRROR_BUCKET).upload(path, body, {
    contentType: mime,
    upsert: true,
    cacheControl: '31536000',
  });
  if (error) return null;
  return sb.storage.from(MIRROR_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Copia al bucket bytes que YA tenemos en memoria y apunta la fila ahí.
 * Devuelve la URL del bucket, o null si no se pudo (no es un fallo fatal).
 */
export async function mirrorBytes(
  sb: SupabaseClient,
  row: MetaAssetRow,
  bytes: Uint8Array,
  mime: string,
): Promise<string | null> {
  if (!bytes || bytes.byteLength < 1024) return null;
  if (bytes.byteLength > MAX_MIRROR_BYTES) return null;
  const kind: 'video' | 'image' = row.asset_kind === 'image' || mime.startsWith('image/') ? 'image' : 'video';
  try {
    const url = await upload(sb, pathFor(row, extFor(mime, kind)), bytes, mime);
    if (!url) return null;
    await sb.from('meta_ads').update({
      asset_url: url,
      asset_kind: kind,
      asset_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    row.asset_url = url;
    row.asset_kind = kind;
    return url;
  } catch {
    return null;
  }
}

/**
 * Lo mismo para la miniatura, que es la que deja las tarjetas en blanco.
 * Va aparte porque pesa poco y se puede recuperar aunque el video falle.
 */
export async function mirrorThumbnail(sb: SupabaseClient, row: MetaAssetRow): Promise<string | null> {
  const src = row.thumbnail_url;
  if (!src || isOwnBucketUrl(src)) return null;
  try {
    const res = await fetch(src, { cache: 'no-store' });
    if (!res.ok || !res.body) return null;
    const bytes = await readBodyCapped(res, MAX_THUMB_BYTES);
    if (bytes.byteLength < 256) return null;
    const mime = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
    if (!mime.startsWith('image/')) return null;
    const url = await upload(sb, pathFor(row, extFor(mime, 'image'), '-thumb'), bytes, mime);
    if (!url) return null;
    await sb.from('meta_ads').update({ thumbnail_url: url, updated_at: new Date().toISOString() }).eq('id', row.id);
    row.thumbnail_url = url;
    return url;
  } catch {
    return null;
  }
}

export interface MirroredAsset {
  bytes: Uint8Array | null;
  mime: string;
  kind: 'video' | 'image';
  error: string | null;
  /** true cuando esta llamada dejó una copia nueva en el bucket. */
  mirrored: boolean;
  /** true cuando el archivo ya venía del bucket (no se tocó nada). */
  fromBucket: boolean;
}

/**
 * Abre el creativo (renovando la URL contra Meta si hace falta, vía
 * openMetaAsset), lo lee a memoria y — si venía de Meta — lo espeja al bucket.
 *
 * Es el único camino que deberían usar el proxy y el motor de análisis: así el
 * primer visitante después de un barrido es el que deja la copia permanente.
 */
export async function openAndMirror(
  sb: SupabaseClient,
  row: MetaAssetRow,
  maxBytes: number = MAX_MIRROR_BYTES,
): Promise<MirroredAsset> {
  const opened = await openMetaAsset(sb, row);
  if (!opened.upstream) {
    return { bytes: null, mime: '', kind: 'video', error: opened.error ?? 'No se pudo abrir el creativo', mirrored: false, fromBucket: opened.ownBucket };
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBodyCapped(opened.upstream, maxBytes);
  } catch (e) {
    return { bytes: null, mime: '', kind: 'video', error: e instanceof Error ? e.message : 'El archivo es demasiado grande', mirrored: false, fromBucket: opened.ownBucket };
  }
  const headerMime = (opened.upstream.headers.get('content-type') ?? '').split(';')[0].trim();
  const kind: 'video' | 'image' = row.asset_kind === 'image' || headerMime.startsWith('image/') ? 'image' : 'video';
  const mime = headerMime && (headerMime.startsWith('image/') || headerMime.startsWith('video/'))
    ? headerMime
    : kind === 'image' ? 'image/jpeg' : 'video/mp4';

  let mirrored = false;
  if (!opened.ownBucket) {
    const url = await mirrorBytes(sb, row, bytes, mime);
    mirrored = Boolean(url);
    await mirrorThumbnail(sb, row);
  }
  return { bytes, mime, kind, error: null, mirrored, fromBucket: opened.ownBucket };
}
