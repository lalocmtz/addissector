// =============================================================================
// Gemini — the fast analysis engine (server-side only).
//
// ScaleBot-style: the video bytes go to the Gemini Files API, one
// generateContent call on the WHOLE video returns the JSON. No frames, no
// separate transcription, no browser. ~30–90 s per video.
//
// Everything here uses global fetch (Node runtime, no SDK) and never logs or
// echoes the API key.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';

const BASE = 'https://generativelanguage.googleapis.com';
/**
 * Cadena de respaldo: SOLO se usa si no se pudo preguntar a Google que modelos
 * existen. Nunca se fija un modelo como si fuera eterno — el 14-sep-2026
 * gemini-2.5-pro empezo a contestar 404 "no longer available to new users" a
 * las claves nuevas y cada analisis moria con un 502 opaco.
 */
export const GEMINI_FALLBACK_CHAIN = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
export const GEMINI_SETTING_KEY = 'gemini_api_key';

/** Images below this size travel inline (base64); above it, the Files API. */
export const INLINE_VIDEO_MAX = 19 * 1024 * 1024;
const INLINE_IMAGE_MAX = 15 * 1024 * 1024;

export class GeminiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

/**
 * The user's key from app_settings (key='gemini_api_key'), else the server env.
 * A missing table or a failed query silently falls back to the env var.
 */
export async function getGeminiKey(sb: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await sb
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', GEMINI_SETTING_KEY)
      .maybeSingle();
    const v = typeof data?.value === 'string' ? data.value.trim() : '';
    if (v) return v;
  } catch {
    /* table may not exist yet: env fallback */
  }
  const env = (process.env.GEMINI_API_KEY ?? '').trim();
  return env || null;
}

// ---------------------------------------------------------------------------
// Files API
// ---------------------------------------------------------------------------

export interface GeminiFile {
  name: string;      // "files/abc123"
  uri: string;       // the file_uri to reference in generateContent
  mimeType: string;
  state: string;     // PROCESSING | ACTIVE | FAILED
  error?: { code?: number; message?: string } | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as { error?: { message?: string } };
    if (j.error?.message) return j.error.message;
  } catch { /* not JSON */ }
  return text.slice(0, 300) || `HTTP ${res.status}`;
}

/**
 * Raw upload + poll until ACTIVE (max ~90 s, every 3 s). Returns the file
 * descriptor to reference with `file_data` in generateContent.
 */
export async function uploadToGemini(
  bytes: Uint8Array,
  mime: string,
  apiKey: string,
  opts: { displayName?: string; maxWaitMs?: number; pollMs?: number } = {},
): Promise<GeminiFile> {
  const url = `${BASE}/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-Header-Content-Type': mime,
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'Content-Type': mime,
      ...(opts.displayName ? { 'X-Goog-File-Name': opts.displayName.slice(0, 100) } : {}),
    },
    // Buffer/Uint8Array is a valid BodyInit in Node's fetch.
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) throw new GeminiError(`Gemini no aceptó el archivo: ${await readError(res)}`, res.status);
  const j = (await res.json()) as { file?: GeminiFile };
  let file = j.file;
  if (!file?.name) throw new GeminiError('Gemini no devolvió el archivo subido');

  const maxWait = opts.maxWaitMs ?? 90_000;
  const poll = opts.pollMs ?? 3_000;
  const started = Date.now();
  while (file.state !== 'ACTIVE') {
    if (file.state === 'FAILED') throw new GeminiError(`Gemini no pudo procesar el archivo (${mime}, ${Math.round(bytes.byteLength / 1024)} KB${file.error?.message ? `: ${file.error.message}` : ''})`);
    if (Date.now() - started > maxWait) throw new GeminiError('Gemini tardó demasiado en procesar el archivo');
    await sleep(poll);
    const r = await fetch(`${BASE}/v1beta/${file.name}?key=${encodeURIComponent(apiKey)}`, { cache: 'no-store' });
    if (!r.ok) throw new GeminiError(`No se pudo consultar el archivo en Gemini: ${await readError(r)}`, r.status);
    file = { ...file, ...((await r.json()) as Partial<GeminiFile>) } as GeminiFile;
  }
  return file;
}

/** Best-effort cleanup: the file expires on its own in 48 h anyway. */
export async function deleteGeminiFile(name: string, apiKey: string): Promise<void> {
  try {
    await fetch(`${BASE}/v1beta/${name}?key=${encodeURIComponent(apiKey)}`, { method: 'DELETE' });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// generateContent → JSON
// ---------------------------------------------------------------------------

export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { mime_type: string; file_uri: string } };

/** Builds the media part: inline base64 for small images, Files API otherwise. */
export async function mediaPart(
  bytes: Uint8Array,
  mime: string,
  apiKey: string,
  opts: { displayName?: string } = {},
): Promise<{ part: GeminiPart; uploaded: GeminiFile | null }> {
  if (mime.startsWith('image/') && bytes.byteLength < INLINE_IMAGE_MAX) {
    return { part: { inline_data: { mime_type: mime, data: Buffer.from(bytes).toString('base64') } }, uploaded: null };
  }
  try {
    const uploaded = await uploadToGemini(bytes, mime, apiKey, { displayName: opts.displayName });
    return { part: { file_data: { mime_type: uploaded.mimeType || mime, file_uri: uploaded.uri } }, uploaded };
  } catch (e) {
    // Some CDN encodes (fragmented MP4 from fbcdn) fail in the Files API but
    // decode fine when sent inline. One more try before giving up.
    if (e instanceof GeminiError && /no pudo procesar/i.test(e.message) && bytes.byteLength < INLINE_VIDEO_MAX) {
      return { part: { inline_data: { mime_type: mime, data: Buffer.from(bytes).toString('base64') } }, uploaded: null };
    }
    throw e;
  }
}

function stripFences(raw: string): string {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

async function generateOnce(parts: GeminiPart[], apiKey: string, model: string): Promise<string> {
  const res = await fetch(`${BASE}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new GeminiError(`Gemini (${model}) respondió ${res.status}: ${await readError(res)}`, res.status);
  const j = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };
  if (j.promptFeedback?.blockReason) throw new GeminiError(`Gemini bloqueó el contenido: ${j.promptFeedback.blockReason}`);
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text.trim()) throw new GeminiError('Gemini devolvió una respuesta vacía');
  return text;
}

