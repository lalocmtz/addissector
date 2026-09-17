// =============================================================================
// Desmenuzado de un video de TikTok Shop.
//
// No es el mismo análisis que el de un anuncio de Meta, y forzarlo sería el
// error. Un anuncio de Meta se juzga contra una economía: ROAS, equilibrio,
// apagar o escalar. Un video de TikTok Shop que funcionó no trae esos números
// y no los va a traer — aquí la pregunta es otra y más vieja:
//
//   ¿QUÉ hizo este video, en qué orden, y por qué eso hace comprar?
//
// Por eso la salida es una receta, no un veredicto: el hook literal, la
// estructura beat por beat con sus segundos, el framework con nombre —para
// poder pedir "hazme otro con este framework"—, la objeción que tumba y el
// gancho de retención. Todo lo que el modelo no pueda ver se queda vacío: un
// framework inventado es peor que ninguno, porque se copia igual.
// =============================================================================

import { geminiGenerateJson, mediaPart, deleteGeminiFile, type GeminiPart } from '@/lib/gemini';

export interface TtBeat {
  /** Segundo en que empieza. */
  t: number;
  /** Qué pasa en pantalla y qué se dice. */
  what: string;
  /** Para qué sirve ese momento: enganchar, probar, tumbar objeción, cerrar. */
  role: string;
}

export interface TtVideoResult {
  transcript: string;
  /** La primera frase hablada, literal. */
  hook: string;
  /** El primer texto en pantalla, literal. */
  headline: string;
  /** Nombre corto y reusable de la estructura. */
  framework: string;
  /** La estructura explicada para quien va a repetirla. */
  frameworkHow: string;
  whyWorked: string;
  beats: TtBeat[];
  /** Qué duda tumba el video. */
  objection: string;
  /** Qué mantiene viendo después del segundo 3. */
  retentionHook: string;
  /** A quién le habla, en una frase. */
  avatar: string;
  productClaim: string;
  durationSeconds: number | null;
  model: string;
  raw: Record<string, unknown>;
}

const PROMPT = `Eres un analista de creativos de TikTok Shop. Te doy UN video que, según el vendedor, funcionó para vender un producto. Tu trabajo NO es opinar si es bueno: es desmenuzar QUÉ hace, EN QUÉ ORDEN, y POR QUÉ eso hace comprar, con el detalle suficiente para que alguien más lo pueda repetir con otro producto.

Devuelve SOLO un objeto JSON con exactamente estas llaves:

{
  "transcript": "transcripción literal y completa de todo lo hablado. Cadena vacía si el video es mudo.",
  "hook": "la PRIMERA frase hablada, palabra por palabra. Vacío si nadie habla.",
  "headline": "el PRIMER texto que aparece en pantalla, palabra por palabra. Vacío si no hay texto.",
  "framework": "nombre corto y reusable de la estructura, 2 a 5 palabras, en español. Ejemplos del estilo esperado: 'Problema visible y prueba en cámara', 'Reacción a comentario', 'Tres razones en quince segundos', 'Antes y después sin voz', 'Objeción de precio al final'. NO uses estos ejemplos salvo que el video de verdad haga eso.",
  "framework_how": "cómo se repite esa estructura, en 2 o 3 frases, dirigido a quien va a grabar otro video con otro producto.",
  "why_worked": "por qué esto hace comprar. La palanca real: prueba visible, urgencia, identificación, curiosidad, precio, autoridad. Sé concreto sobre QUÉ del video la activa.",
  "beats": [
    { "t": 0, "what": "qué se ve y qué se dice", "role": "enganchar | contextualizar | probar | tumbar objeción | cerrar" }
  ],
  "objection": "qué duda del comprador neutraliza el video. Vacío si no neutraliza ninguna.",
  "retention_hook": "qué hace que alguien siga viendo después del segundo 3. Vacío si no hay nada.",
  "avatar": "a quién le habla este video, en una frase concreta. Nada de 'mujeres 25-45'.",
  "product_claim": "qué promete exactamente el producto en este video, en las palabras del video.",
  "duration_seconds": 0
}

Reglas:
- "beats" cubre el video completo, en orden, con el segundo real en que empieza cada momento. Entre 3 y 8 entradas.
- Todo en español.
- Lo que NO puedas ver u oír se queda como cadena vacía. NUNCA inventes: un framework inventado se copia igual que uno real y hace perder dinero.
- No agregues llaves extra ni texto fuera del JSON.`;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function beatsOf(v: unknown): TtBeat[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      return { t: num(o.t) ?? 0, what: str(o.what), role: str(o.role) };
    })
    .filter((b) => b.what)
    .slice(0, 12);
}

export async function analyzeTikTokVideo(input: {
  bytes: Uint8Array;
  mime: string;
  apiKey: string;
  title: string;
  durationHint?: number | null;
}): Promise<TtVideoResult> {
  const { part, uploaded } = await mediaPart(input.bytes, input.mime, input.apiKey, { displayName: input.title });
  const parts: GeminiPart[] = [part, { text: PROMPT }];

  let json: Record<string, unknown>;
  let model: string;
  try {
    ({ json, model } = await geminiGenerateJson<Record<string, unknown>>(parts, input.apiKey));
  } finally {
    // Best-effort: si no se borra, Gemini lo caduca solo a las 48 h.
    if (uploaded) void deleteGeminiFile(uploaded.name, input.apiKey);
  }

  return {
    transcript: str(json.transcript),
    hook: str(json.hook),
    headline: str(json.headline),
    framework: str(json.framework),
    frameworkHow: str(json.framework_how),
    whyWorked: str(json.why_worked),
    beats: beatsOf(json.beats),
    objection: str(json.objection),
    retentionHook: str(json.retention_hook),
    avatar: str(json.avatar),
    productClaim: str(json.product_claim),
    durationSeconds: num(json.duration_seconds) ?? input.durationHint ?? null,
    model,
    raw: json,
  };
}
