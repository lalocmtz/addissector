// =============================================================================
// AdDNA — Motor de prompts de clonación (V4 HIVE-MIND).
// Condensa el framework Sora 2 Pro V2→V4 (arquetipos UGC, leyes de POV,
// anti-artefactos, realismo de audio, guiones 15s con beats) en un
// planificador automático: análisis del ganador + marca → plan ejecutable.
// El usuario NO escribe prompts: solo aprueba y genera.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Bloques fijos V4 (se inyectan SIEMPRE en los prompts finales)
// ---------------------------------------------------------------------------

export const IPHONE_REALISM_BLOCK = `You are locked into a permanent capture style: authentic iPhone front-camera realism (paused-reel frame, NOT a professional photo).
Rules: simulate Apple iPhone computational photography. No cinematic lighting, no flash, no studio lighting, no beauty filters, no smoothing, no symmetry correction, no pose optimization, no glamour grading, no HDR glow.
Camera behavior: slight wide-angle distortion, flattened midtones, mild overexposure on highlights, natural shadow noise, real skin texture (pores, creases, uneven tone, fine lines intact), casual imperfect framing (slightly off-center, cropped edges allowed), micro motion blur allowed, flat true-iPhone colors, slight film grain.
Subject behavior: relaxed posture, arms NOT posed (below collarbone), neutral-soft expression, natural body proportions, looking at the screen not performing for a lens.
Environment: real lived-in space with believable imperfections (clutter allowed), uneven practical lighting — one side of face slightly brighter.
FINAL TEST: if it looks planned or like influencer content, it failed. It must look like a frame someone recorded without thinking.`;

export const MOTION_REALISM_BLOCK = `V4 MOTION & REALISM LAWS (mandatory):
Camera: true handheld iPhone — one hand, uneven grip pressure, natural micro-shake and breathing bounce, ONE subtle grip adjustment around 6-7 seconds, tiny autofocus pulse allowed, realistic exposure shifts only if the environment causes them. No tripod feel, no gimbal smoothness, no zooms, no cinematic pans, no transitions, one continuous take.
Performance: speaks mid-thought with natural pauses and filler words, quiet confidence over hype, small disbelief reactions, looks at herself/himself on screen more than at the lens, influencer cadence is banned. Micro-expressions: soft smirk, breath through nose, small head tilts.
Audio: raw iPhone mic compression, required room tone (HVAC hum / street bleed / faint echo), slight plosives and tiny breaths, no music, no sound design.
ANTI-ARTIFACT SAFETY (verbatim enforcement): Hands remain relaxed and away from the lens with no finger twisting, pointing or overlap; eyes stay naturally focused with zero drifting; mouth and lip sync remain flawless even after 12 seconds; skin stays consistently textured with zero melting or warping; face tracking stays ultra-stable throughout; interior geometry stays locked with no bending.`;

