import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { DISSECTOR_SYSTEM_PROMPT } from '@/lib/prompts';
import { gateAnalysis, recordAnalysisUsage } from '@/lib/usage';
import { ensureVideoInterpretation } from '@/lib/interpretation';

export const maxDuration = 300;

const MAX_FRAMES = 12;

interface FrameData {
  timestamp: string;
  dataUrl: string;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptData {
  transcript: string;
  segments: TranscriptSegment[];
}

interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  aspectRatio: string;
}

interface AnalyzeRequestBody {
  frames: FrameData[];
  transcript: TranscriptData;
  videoMeta: VideoMeta;
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
    throw new Error('Could not parse JSON from response');
  }
}

/**
 * Normalizes Claude's response to match expected field names.
 */
function normalizeAnalysis(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...raw };

  // Map alternative field names to canonical ones
  const fieldMap: Record<string, string> = {
    analysis: 'structural_analysis',
    structure: 'structural_analysis',
    structuralAnalysis: 'structural_analysis',
    script: 'original_script',
    originalScript: 'original_script',
    guion: 'original_script',
    guion_original: 'original_script',
    variants: 'script_variants',
    scriptVariants: 'script_variants',
    variantes: 'script_variants',
    seedance: 'seedance_segments',
    seedanceSegments: 'seedance_segments',
    segments: 'seedance_segments',
    prompts_seedance: 'seedance_segments',
    plan: 'replication_plan',
    replicationPlan: 'replication_plan',
    plan_replicacion: 'replication_plan',
    visual_dashboard: 'dashboard',
    dashboardAnalysis: 'dashboard',
    dashboard_analysis: 'dashboard',
    analisis_visual: 'dashboard',
    psychology: 'psychological_analysis',
    psychologicalAnalysis: 'psychological_analysis',
    psicologia: 'psychological_analysis',
    analisis_psicologico: 'psychological_analysis',
    deep_psychology: 'psychological_analysis',
  };

  for (const [alt, canonical] of Object.entries(fieldMap)) {
    if (raw[alt] !== undefined && raw[canonical] === undefined) {
      result[canonical] = raw[alt];
      delete result[alt];
    }
  }

  // Ensure required top-level keys exist
  if (!result.structural_analysis) {
    result.structural_analysis = {
      video_type: '', visual_context: '', product: '',
      total_duration_seconds: 0, seedance_segments_count: 0,
      transcription: [], content_summary: '',
      winning_structure: { hook: '', development: '', cta: '', persuasion_elements: [], tone: '', format: '' },
    };
  }
  if (!result.dashboard) {
    result.dashboard = {
      hook: {
        type: '', duration_seconds: 0, effectiveness_score: 0,
        effectiveness_reasoning: '', scroll_stop_mechanism: '',
        frame_descriptions: [], dominant_colors: [],
        text_overlay: null, audio_tone: '', music_type: '',
      },
      visual_frames: [],
      patterns: {
        persuasion_framework: '', retention_techniques: [],
        power_words: [], emotional_arc: '', pacing_rhythm: '',
        music_strategy: '', ugc_markers: [],
      },
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
  if (!result.original_script) result.original_script = '';
  if (!result.script_variants) result.script_variants = [];
  if (!result.seedance_segments) result.seedance_segments = [];
  if (!result.replication_plan) {
    result.replication_plan = {
      seedance_count: 0, segments_summary: [],
      elevenlabs_script: '', audio_duration_estimate: 0,
      voice_tone: '', editing_notes: '',
    };
  }

  return result;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.MY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 });
    }

    // Gating por plan: sesión + límite mensual de análisis.
    const gate = await gateAnalysis();
    if (!gate.ok) return gate.response;

    const body: AnalyzeRequestBody = await request.json();

    if (!body.frames || !Array.isArray(body.frames) || body.frames.length === 0) {
      return NextResponse.json({ error: 'No frames provided for analysis' }, { status: 400 });
    }
    if (!body.transcript) {
      return NextResponse.json({ error: 'No transcript provided' }, { status: 400 });
    }

    const frames = body.frames.slice(0, MAX_FRAMES);
    const { transcript, videoMeta } = body;

    const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
    const meta = videoMeta ?? { duration: 0, width: 0, height: 0, aspectRatio: '' };

    const segmentsText = segments
      .map((seg) => `[${(seg.start ?? 0).toFixed(1)}s - ${(seg.end ?? 0).toFixed(1)}s] ${seg.text ?? ''}`)
      .join('\n');

    const textPreamble = `## VIDEO METADATA
Duration: ${(meta.duration ?? 0).toFixed(1)}s
Format: ${meta.width ?? 0}x${meta.height ?? 0}
Aspect: ${meta.aspectRatio ?? ''}

## TRANSCRIPT
${transcript.transcript ?? ''}

Segments:
${segmentsText}

## INSTRUCTIONS
Analyze the following video frames along with the transcript above. Return your analysis as a JSON object matching the exact schema specified in your system prompt. Include ALL 6 blocks: structural_analysis, dashboard, psychological_analysis (el más profundo y accionable), original_script + script_variants, seedance_segments, replication_plan.`;

    const contentArray: Anthropic.ContentBlockParam[] = [
      { type: 'text', text: textPreamble },
    ];

    for (const frame of frames) {
      const base64Data = stripDataUrlPrefix(frame.dataUrl);
      const mediaType = extractMediaType(frame.dataUrl) as
        | 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

      contentArray.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: base64Data },
      });
      contentArray.push({
        type: 'text',
        text: `Frame at timestamp ${frame.timestamp}`,
      });
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: DISSECTOR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contentArray }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No text response from analysis model' }, { status: 500 });
    }

    console.log('[AdDissector] stop_reason:', response.stop_reason);
    console.log('[AdDissector] usage:', JSON.stringify(response.usage));

    const rawAnalysis = parseJsonFromText(textBlock.text) as Record<string, unknown>;
    console.log('[AdDissector] Response keys:', Object.keys(rawAnalysis));

    const analysis = ensureVideoInterpretation(normalizeAnalysis(rawAnalysis));

    // Cuenta el análisis solo cuando fue exitoso.
    await recordAnalysisUsage(gate.userId);

    return NextResponse.json(analysis);
  } catch (error) {
    console.error('Analysis error:', error);

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
