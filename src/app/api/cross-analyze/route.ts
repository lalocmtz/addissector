import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { CROSS_ANALYSIS_PROMPT } from '@/lib/prompts';

export const maxDuration = 120;

interface CrossAnalyzeRequestBody {
  analyses: Record<string, unknown>[];
}

function parseJsonFromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try { return JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch { /* fall through */ }
    }
    throw new Error('Could not parse JSON from response');
  }
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.MY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 });
    }

    const body: CrossAnalyzeRequestBody = await request.json();
    if (!body.analyses || !Array.isArray(body.analyses) || body.analyses.length < 2) {
      return NextResponse.json({ error: 'At least 2 analyses required for cross-analysis' }, { status: 400 });
    }

    const userMessage = `Analiza los patrones comunes entre estos ${body.analyses.length} videos ganadores y genera una formula maestra:

${JSON.stringify(body.analyses, null, 2)}

Identifica patrones, crea la formula maestra, un guion maestro con 3 variantes, y prompts de Seedance maestros.`;

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 12000,
      system: CROSS_ANALYSIS_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No text response from cross-analysis model' }, { status: 500 });
    }

    const crossAnalysis = parseJsonFromText(textBlock.text);
    return NextResponse.json(crossAnalysis);
  } catch (error) {
    console.error('Cross-analysis error:', error);
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Anthropic API error: ${error.message}` }, { status: error.status || 500 });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
