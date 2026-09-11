// =============================================================================
// /api/chat — Chat del Cerebro de la marca.
// GET  ?brand=  → historial del hilo
// POST {brandId, message} → respuesta de Claude con TODO el contexto de la
//       marca (cerebro + ganadores + guiones + aprendizajes + research)
// DELETE ?brand= → limpiar hilo
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { anthropic, anthropicApiKey, MODEL } from '@/lib/ai';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { buildBrandContext } from '@/lib/brand-context';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** Tope del contexto extra que manda el Canvas (POST.extra). */
const MAX_EXTRA = 12_000;
/** Tope de imágenes del Canvas que se mandan a mirar. */
const MAX_IMAGES = 6;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const sb = getSupabase();
  const { data, error } = await sb
    .from('chat_messages')
    .select('id,role,content,created_at')
    .eq('brand_id', brandId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const sb = getSupabase();
  await sb.from('chat_messages').delete().eq('brand_id', brandId).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  if (!anthropicApiKey()) return NextResponse.json({ error: 'Anthropic API key is not configured' }, { status: 500 });

  const { brandId, message, extra, images } = (await request.json()) as { brandId: string; message: string; extra?: string; images?: string[] };
  if (!brandId || !message?.trim()) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  // Contexto opcional del Canvas (lo que el usuario está planeando ahora), acotado.
  const canvasExtra = typeof extra === 'string' && extra.trim() ? extra.trim().slice(0, MAX_EXTRA) : '';
  // Referencias visuales del Canvas: Claude las mira junto con la pregunta.
  const canvasImages = (Array.isArray(images) ? images : [])
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, MAX_IMAGES);

  const sb = getSupabase();

  // Historial reciente (para continuidad del hilo)
  const { data: history } = await sb
    .from('chat_messages')
    .select('role,content')
    .eq('brand_id', brandId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  const recent = (history ?? []).reverse();

  const context = await buildBrandContext(sb, user.id, brandId);

  const system = `Eres el estratega creativo del equipo de esta marca. Tienes acceso al contexto completo abajo: el cerebro de la marca, los anuncios que están funcionando AHORA con sus números reales de Meta (hook rate, retención, ROAS), los guiones extraídos de los ganadores, los que fallaron, el motor estructurado (personas, ángulos, conceptos) y los aprendizajes acumulados.

Reglas:
- Cuando te pida guiones o ideas nuevas, básate en los ángulos y estructuras de los GANADORES actuales; cita los números que lo justifican ("el hook de X detiene al 28%...").
- Sé directo y accionable: qué está funcionando, qué cambiar, qué probar. Nada de relleno.
- Si detectas un patrón nuevo digno de recordarse, termina con una línea "💡 Aprendizaje sugerido: ..." (una sola frase).
- Responde siempre en español.
- Si te adjuntan imágenes, son referencias visuales que el usuario pegó en su canvas: descríbelas en términos de creativo (formato, jerarquía, hook visual, oferta) y úsalas para proponer.

${context}${canvasExtra ? `\n\n## CONTEXTO DEL CANVAS (lo que el usuario está planeando ahora)\n${canvasExtra}` : ''}`;

  const client = anthropic();
  const userContent: Anthropic.ContentBlockParam[] = [
    ...canvasImages.map((url): Anthropic.ContentBlockParam => ({ type: 'image', source: { type: 'url', url } })),
    { type: 'text', text: message.trim() },
  ];
  const messages: Anthropic.MessageParam[] = [
    ...recent.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: canvasImages.length > 0 ? userContent : message.trim() },
  ];

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system,
      messages,
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    await sb.from('chat_messages').insert([
      { user_id: user.id, brand_id: brandId, role: 'user', content: message.trim() },
      { user_id: user.id, brand_id: brandId, role: 'assistant', content: text },
    ]);

    return NextResponse.json({ reply: text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error llamando a Claude';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