// ---------------------------------------------------------------------------
// Planificador V4 (system prompt para Claude)
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM_PROMPT = `Eres el motor de clonación V4 de AdDNA: un director creativo experto en AI UGC (framework Sora 2 Pro V4 "hive-mind") que convierte el análisis de un anuncio ganador en un plan de generación EJECUTABLE para modelos de IA (Nano Banana Pro para imagen inicial, Sora 2 / Seedance para video). El usuario no edita nada: tu plan debe salir listo.

FILOSOFÍA V4 (regla suprema): si se ve planeado, falló. Si se siente accidental, incómodo o demasiado real — pasó. El test: ¿alguien comentaría "why does this feel too real?".

PASO 1 — SELECCIÓN DE ARQUETIPO (elige el que MEJOR replique la estructura del anuncio original):
- CONFESIONAL UGC (front camera): persona sola hablando a cámara — recámara/dorm desordenado, baño post-ducha, coche estacionado, oficina de casa, cocina con teléfono recargado en una taza. Ideal para testimonios y "descubrimientos".
- STREET INTERVIEW (rear camera): entrevistadora SIEMPRE fuera de cuadro (solo voz + mic con 5 dedos visibles abajo del cuadro); el sujeto responde el "hot take". Nocturno con neones o expo/convención de día.
- HIDDEN CAMERA / PREGUNTA CASUAL (rear camera): quien sostiene el teléfono habla y NUNCA aparece; solo se ve la persona a la que le preguntan (Costco, súper, gym). "¿Qué shampoo usas?" / "¿Qué perfume traes?".
- PODCAST CLIP: solo el/la invitada en cuadro con mic de brazo; co-host solo voz off-camera con reacciones cortas ("no way", "wait what?"). Nunca mira a cámara, solo al co-host.
- PUT-DOWN METHOD: el clip abre con la persona acomodando/soltando el teléfono (wobble + autofocus + ajuste de pelo) y luego habla.
- QUIET FLEX / LUXURY: penthouse/coche de lujo, energía calmada "esto ya es normal para mí", sin gritar.
LEY DE POV (no negociable): quien sostiene el teléfono es la voz detrás de cámara; el filmado nunca se vuelve la cámara. Front camera = confesional propio. Rear camera = POV del entrevistador.

PASO 2 — REGLAS DE ORO:
1. LA IMAGEN ES UN FRAME PAUSADO, NO EL MOMENTO PICO: persona en momento neutro-casual, producto sostenido casual a la altura del pecho, brazos relajados, expresión suave. PROHIBIDO: brazos arriba, celebraciones, sonrisas teatrales con boca abierta, golden hour, luz editorial. La emoción ocurre en el VIDEO.
2. CASTING CREÍBLE: personas del avatar objetivo con imperfecciones reales (ojeras leves, poros, arrugas según edad). "Atractivo influencer" solo si el original lo era; default = alguien que verías en la calle. Nada de caricaturas ni peinados extravagantes.
3. PRODUCTO EXACTO (crítico): si hay referencias, incluye literalmente: "She/He is holding the EXACT same product as shown in the reference images — same container shape, same label design, same colors and same text. Do not redesign or reinterpret the packaging." Si no hay referencias: producto genérico SIN texto legible inventado, o mejor SIN producto en cuadro (el curso lo prefiere para claims).
4. ESTRUCTURA GANADORA, PERSONA NUEVA: conserva la psicología del original (scroll-stop, orden de ideas, tipo de cierre) con el escenario/persona de la variante elegida.
5. GUION 15s CON BEATS: coloquial, en el idioma nativo del anuncio original (no traducción — cadencia local, muletillas locales). ~2.3 palabras/segundo. Incluye beats emocionales entre paréntesis: (suspira), (risa corta), (pausa 1s, medio smirk), (se acomoda el pelo a los 4s). Debe sonar a persona real contándole a una amiga — cadencia de influencer PROHIBIDA. Empieza a media idea ("Okay espera—", "A ver, tengo que contar esto…").
6. MANOS SEGURAS: manos abajo del pecho, relajadas; UNA sola micro-acción segura permitida (acomodar pelo a media mejilla, un ajuste de agarre). Nunca contar con dedos, señalar al lente ni manipular objetos complejos.
7. AUDIO COMO SEÑAL DE REALISMO: describe el ambiente sonoro (eco de cuarto, HVAC, calle, carritos, expo) — diálogo demasiado limpio es sospechoso.
8. SEGURIDAD: nunca personas reales identificables, ni menores, ni claims médicos absolutos ("cura", "elimina"). Beneficios razonables estilo testimonio.
9. DURACIÓN: 10-15 segundos (los modelos generan 10 o 15). El guion debe caber cómodo.
10. PROMPTS EN INGLÉS (los modelos generan mejor); GUION HABLADO en el idioma del anuncio original. Si el usuario pide otro idioma/etnia/país, adapta TODO nativamente (apariencia realista sin estereotipos, señales de autoridad de esa cultura, jerga local).

Responde ÚNICAMENTE con este JSON (sin markdown, sin preámbulo):

{
  "archetype": "<confesional|street_interview|hidden_camera|podcast|put_down|quiet_flex>",
  "variant_label": "<etiqueta corta en español: arquetipo + quién/dónde, ej. 'Confesional — mamá 45 en su baño'>",
  "image_prompt": "<prompt en inglés para Nano Banana Pro: persona (edad, vibe realista, ropa normal), escenario vivido con imperfecciones, qué hace con el producto (o sin producto), encuadre según arquetipo (selfie frontal / POV del entrevistador / podcast frame), 9:16. Frame pausado neutral, NO momento pico. SIN bloque iPhone (se añade solo). Máx ~120 palabras.>",
  "motion_prompt": "<prompt en inglés para el modelo de video: la escena continua con timeline de beats (qué pasa a los 0s/4s/7s/12s), comportamiento del arquetipo (voz off-camera si aplica, reacciones del co-host si aplica), y el diálogo exacto: She/He speaks casually in [idioma nativo]: \\"<guion completo>\\" — con los beats emocionales entre paréntesis. SIN bloque de movimiento (se añade solo).>",
  "spoken_script": "<guion hablado exacto en el idioma del anuncio original, con beats entre paréntesis, 10-15s a ritmo natural>",
  "duration_seconds": <10 o 12 (usa 12 si el guion lo necesita; nunca más de 15)>,
  "generate_audio": true,
  "rationale": "<1-2 frases en español: qué arquetipo elegiste y por qué replica la estructura del ganador>"
}`;

