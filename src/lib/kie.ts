// =============================================================================
// AdDNA — Cliente de Kie.ai.
// Imagen: Nano Banana Pro. Video: Sora 2 Pro (máxima calidad) / Sora 2 /
// Seedance 1.5 Pro 1080p. API asíncrona: createTask → poll recordInfo.
// =============================================================================

const KIE_API = 'https://api.kie.ai';

export type VideoQuality = 'sora_pro' | 'sora' | 'seedance' | 'broll';

export const KIE_MODELS = {
  image: 'nano-banana-pro',
  video: {
    sora_pro: 'sora-2-pro-image-to-video',
    sora: 'sora-2-image-to-video',
    seedance: 'bytedance/seedance-1.5-pro',
    broll: 'bytedance/seedance-1.5-pro', // 720p sin audio: b-roll económico
  } as Record<VideoQuality, string>,
};

// Estimaciones en USD (el saldo real viene de la API; la fuente de verdad de
// cada cobro es kie.ai/logs). Verificado jul 2026: nano-banana-pro 1K = 18
// créditos (~$0.09); seedance-1.5-pro audio 1080p = 15 créditos/seg.
export const COST_ESTIMATES = {
  imageUsd: 0.09,
  video: {
    sora_pro: { per10s: 1.4, per15s: 2.1, label: 'Sora 2 Pro · máxima calidad' },
    sora: { per10s: 0.25, per15s: 0.38, label: 'Sora 2 · alta calidad' },
    seedance: { per10s: 0.75, per15s: 1.13, label: 'Seedance 1.5 Pro 1080p' },
    broll: { per10s: 0.18, per15s: 0.27, label: 'B-roll 720p sin voz' }, // 3.5 cr/s
  },
};

export function estimateVideoUsd(quality: VideoQuality, seconds: number): number {
  const e = COST_ESTIMATES.video[quality];
  if (quality === 'broll') return 0.0175 * seconds;
  return seconds <= 10 ? e.per10s : e.per15s;
}

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

/** Video a partir de la imagen aprobada, según el nivel de calidad elegido. */
export async function createVideoTask(opts: {
  quality: VideoQuality;
  prompt: string;
  firstFrameUrl: string;
  durationSeconds: number;
  generateAudio: boolean;
}): Promise<{ taskId: string; model: string }> {
  const model = KIE_MODELS.video[opts.quality];

  if (opts.quality === 'sora_pro' || opts.quality === 'sora') {
    // Sora 2: duraciones fijas de 10 o 15 segundos; audio/diálogo nativo.
    const nFrames = opts.durationSeconds <= 10 ? '10' : '15';
    const data = await kiePost<{ taskId: string }>('/api/v1/jobs/createTask', {
      model,
      input: {
        prompt: opts.prompt,
        image_urls: [opts.firstFrameUrl],
        aspect_ratio: 'portrait',
        n_frames: nFrames,
        size: 'standard',
        remove_watermark: true,
      },
    });
    return { taskId: data.taskId, model };
  }

  // Seedance 1.5 Pro (seedance = 1080p con audio · broll = 720p sin audio)
  const duration = Math.max(4, Math.min(12, Math.round(opts.durationSeconds)));
  const isBroll = opts.quality === 'broll';
  const data = await kiePost<{ taskId: string }>('/api/v1/jobs/createTask', {
    model,
    input: {
      prompt: opts.prompt,
      input_urls: [opts.firstFrameUrl],
      generate_audio: isBroll ? false : opts.generateAudio,
      resolution: isBroll ? '720p' : '1080p',
      aspect_ratio: '9:16',
      duration: String(duration),
      fixed_lens: false,
    },
  });
  return { taskId: data.taskId, model };
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

/** Saldo de créditos de la cuenta de Kie. */
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
