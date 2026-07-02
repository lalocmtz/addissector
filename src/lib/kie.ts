// =============================================================================
// AdDNA — Cliente de Kie.ai (Nano Banana Pro + Seedance 2.0 Fast).
// API asíncrona: createTask → poll recordInfo. Docs: https://docs.kie.ai
// =============================================================================

const KIE_API = 'https://api.kie.ai';

export const KIE_MODELS = {
  image: 'nano-banana-pro',
  video: 'bytedance/seedance-2-fast',
} as const;

// Estimaciones de costo en USD para mostrar ANTES de generar (el saldo real
// viene de la API de créditos). Ajustables sin tocar el resto del código.
export const COST_ESTIMATES = {
  imageUsd: 0.1,          // Nano Banana Pro 1K
  videoPerSecondUsd: 0.06, // Seedance 2.0 Fast 720p aprox
};

export function isKieConfigured(): boolean {
  return Boolean(process.env.KIE_API_KEY);
}

function authHeaders(): Record<string, string> {
  const key = process.env.KIE_API_KEY;
  if (!key) throw new Error('KIE_API_KEY no está configurada');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

interface KieEnvelope<T> {
  code: number;
  msg?: string;
  data?: T;
}

async function kiePost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${KIE_API}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as KieEnvelope<T>;
  if (!res.ok || json.code !== 200) {
    throw new Error(json.msg || `Kie error (${json.code ?? res.status})`);
  }
  return json.data as T;
}

async function kieGet<T>(path: string): Promise<T> {
  const res = await fetch(`${KIE_API}${path}`, { headers: authHeaders() });
  const json = (await res.json()) as KieEnvelope<T>;
  if (!res.ok || json.code !== 200) {
    throw new Error(json.msg || `Kie error (${json.code ?? res.status})`);
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Crear tareas
// ---------------------------------------------------------------------------

/** Imagen con Nano Banana Pro. referenceImageUrls: producto/frame original. */
export async function createImageTask(opts: {
  prompt: string;
  referenceImageUrls?: string[];
}): Promise<string> {
  const data = await kiePost<{ taskId: string }>('/api/v1/jobs/createTask', {
    model: KIE_MODELS.image,
    input: {
      prompt: opts.prompt,
      image_input: (opts.referenceImageUrls ?? []).slice(0, 6),
      aspect_ratio: '9:16',
      resolution: '1K',
      output_format: 'png',
    },
  });
  return data.taskId;
}

/** Video con Seedance 2.0 Fast animando una imagen (primer frame). */
export async function createVideoTask(opts: {
  prompt: string;
  firstFrameUrl: string;
  durationSeconds: number; // 4-15
  generateAudio: boolean;
}): Promise<string> {
  const duration = Math.max(4, Math.min(15, Math.round(opts.durationSeconds)));
  const data = await kiePost<{ taskId: string }>('/api/v1/jobs/createTask', {
    model: KIE_MODELS.video,
    input: {
      prompt: opts.prompt,
      first_frame_url: opts.firstFrameUrl,
      generate_audio: opts.generateAudio,
      resolution: '720p', // 1080p cuesta el doble; 720p es el estándar del curso
      aspect_ratio: '9:16',
      duration,
    },
  });
  return data.taskId;
}

// ---------------------------------------------------------------------------
// Consultar estado
// ---------------------------------------------------------------------------

export interface KieTaskStatus {
  state: 'pending' | 'processing' | 'success' | 'failed';
  resultUrls: string[];
  error?: string;
}

interface RecordInfo {
  state?: string;
  successFlag?: number;
  resultJson?: string;
  response?: { resultUrls?: string[] };
  failMsg?: string;
  errorMessage?: string;
}

/** Normaliza el estado de una tarea de Kie. */
export async function getTaskStatus(taskId: string): Promise<KieTaskStatus> {
  const data = await kieGet<RecordInfo>(
    `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`
  );

  // resultJson viene como string JSON con { resultUrls: [...] }
  let resultUrls: string[] = [];
  if (data.resultJson) {
    try {
      const parsed = JSON.parse(data.resultJson) as {
        resultUrls?: string[];
        result_urls?: string[];
      };
      resultUrls = parsed.resultUrls ?? parsed.result_urls ?? [];
    } catch {
      /* sin resultados aún */
    }
  }
  if (resultUrls.length === 0 && data.response?.resultUrls) {
    resultUrls = data.response.resultUrls;
  }

  const rawState = (data.state ?? '').toLowerCase();
  let state: KieTaskStatus['state'];
  if (rawState === 'success' || data.successFlag === 1 || resultUrls.length > 0) {
    state = 'success';
  } else if (rawState === 'fail' || rawState === 'failed' || data.successFlag === 2 || data.successFlag === 3) {
    state = 'failed';
  } else if (rawState === 'generating' || rawState === 'queuing') {
    state = 'processing';
  } else {
    state = 'processing';
  }

  return {
    state,
    resultUrls,
    error: data.failMsg || data.errorMessage || undefined,
  };
}

// ---------------------------------------------------------------------------
// Créditos
// ---------------------------------------------------------------------------

/** Saldo de créditos de la cuenta de Kie (1 crédito ≈ USD 0.005 aprox). */
export async function getKieCredits(): Promise<number | null> {
  try {
    const data = await kieGet<number | { credits?: number; credit?: number }>(
      '/api/v1/chat/credit'
    );
    if (typeof data === 'number') return data;
    return data?.credits ?? data?.credit ?? null;
  } catch {
    return null;
  }
}