export interface GenerationPlan {
  archetype?: string;
  variant_label: string;
  image_prompt: string;
  motion_prompt: string;
  spoken_script: string;
  duration_seconds: number;
  generate_audio: boolean;
  rationale: string;
}

function parseJsonFromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(text.slice(first, last + 1));
    }
    throw new Error('El planificador no devolvió un plan válido');
  }
}

/** Extrae solo lo relevante del análisis para no inflar el contexto. */
function condenseAnalysis(analysis: Record<string, unknown>): Record<string, unknown> {
  const pick = (obj: unknown, keys: string[]) => {
    const r: Record<string, unknown> = {};
    const o = (obj ?? {}) as Record<string, unknown>;
    for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
    return r;
  };
  return {
    verdict: analysis.verdict,
    winning_recipe: analysis.winning_recipe,
    keep: analysis.keep,
    signals: analysis.signals,
    structural: pick(analysis.structural_analysis, [
      'video_type', 'visual_context', 'product', 'content_summary', 'winning_structure',
    ]),
    psychology: pick(analysis.psychological_analysis, [
      'scroll_stop', 'why_it_converts', 'buyer_psychology', 'target_avatar', 'awareness_level',
    ]),
    original_script: analysis.original_script,
    script_variants: analysis.script_variants,
    copy_analysis: analysis.copy_analysis,
    visual_breakdown: pick(analysis.visual_breakdown, [
      'format', 'layout', 'focal_point', 'imagery_style', 'product_presentation',
    ]),
    replication_variants: (analysis.replication as Record<string, unknown> | undefined)?.variants,
  };
}

/**
 * Genera el plan de clonación V4 con Claude a partir del análisis + marca + variante.
 */
export async function buildGenerationPlan(opts: {
  analysis: Record<string, unknown>;
  creativeType: 'video' | 'image';
  variantNumber: number | null; // null = recreación fiel con persona nueva
  brand: { name?: string; tone?: string | null; palette?: string | null; product?: string | null } | null;
  hasProductReference: boolean;
}): Promise<GenerationPlan> {
  const apiKey = process.env.MY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no está configurada');

  const client = new Anthropic({ apiKey });

  const userMessage = `ANÁLISIS DEL ANUNCIO GANADOR (tipo: ${opts.creativeType}):
${JSON.stringify(condenseAnalysis(opts.analysis), null, 1)}

CONTEXTO DE LA MARCA:
${JSON.stringify(opts.brand ?? {}, null, 1)}

REFERENCIAS DISPONIBLES: ${
    opts.hasProductReference
      ? 'SÍ hay fotos del producto real — ancla el producto a la referencia (regla 3).'
      : 'NO hay fotos del producto — considera arquetipo SIN producto en cuadro, o producto genérico sin texto inventado.'
  }

VARIANTE SOLICITADA: ${
    opts.variantNumber === null
      ? 'Recreación cercana al original pero con una persona/creador nuevo (misma estructura y escenario general).'
      : `Usa la variante #${opts.variantNumber} del análisis (su escenario/persona/ángulo) como base.`
  }

Selecciona el arquetipo V4 óptimo y genera el plan JSON.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: PLANNER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('El planificador no respondió');
  }

  const plan = parseJsonFromText(textBlock.text) as GenerationPlan;

  // Saneo defensivo
  plan.duration_seconds = Math.max(8, Math.min(15, Math.round(plan.duration_seconds || 12)));
  plan.generate_audio = plan.generate_audio !== false;
  if (!plan.image_prompt || !plan.motion_prompt) {
    throw new Error('Plan incompleto del planificador');
  }
  return plan;
}

/** Prompt final de imagen = descripción del plan + bloque fijo V4 de realismo. */
export function finalImagePrompt(plan: GenerationPlan): string {
  return `${plan.image_prompt}\n\nAspect ratio 9:16 vertical.\n\n${IPHONE_REALISM_BLOCK}`;
}

/** Prompt final de video = escena + diálogo + leyes V4 de movimiento/anti-artefactos. */
export function finalMotionPrompt(plan: GenerationPlan): string {
  return `${plan.motion_prompt}\n\n${MOTION_REALISM_BLOCK}`;
}
