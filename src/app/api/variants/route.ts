import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { VARIANT_GENERATOR_PROMPT } from '@/lib/prompts';

export const maxDuration = 300;

interface BrandContext {
  name?: string;
  tone?: string | null;
  palette?: string | null;
  product?: string | null;
}

interface VariantsRequestBody {
  analysisJson: Record<string, unknown>;
  brandContext?: BrandContext | null;
}

function brandContextBlock(brand: BrandContext | null | undefined): string {
  if (!brand) return '';
  const lines = [
    brand.name ? `- Marca: ${brand.name}` : '',
    brand.product ? `- Producto/oferta: ${brand.product}` : '',
    brand.tone ? `- Tono de la marca: ${brand.tone}` : '',
    brand.palette ? `- Paleta/estética: ${brand.palette}` : '',
  ].filter(Boolean);
  if (lines.length === 0) return '';
  return `\n\nCONTEXTO DE LA MARCA (las variantes deben respetarlo):\n${lines.join('\n')}`;
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

    const body: VariantsRequestBody = await request.json();
    if (!body.analysisJson) {
      return NextResponse.json({ error: 'No analysis data provided' }, { status: 400 });
    }

    const userMessage = `Genera 3 nuevas variantes de guion Y 2 nuevas variantes de Seedance por segmento basadas en este analisis:

${JSON.stringify(body.analysisJson, null, 2)}

Las variantes deben ser significativamente diferentes del original y entre si.${brandContextBlock(body.brandContext)}`;

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: VARIANT_GENERATOR_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No text response from variant generation model' }, { status: 500 });
    }

    const variants = parseJsonFromText(textBlock.text);
    return NextResponse.json(variants);
  } catch (error) {
    console.error('Variant generation error:', error);
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Anthropic API error: ${error.message}` }, { status: error.status || 500 });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
