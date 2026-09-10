// =============================================================================
// Gemini analysis — ONE prompt on the whole creative (video or image) that
// returns the `creatives.analysis` shape the rest of the platform reads:
//
//   psychological_analysis.{target_avatar, buyer_psychology, awareness_level,
//                           market_sophistication, why_it_converts, ...}   → Cerebro
//   dashboard.hook.{type, scroll_stop_mechanism, effectiveness_score,
//                   text_overlay}, dashboard.patterns.*                    → Cerebro / one-pager
//   structural_analysis.winning_structure.hook (spoken first line)         → Cerebro / hook bank
//   structural_analysis.{video_type, product, total_duration_seconds, ...} → library grid
//   verdict / overall_score / score_label / signals / keep / test          → SimpleResults
//   dimensions.*                                                            → ad_dimension rows
//
// What the model cannot see it must leave empty — never invented.
// =============================================================================

import { DIMENSION_VALUES, type Dimension } from '@/lib/agents/taxonomy';
import { geminiGenerateJson, mediaPart, deleteGeminiFile, type GeminiPart } from '@/lib/gemini';

export type CreativeKind = 'video' | 'image';

export type GeminiDimensions = Partial<Record<Exclude<Dimension, 'hook' | 'duration_bucket'>, string>>;

export interface GeminiCreativeResult {
  /** Stored in creatives.analysis (AnalysisResult-compatible + simple interpretation). */
  analysis: Record<string, unknown>;
  /** Full verbatim transcript ("" for silent videos / images). Stored in creatives.transcript. */
  transcript: string;
  /** Spoken first line, verbatim (winning_structure.hook). */
  hook: string;
  /** On-screen headline in the first 3 s / the image headline (dashboard.hook.text_overlay). */
  headline: string;
  product: string;
  adType: string;
  summary: string;
  durationSeconds: number | null;
  hookScore: number | null;
  dimensions: GeminiDimensions;
  model: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const enumLine = (d: Exclude<Dimension, 'hook'>) => DIMENSION_VALUES[d].join('|');

function buildPrompt(kind: CreativeKind, adName: string, durationHint: number | null): string {
  const esVideo = kind === 'video';
  return `Eres un Creative Strategist senior de anuncios de Meta (Facebook/Instagram) para ecommerce en México. Analiza ${esVideo ? 'este VIDEO completo (imagen + audio + texto en pantalla)' : 'esta IMAGEN de anuncio'} y devuelve SOLO un objeto JSON, sin markdown ni texto alrededor.

Anuncio: "${adName}"${durationHint ? ` · duración aproximada ${Math.round(durationHint)} s` : ''}

REGLAS DURAS
- Todo el texto en español de México, directo, sin jerga de relleno.
- Lo VERBATIM es sagrado: transcript, hook hablado, texto en pantalla y textos de la imagen se copian palabra por palabra, sin corregir ni resumir.
- Si algo no existe (no hay voz, no hay texto en pantalla, no hay oferta) pon "" o [] — NUNCA inventes.
- Los campos "dimensions" usan EXACTAMENTE los valores permitidos que se listan; si ninguno aplica usa "other" (o "none" donde exista).
- Los números son números (no strings). Scores de 1 a 10 salvo overall_score (0-100).
- En "verdict", "signals", "winning_recipe", "keep" y "test" está PROHIBIDA la jerga (nada de Schwartz, PAS, AIDA, awareness, thumbstop): habla como si le explicaras a un dueño de negocio ocupado.

FORMATO (usa exactamente estos nombres de campo):
{
  "transcript": "<${esVideo ? 'transcripción COMPLETA y verbatim de todo lo que se dice; "" si no hay voz' : '""'}>",
  "product": "<qué producto o servicio vende, en pocas palabras>",
  "ad_type": "<UGC | talking head | product demo | testimonial | static | animation | founder | before/after | screen recording | otro>",
  "summary": "<2-3 frases: qué pasa en el anuncio y cómo vende>",
  "structural_analysis": {
    "video_type": "<mismo valor que ad_type>",
    "visual_context": "<dónde y cómo está grabado / compuesto>",
    "product": "<mismo que product>",
    "total_duration_seconds": <número; ${esVideo ? 'duración real del video' : '0'}>,
    "transcription": [ { "second": "<MM:SS>", "text": "<frase exacta>" } ],
    "content_summary": "<resumen del contenido>",
    "winning_structure": {
      "hook": "<la PRIMERA frase HABLADA, verbatim. "" si nadie habla>",
      "development": "<cómo desarrolla el argumento>",
      "cta": "<llamado a la acción tal cual se dice o se lee>",
      "persuasion_elements": ["<elementos de persuasión usados>"],
      "tone": "<tono>",
      "format": "<formato>"
    }
  },
  "dashboard": {
    "hook": {
      "type": "<pregunta | afirmación | problema | resultado | pattern interrupt | prueba social | oferta | curiosidad | otro>",
      "duration_seconds": <segundos que dura el hook>,
      "effectiveness_score": <1-10>,
      "effectiveness_reasoning": "<por qué ese score>",
      "scroll_stop_mechanism": "<qué exactamente detiene el pulgar en los primeros 1-2 s>",
      "frame_descriptions": ["<qué se ve en los primeros 3 s>"],
      "dominant_colors": ["<colores dominantes con nombre, no hex>"],
      "text_overlay": "<TEXTO EN PANTALLA de los primeros 3 s${esVideo ? '' : ' / el titular principal de la imagen'}, verbatim. "" si no hay>",
      "audio_tone": "<tono del audio o "">",
      "music_type": "<tipo de música o "">"
    },
    "visual_frames": [
      { "timestamp": "<MM:SS>", "description": "<qué se ve>", "composition": "<encuadre>", "dominant_colors": ["<nombre>"], "text_on_screen": "<texto verbatim o null>", "subject": "<sujeto>", "camera_movement": "<estático | zoom | paneo | cortes rápidos | ...>" }
    ],
    "patterns": {
      "persuasion_framework": "<PAS | AIDA | BAB | problema-solución | demo | testimonio | otro>",
      "retention_techniques": ["<técnicas que retienen>"],
      "power_words": ["<palabras EXACTAS con peso persuasivo>"],
      "emotional_arc": "<viaje emocional de inicio a fin>",
      "pacing_rhythm": "<ritmo de edición>",
      "music_strategy": "<cómo el audio refuerza>",
      "ugc_markers": ["<qué lo hace sentir auténtico>"]
    },
    "overall_score": <1-10, calidad global del creativo>,
    "stopping_power_score": <1-10>
  },
  "psychological_analysis": {
    "scroll_stop": { "mechanism": "<qué detiene el scroll>", "primary_trigger": "<pattern_interrupt | curiosity_gap | novedad | movimiento | rostro | disonancia | otro>", "strength_score": <1-10>, "reasoning": "<por qué funciona>" },
    "why_it_converts": "<la razón psicológica central por la que la gente COMPRA tras ver esto>",
    "buyer_psychology": {
      "core_desire": "<deseo profundo que activa>",
      "core_pain": "<dolor que agita>",
      "identity_shift": "<en quién se convierte el comprador>",
      "objections_handled": ["<objeción y cómo se neutraliza>"]
    },
    "persuasion_triggers": [ { "trigger": "<escasez | prueba_social | autoridad | reciprocidad | compromiso | simpatía | unidad>", "how_used": "<cómo>", "timestamp": "<MM:SS>", "strength": <1-10> } ],
    "cognitive_biases": [ { "bias": "<anclaje | aversión_a_la_pérdida | FOMO | efecto_halo | disponibilidad | otro>", "how_exploited": "<cómo>" } ],
    "emotional_journey": [ { "second": "<MM:SS>", "emotion": "<emoción>", "purpose": "<para qué>" } ],
    "awareness_level": "<unaware|problem_aware|solution_aware|product_aware|most_aware>",
    "market_sophistication": "<etapa 1-5 y por qué, en una frase>",
    "target_avatar": { "who": "<a quién le habla exactamente>", "mindset": "<estado mental al verlo>", "resonance_reason": "<por qué le resuena>" },
    "math_breakdown": { "hook_duration_seconds": <número>, "ideal_hook_window": "<ej. 0-2s>", "pacing_score": <1-10>, "retention_risk_points": [ { "timestamp": "<MM:SS>", "risk": "<dónde pierde al espectador>" } ], "cta_timing": "<cuándo aparece el CTA y si es óptimo>", "thumbstop_estimate": "<baja | media | alta + por qué>" }
  },${esVideo ? '' : `
  "visual_breakdown": { "format": "<9:16 | 4:5 | 1:1 | ...>", "layout": "<composición>", "focal_point": "<dónde cae el ojo primero>", "visual_hierarchy": ["<elementos por orden de atención>"], "color_palette": ["<nombre de color>"], "color_psychology": "<qué comunica>", "typography": "<estilo tipográfico>", "product_presentation": "<cómo se muestra el producto>", "imagery_style": "<foto | 3D | UGC | ilustración | ...>", "branding_elements": ["<logo, marcadores de marca>"] },
  "copy_analysis": { "headline": "<titular verbatim>", "subheadline": "<verbatim o null>", "body_text": "<verbatim o null>", "cta_text": "<verbatim o null>", "offer_badges": ["<"50% OFF" etc. verbatim>"], "all_text_verbatim": ["<TODO el texto de la imagen, tal cual>"], "copy_angle": "<ángulo persuasivo>", "copy_framework": "<PAS | AIDA | benefit-led | otro>" },`}
  "original_script": "<${esVideo ? 'el guion completo limpio, sin timestamps' : 'todo el texto de la imagen en orden de lectura'}>",
  "replication_plan": { "voice_tone": "<tono de voz para replicarlo>", "editing_notes": "<ritmo, cortes, música, texto en pantalla>" },
  "verdict": "<UNA frase en lenguaje llano: por qué funciona (o no) este anuncio>",
  "overall_score": <0-100>,
  "score_label": "<'Flojo' si 0-49, 'Decente' si 50-74, 'Ganador' si 75-100>",
  "signals": {
    "scroll_stop": { "level": "<alto|medio|bajo>", "note": "<1 frase>" },
    "clarity": { "level": "<alto|medio|bajo>", "note": "<1 frase>" },
    "offer": { "level": "<alto|medio|bajo>", "note": "<1 frase>" }
  },
  "winning_recipe": ["<3-5 viñetas simples de por qué funciona>"],
  "keep": ["<qué NO cambiar si se replica>"],
  "test": ["<qué probar en la siguiente versión>"],
  "dimensions": {
    "format": "<${enumLine('format')}>",
    "narrative_structure": "<${enumLine('narrative_structure')}>",
    "creator": "<${enumLine('creator')}>",
    "proof_type": "<${enumLine('proof_type')}>",
    "offer": "<${enumLine('offer')}>",
    "cta": "<${enumLine('cta')}>",
    "visual_style": "<${enumLine('visual_style')}>",
    "pacing": "<${enumLine('pacing')}>",
    "awareness_level": "<${enumLine('awareness_level')}>",
    "emotional_driver": "<${enumLine('emotional_driver')}>"
  }
}`;
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function pickDimensions(raw: unknown): GeminiDimensions {
  const out: GeminiDimensions = {};
  const src = obj(raw);
  for (const d of Object.keys(DIMENSION_VALUES) as Array<Exclude<Dimension, 'hook'>>) {
    if (d === 'duration_bucket') continue;
    const v = str(src[d]).toLowerCase();
    const allowed = DIMENSION_VALUES[d];
    if (allowed.includes(v)) out[d] = v;
    else if (v && allowed.includes('other')) out[d] = 'other';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export interface AnalyzeInput {
  bytes: Uint8Array;
  mime: string;
  kind: CreativeKind;
  apiKey: string;
  adName: string;
  durationHint?: number | null;
}

/**
 * Sends the creative to Gemini and returns the normalized analysis. The media
 * part is inline for small images and a Files API upload otherwise; the
 * uploaded file is deleted afterwards (best-effort).
 */
export async function analyzeCreativeWithGemini(input: AnalyzeInput): Promise<GeminiCreativeResult> {
  const { part, uploaded } = await mediaPart(input.bytes, input.mime, input.apiKey, { displayName: input.adName });
  const parts: GeminiPart[] = [part, { text: buildPrompt(input.kind, input.adName, input.durationHint ?? null) }];

  let json: Record<string, unknown>;
  let model: string;
  try {
    ({ json, model } = await geminiGenerateJson<Record<string, unknown>>(parts, input.apiKey));
  } finally {
    if (uploaded) void deleteGeminiFile(uploaded.name, input.apiKey);
  }

  // --- pull the fields the platform relies on, normalizing types -------------
  const structural = obj(json.structural_analysis);
  const winning = obj(structural.winning_structure);
  const dashboard = obj(json.dashboard);
  const hookDash = obj(dashboard.hook);

  const transcript = str(json.transcript);
  const hook = str(winning.hook);
  const headline = str(hookDash.text_overlay);
  const product = str(json.product) || str(structural.product);
  const adType = str(json.ad_type) || str(structural.video_type);
  const summary = str(json.summary) || str(structural.content_summary);
  const durationSeconds =
    input.kind === 'image' ? null : (num(structural.total_duration_seconds) ?? input.durationHint ?? null);

  const effectiveness = num(hookDash.effectiveness_score);
  const overall10 = num(dashboard.overall_score);
  const hookScore = input.kind === 'image' ? (overall10 ?? num(dashboard.stopping_power_score)) : effectiveness;

  const dimensions = pickDimensions(json.dimensions);

  // Keep the whole object (extra fields are harmless) but make the mandatory
  // paths consistent with what was extracted.
  const analysis: Record<string, unknown> = {
    ...json,
    transcript,
    product,
    ad_type: adType,
    summary,
    structural_analysis: {
      ...structural,
      product: str(structural.product) || product,
      video_type: str(structural.video_type) || adType,
      ...(durationSeconds != null ? { total_duration_seconds: durationSeconds } : {}),
      winning_structure: { ...winning, hook },
    },
    dashboard: {
      ...dashboard,
      hook: { ...hookDash, text_overlay: headline || null, ...(effectiveness != null ? { effectiveness_score: effectiveness } : {}) },
    },
    dimensions,
    engine: { name: 'gemini', model, version: 'gemini-fast/1' },
  };

  return { analysis, transcript, hook, headline, product, adType, summary, durationSeconds, hookScore, dimensions, model };
}
