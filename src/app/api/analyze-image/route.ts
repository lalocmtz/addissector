import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { IMAGE_DISSECTOR_SYSTEM_PROMPT } from '@/lib/prompts';
import { anthropic, anthropicApiKey, MODEL, cachedSystem } from '@/lib/ai';
import { getSessionUser } from '@/lib/supabase-server';
import { ensureImageInterpretation } from '@/lib/interpretation';

export const maxDuration = 300;

interface ImageMeta {
  width: number;
  height: number;
  aspectRatio: string;
}

interface AnalyzeImageRequestBody {
  image: string; // data URL
  imageMeta?: ImageMeta;
}

function stripDataUrlPrefix(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return dataUrl;
  return dataUrl.slice(commaIndex + 1);
}

function extractMediaType(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;]+);/);
  return match ? match[1] : 'image/jpeg';
}

/**
 * Repara un JSON truncado (respuesta cortada por max_tokens): cierra strings,
 * elimina la última propiedad incompleta y balancea llaves/corchetes.
 */
function repairTruncatedJson(raw: string): unknown {
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('Sin JSON en la respuesta');
  let s = raw.slice(start);
  const scan = (str: string) => {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (const ch of str) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') stack.pop();
    }
    return { stack, inString };
  };
  for (let attempt = 0; attempt < 40; attempt++) {
    const { stack, inString } = scan(s);
    let candidate = s;
    if (inString) candidate += '"';
    for (let i = stack.length - 1; i >= 0; i--) {
      candidate += stack[i] === '{' ? '}' : ']';
    }
    try {
      return JSON.parse(candidate);
    } catch {
      const cut = Math.max(s.lastIndexOf(','), s.lastIndexOf('{'), s.lastIndexOf('['));
      if (cut <= 0) break;
      s = s.slice(0, cut);
    }
  }
  throw new Error('Could not parse JSON from response');
}

function parseJsonFromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch { /* fall through */ }
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch { /* fall through */ }
    }
    // Último recurso: reparar truncamiento (respuesta cortada por max_tokens).
    return repairTruncatedJson(text);
  }
}

/**
 * Maps alternative field names and fills required blocks with safe defaults so
 * the UI never crashes on a partial model response.
 */
function normalizeImageAnalysis(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...raw };

  const fieldMap: Record<string, string> = {
    visual: 'visual_breakdown',
    visualBreakdown: 'visual_breakdown',
    desglose_visual: 'visual_breakdown',
    copy: 'copy_analysis',
    copyAnalysis: 'copy_analysis',
    analisis_copy: 'copy_analysis',
    scorecard: 'dashboard',
    scores: 'dashboard',
    psychology: 'psychological_analysis',
    psychologicalAnalysis: 'psychological_analysis',
    psicologia: 'psychological_analysis',
    analisis_psicologico: 'psychological_analysis',
    prompts: 'replication',
    replication_prompts: 'replication',
    replicacion: 'replication',
  };

  for (const [alt, canonical] of Object.entries(fieldMap)) {
    if (raw[alt] !== undefined && raw[canonical] === undefined) {
      result[canonical] = raw[alt];
      delete result[alt];
    }
  }

  if (!result.visual_breakdown) {
    result.visual_breakdown = {
      format: '', layout: '', focal_point: '', visual_hierarchy: [],
      color_palette: [], color_psychology: '', typography: '',
      product_presentation: '', imagery_style: '', branding_elements: [],
    };
  }
  if (!result.copy_analysis) {
    result.copy_analysis = {
      headline: '', subheadline: null, body_text: null, cta_text: null,
      offer_badges: [], all_text_verbatim: [], copy_angle: '', copy_framework: '',
    };
  }
  if (!result.dashboard) {
    result.dashboard = {
      stopping_power_score: 0, clarity_score: 0, offer_strength_score: 0,
      brand_visibility_score: 0, overall_score: 0, scorecard_reasoning: '',
    };
  }
  if (!result.psychological_analysis) {
    result.psychological_analysis = {
      scroll_stop: { mechanism: '', primary_trigger: '', strength_score: 0, reasoning: '' },
      why_it_converts: '',
      buyer_psychology: { core_desire: '', core_pain: '', identity_shift: '', objections_handled: [] },
      persuasion_triggers: [],
      cognitive_biases: [],
      emotional_journey: [],
      awareness_level: '',
      market_sophistication: '',
      target_avatar: { who: '', mindset: '', resonance_reason: '' },
      math_breakdown: {
        hook_duration_seconds: 0, ideal_hook_window: '', pacing_score: 0,
        retention_risk_points: [], cta_timing: '', thumbstop_estimate: '',
      },
    };
  }
  if (!result.replication) {
    result.replication = {
      faithful_recreation_prompt: '', variants: [], design_notes: '',
    };
  }
  if (typeof result.product !== 'string') result.product = '';
  if (typeof result.ad_type !== 'string') result.ad_type = '';

  return result;
}

export async function POST(request: NextRequest) {
  try {
    if (!anthropicApiKey()) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body: AnalyzeImageRequestBody = await request.json();
    if (!body.image || typeof body.image !== 'string') {
      return NextResponse.json({ error: 'No image provided for analysis' }, { status: 400 });
    }

    const meta = body.imageMeta ?? { width: 0, height: 0, aspectRatio: '' };

    const textPreamble = `## IMAGE METADATA
Dimensions: ${meta.width ?? 0}x${meta.height ?? 0}
Aspect: ${meta.aspectRatio ?? ''}

## INSTRUCTIONS
Analiza el siguiente anuncio estático (imagen). Devuelve tu análisis como un objeto JSON que coincida EXACTAMENTE con el esquema de tu system prompt. Incluye los 5 bloques: visual_breakdown, copy_analysis, dashboard (scorecard), psychological_analysis (el más profundo y accionable) y replication.`;

    const base64Data = stripDataUrlPrefix(body.image);
    const mediaType = extractMediaType(body.image) as
      | 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const contentArray: Anthropic.ContentBlockParam[] = [
      { type: 'text', text: textPreamble },
      {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64Data },
      },
    ];

    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 12000,
      system: cachedSystem(IMAGE_DISSECTOR_SYSTEM_PROMPT),
      messages: [{ role: 'user', content: contentArray }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No text response from analysis model' }, { status: 500 });
    }

    console.log('[AdDissector:image] stop_reason:', response.stop_reason);
    console.log('[AdDissector:image] usage:', JSON.stringify(response.usage));

    const rawAnalysis = parseJsonFromText(textBlock.text) as Record<string, unknown>;
    console.log('[AdDissector:image] Response keys:', Object.keys(rawAnalysis));

    const analysis = ensureImageInterpretation(normalizeImageAnalysis(rawAnalysis));

    return NextResponse.json(analysis);
  } catch (error) {
    console.error('Image analysis error:', error);

    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Anthropic API error: ${error.message}` },
        { status: error.status || 500 }
      );
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
