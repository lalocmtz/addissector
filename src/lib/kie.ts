// =============================================================================
// Kie.ai — generación de imágenes con referencia (adaptador de estáticos).
//
// Modelo principal: Nano Banana Pro (`nano-banana-pro`): hasta 8 imágenes de
// referencia en `image_input`, aspect_ratio 1:1 · 4:5 · 9:16 …, resolución
// 1K/2K/4K. Respaldo: `google/nano-banana-edit` (`image_urls`). Las tareas
// son asíncronas: createTask → taskId → recordInfo hasta state success/fail.
// Los archivos de Kie duran 14 días: el resultado se copia a nuestro bucket.
//
// La clave vive en app_settings (key='kie_api_key') por usuario; respaldo
// en la variable de entorno KIE_API_KEY.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export const KIE_SETTING_KEY = 'kie_api_key';
const BASE = 'https://api.kie.ai/api/v1/jobs';

export type Aspect = '1:1' | '4:5' | '9:16' | '16:9' | '3:4';

export async function getKieKey(sb: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('user_id', userId).eq('key', KIE_SETTING_KEY).maybeSingle();
    const v = typeof data?.value === 'string' ? data.value.trim() : '';
    if (v) return v;
  } catch { /* sin tabla: respaldo de entorno */ }
  const env = (process.env.KIE_API_KEY ?? '').trim();
  return env || null;
}

interface KieResp<T> { code?: number; msg?: string; data?: T }

async function kiePost(key: string, body: unknown): Promise<KieResp<{ taskId?: string }>> {
  const r = await fetch(`${BASE}/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return (await r.json().catch(() => ({ code: r.status, msg: `HTTP ${r.status}` }))) as KieResp<{ taskId?: string }>;
}

/**
 * Crea la tarea. Prueba Nano Banana Pro y, si Kie la rechaza, la versión de
 * edición estándar. Devuelve el taskId y qué modelo la tomó.
 */
export async function crearImagen(key: string, opts: { prompt: string; imagenes: string[]; aspect: Aspect }): Promise<{ taskId: string; model: string }> {
  const imagenes = opts.imagenes.filter(Boolean).slice(0, 8);
  const intentos: Array<{ model: string; input: Record<string, unknown> }> = [
    { model: 'nano-banana-pro', input: { prompt: opts.prompt, image_input: imagenes, aspect_ratio: opts.aspect, resolution: '2K', output_format: 'png' } },
    { model: 'google/nano-banana-edit', input: { prompt: opts.prompt, image_urls: imagenes, aspect_ratio: opts.aspect, output_format: 'png' } },
  ];
  let ultimo = '';
  for (const it of intentos) {
    const j = await kiePost(key, it);
    if (j.code === 401) throw new Error('Kie.ai rechazó la clave (401). Revisa la clave en Lanzar → Adaptar referencia.');
    if (j.code === 402) throw new Error('Kie.ai: sin créditos suficientes (402).');
    if (j.code === 200 && j.data?.taskId) return { taskId: j.data.taskId, model: it.model };
    ultimo = `${it.model}: ${j.code ?? '?'} ${j.msg ?? ''}`.trim();
  }
  throw new Error(`Kie.ai no aceptó la tarea (${ultimo})`);
}

export interface EstadoImagen { estado: 'esperando' | 'generando' | 'listo' | 'fallo'; urls: string[]; error: string | null; progreso: number | null }

export async function estadoImagen(key: string, taskId: string): Promise<EstadoImagen> {
  const r = await fetch(`${BASE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${key}` }, cache: 'no-store',
  });
  const j = (await r.json().catch(() => ({}))) as KieResp<{ state?: string; resultJson?: string; failMsg?: string; progress?: number }>;
  if (j.code !== 200 || !j.data) return { estado: 'fallo', urls: [], error: j.msg ?? `HTTP ${r.status}`, progreso: null };
  const st = j.data.state ?? '';
  if (st === 'success') {
    let urls: string[] = [];
    try { urls = (JSON.parse(j.data.resultJson ?? '{}') as { resultUrls?: string[] }).resultUrls ?? []; } catch { urls = []; }
    return { estado: urls.length ? 'listo' : 'fallo', urls, error: urls.length ? null : 'Kie.ai terminó sin imagen', progreso: 100 };
  }
  if (st === 'fail') return { estado: 'fallo', urls: [], error: j.data.failMsg || 'Kie.ai no pudo generar la imagen', progreso: null };
  return { estado: st === 'generating' ? 'generando' : 'esperando', urls: [], error: null, progreso: j.data.progress ?? null };
}
