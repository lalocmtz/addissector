// =============================================================================
// AdDNA — Motor de prompts de clonación.
// Condensa el know-how del sistema AI UGC (Franky V2-V4 + mejores prácticas
// Nano Banana / Seedance) en un planificador: análisis del ganador + marca →
// plan de generación listo (prompt de imagen + prompt de animación + guion).
// El usuario NO escribe prompts: solo confirma y genera.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Bloques fijos de realismo (del curso, probados). Se inyectan SIEMPRE.
// ---------------------------------------------------------------------------

export const IPHONE_REALISM_BLOCK = `You are locked into a permanent capture style: authentic iPhone front-camera photo realism.
Rules: simulate Apple iPhone computational photography pipeline. No cinematic lighting, no flash, no studio lighting, no beauty filters, no symmetry correction, no pose optimization, no model perfection.
Camera behavior: slight wide-angle distortion, subtle edge sharpening, flattened midtones, mild overexposure on highlights, natural shadow noise, real skin texture (pores, creases, uneven tone), casual framing with slightly imperfect crop, micro motion blur allowed, NO HDR look, iPhone 12 quality, flat image colors, slight film grain.
Subject behavior: neutral relaxed expression, relaxed posture, arms not posed, natural body proportions.
This image must look like a casual iPhone video frame or paused reel, NOT a professional photo.`;

export const MOTION_REALISM_BLOCK = `A very realistic iPhone-style selfie video. Natural movement, natural hand jitter and slight camera wobble. No zooms, no large camera movements, no cinematic transitions. The person speaks casually to the camera like a normal person filming themselves, natural pauses and micro-expressions. Keep the product clearly visible when mentioned.`;

// ---------------------------------------------------------------------------
// Planificador (system prompt para Claude)
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM_PROMPT = `Eres el motor de clonación de AdDNA: un director creativo experto en AI UGC que convierte el análisis de un anuncio ganador en un plan de generación EJECUTABLE para modelos de IA (Nano Banana Pro para imagen, Seedance 2.0 para video). El usuario es un dueño de negocio sin experiencia: tu plan debe estar 100% listo, sin que él edite nada.

REGLAS DE ORO (no negociables, vienen de sistemas probados de AI UGC):

1. REALISMO iPHONE: la imagen y el video deben parecer contenido casero real, NO producción. El bloque de captura iPhone se añade automáticamente después — NO lo repitas, pero tu descripción debe ser compatible (ambientes reales: recámara, cocina, coche, gym, baño; luz imperfecta; encuadre casual).
2. NO SOBRE-DESCRIBIR: descripciones concisas y concretas. El exceso de detalle genera artefactos. Máximo ~120 palabras en la parte descriptiva del prompt de imagen.
3. HOOK VISUAL NATURAL: el gancho debe venir del CONTEXTO y la ACCIÓN (dónde está, qué hace, qué muestra), no de rasgos extravagantes del creador. Nada de peinados estrafalarios ni personas caricaturescas. Personas creíbles del avatar objetivo.
4. CONSISTENCIA DE PRODUCTO: si hay imágenes de referencia del producto, el prompt DEBE decir que el producto es EXACTAMENTE el de la imagen de referencia ("the exact same product as in the reference image, same label, same colors"). Nunca inventes el empaque.
5. PERSONA NUEVA, ESTRUCTURA GANADORA: conserva la estructura psicológica del anuncio original (qué detiene el scroll, el orden de ideas, el tipo de cierre) pero cambia a la persona/escenario según la variante elegida.
6. GUION HABLADO: natural, coloquial, en el MISMO idioma del anuncio original. Ajusta la longitud a la duración: ~2.3 palabras por segundo. Sin tecnicismos de marketing. Debe sonar a una persona real recomendando algo, no a un anuncio.
7. DURACIÓN CON COSTO EN MENTE: el video cuesta por segundo. Usa la MENOR duración que permita decir el guion cómodo (entre 6 y 12 segundos). Nunca más de 12.
8. VIDEO: describe SOLO lo que pasa en ese clip único (una escena continua, sin cortes): qué hace la persona, cómo interactúa con el producto, y el diálogo exacto entre comillas. El bloque de movimiento natural se añade automáticamente — no lo repitas.
9. SEGURIDAD: nunca personas reales identificables, ni menores, ni claims médicos absolutos ("cura", "elimina"). El guion puede prometer beneficios razonables estilo testimonio.
10. PROMPTS EN INGLÉS (los modelos generan mejor), GUION HABLADO en el idioma del anuncio original.

Responde ÚNICAMENTE con este JSON (sin markdown, sin preámbulo):

{
  "variant_label": "<etiqueta corta en español: quién/dónde, ej. 'Mamá joven en su cocina'>",
  "image_prompt": "<prompt en inglés para Nano Banana Pro: persona (edad, vibe, ropa casual), escenario real, qué hace con el producto, encuadre selfie/frontal 9:16. Si hay referencias: 'holding the exact same product as in the reference image'. SIN bloque iPhone (se añade solo).>",
  "motion_prompt": "<prompt en inglés para Seedance: la acción continua del clip + al final: She/He says in [idioma]: \\"<guion hablado exacto>\\". SIN bloque de movimiento (se añade solo).>",
  "spoken_script": "<el guion hablado exacto, en el idioma del anuncio original>",
  "duration_seconds": <6-12, el mínimo cómodo para el guion>,
  "generate_audio": true,
  "rationale": "<1 frase en español: qué conserva del ganador y qué cambia esta variante>"
}`;

export interface GenerationPlan {
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
    // imagen estática:
    copy_analysis: analysis.copy_analysis,
    visual_breakdown: pick(analysis.visual_breakdown, [
      'format', 'layout', 'focal_point', 'imagery_style', 'product_presentation',
    ]),
    replication_variants: (analysis.replication as Record<string, unknown> | undefined)?.variants,
  };
}

/**
 * Genera el plan de clonación con Claude a partir del análisis + marca + variante.
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
      ? 'SÍ hay fotos del producto real — el prompt debe anclar el producto a la referencia.'
      : 'NO hay fotos del producto — describe el producto por el análisis, sin inventar textos del empaque.'
  }

VARIANTE SOLICITADA: ${
    opts.variantNumber === null
      ? 'Recreación cercana al original pero con una persona/creador nuevo (misma estructura, mismo escenario general).'
      : `Usa la variante #${opts.variantNumber} del análisis (su escenario/persona) como base.`
  }

Genera el plan JSON.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: PLANNER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('El planificador no respondió');
  }

  const plan = parseJsonFromText(textBlock.text) as GenerationPlan;

  // Saneo defensivo
  plan.duration_seconds = Math.max(4, Math.min(12, Math.round(plan.duration_seconds || 8)));
  plan.generate_audio = plan.generate_audio !== false;
  if (!plan.image_prompt || !plan.motion_prompt) {
    throw new Error('Plan incompleto del planificador');
  }
  return plan;
}

/** Prompt final de imagen = descripción del plan + bloque fijo de realismo. */
export function finalImagePrompt(plan: GenerationPlan): string {
  return `${plan.image_prompt}\n\nAspect ratio 9:16 vertical.\n\n${IPHONE_REALISM_BLOCK}`;
}

/** Prompt final de video = acción + diálogo + bloque fijo de movimiento. */
export function finalMotionPrompt(plan: GenerationPlan): string {
  return `${plan.motion_prompt}\n\n${MOTION_REALISM_BLOCK}`;
}
