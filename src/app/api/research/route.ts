// =============================================================================
// POST /api/research — Research creativo con búsqueda web.
// Busca reseñas, dudas y ángulos nuevos y los cruza contra lo que YA funciona
// en la cuenta (contexto de marca completo).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { buildBrandContext } from '@/lib/brand-context';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MODEL = 'claude-sonnet-4-6';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const apiKey = process.env.MY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Falta la API key de Anthropic en Vercel' }, { status: 500 });

  const { brandId, query } = (await request.json()) as { brandId: string; query: string };
  if (!brandId || !query?.trim()) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });

  const sb = getSupabase();
  const context = await buildBrandContext(sb, user.id, brandId);

  const system = `Eres un investigador creativo para anuncios de Meta. Tu trabajo: buscar en la web reseñas reales, dudas frecuentes, quejas, lenguaje del cliente y ángulos de competidores, y CRUZARLOS contra lo que ya funciona en la cuenta (contexto abajo).

Entrega SIEMPRE en este formato:
1. **Hallazgos** — lo que encontraste (citas textuales de clientes cuando existan).
2. **Ángulos nuevos propuestos** — cada uno con: nombre corto, el insight que lo sustenta, y por qué puede funcionar dado lo que ya funciona en la cuenta (cita números del contexto).
3. **Qué NO probar** — ángulos que chocan con lo aprendido.

Responde en español. Sé concreto: los ángulos deben poder convertirse en un guion mañana.

${context}`;

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: query.trim() }],
      tools: [
        {
          type: 'web_search_20250305' as const,
          name: 'web_search' as const,
          max_uses: 6,
        },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return NextResponse.json({ result: text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error en research';
    // Fallback sin web search si la organización no lo tiene habilitado
    if (/web_search|tool/i.test(msg)) {
      try {
        const client2 = new Anthropic({ apiKey });
        const r2 = await client2.messages.create({
          model: MODEL,
          max_tokens: 4000,
          system,
          messages: [{ role: 'user', content: `${query.trim()}\n\n(No hay búsqueda web disponible: usa tu conocimiento del mercado y el contexto de la cuenta.)` }],
        });
        const t2 = r2.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');
        return NextResponse.json({ result: t2, webSearch: false });
      } catch (err2) {
        const m2 = err2 instanceof Error ? err2.message : 'Error en research';
        return NextResponse.json({ error: m2 }, { status: 500 });
      }
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