const isOverload = (e: unknown) =>
  e instanceof GeminiError && (e.status === 429 || e.status === 503 || e.status === 500 || /overload|resource.?exhausted|quota/i.test(e.message));

/** El modelo ya no existe para esta clave: hay que probar el siguiente. */
const isModelGone = (e: unknown) =>
  e instanceof GeminiError
  && (e.status === 404 || e.status === 400)
  && /no longer available|not found|is not supported|no such model|not supported for/i.test(e.message);

interface Descubierto { huella: string; cadena: string[]; at: number }
let descubierto: Descubierto | null = null;
const CACHE_MS = 30 * 60 * 1000;

/** Version alta primero, luego pro sobre flash; castiga lite / preview / exp. */
function puntuar(n: string): number {
  const ver = Number((n.match(/gemini-(\d+(?:\.\d+)?)/) ?? [])[1] ?? 0);
  return ver * 100
    + (/pro/.test(n) ? 30 : 0)
    + (/flash/.test(n) ? 20 : 0)
    - (/lite/.test(n) ? 10 : 0)
    - (/(exp|preview)/.test(n) ? 15 : 0);
}

/**
 * Le pregunta a Google que modelos acepta ESTA clave, en vez de confiar en un
 * nombre fijo. Se cachea 30 min por clave; si la consulta falla queda la cadena
 * de respaldo. Esto es lo que evita que un retiro de modelo del lado de Google
 * vuelva a tumbar todos los analisis.
 */
export async function geminiModelChain(apiKey: string): Promise<string[]> {
  const huella = apiKey.slice(-8);
  if (descubierto && descubierto.huella === huella && Date.now() - descubierto.at < CACHE_MS) {
    return descubierto.cadena;
  }
  let cadena = [...GEMINI_FALLBACK_CHAIN];
  try {
    const res = await fetch(`${BASE}/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`, { cache: 'no-store' });
    if (res.ok) {
      const j = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
      const nombres = (j.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter((n) => n.startsWith('gemini-') && !/embedding|aqa|imagen|image-gen|tts|audio|live|learnlm/i.test(n));
      if (nombres.length) cadena = nombres.sort((a, b) => puntuar(b) - puntuar(a)).slice(0, 6);
    }
  } catch { /* sin red hacia Google: queda la cadena de respaldo */ }
  descubierto = { huella, cadena, at: Date.now() };
  return cadena;
}

/**
 * One generateContent call that must return a JSON object. Recorre la cadena de
 * modelos: avanza al siguiente si el modelo ya no existe para esta clave o si
 * viene saturado, y se detiene en cualquier otro error.
 */
export async function geminiGenerateJson<T = Record<string, unknown>>(
  parts: GeminiPart[],
  apiKey: string,
  model?: string,
): Promise<{ json: T; model: string }> {
  const descubierta = await geminiModelChain(apiKey);
  const cadena = model ? [model, ...descubierta.filter((m) => m !== model)] : descubierta;
  let ultimo: unknown = new GeminiError('Gemini no tiene ningun modelo disponible para esta clave');
  for (const usado of cadena) {
    let raw: string;
    try {
      raw = await generateOnce(parts, apiKey, usado);
    } catch (e) {
      ultimo = e;
      if (isModelGone(e) || isOverload(e)) continue;
      throw e;
    }
    try {
      return { json: JSON.parse(stripFences(raw)) as T, model: usado };
    } catch {
      throw new GeminiError('Gemini no devolvió un JSON válido');
    }
  }
  throw ultimo;
}
