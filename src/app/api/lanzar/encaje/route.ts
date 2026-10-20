// =============================================================================
// POST /api/lanzar/encaje — "Tengo una idea". { brandId, texto, imagenUrl? }
// Dice dónde encaja la idea en la cuenta: qué puerta (adaptar una referencia,
// guiones, iterar un ganador), si es iteración o concepto, qué capa mueve, para
// qué avatar y trabajo, qué necesidad cubre, y el siguiente paso.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { contextoCreativo, contextoEnTexto } from '@/lib/contexto-creativo';
import { HoyError } from '@/lib/hoy';
import { HECHOS_FEEL_INK } from '@/lib/prompts-creativos';
import { pedirJson, imagen, str, enumDe, type Bloque } from '@/lib/ai-json';

export const runtime = 'nodejs';
export const maxDuration = 120;

const SISTEMA = `Eres el estratega creativo de la cuenta de Meta de Feel Ink. Recibes una idea suelta del dueño y dices, en corto y sin adornos, dónde encaja en el sistema:
- Un lote = 1 concepto × 1 avatar × 1 trabajo (atención, valor o confianza), con 3 a 6 ejecuciones.
- Iteración = cambiar UNA capa de un ganador (mensaje, mecanismo, avatar, educación, oferta, visual). Concepto = idea nueva.
- Puertas: "adaptar" (es un estático o una referencia visual), "guiones" (es video para grabar), "iterar" (sale de un ganador concreto).
- Si la idea repite un lote reciente, choca con las reglas de la marca o no cubre ninguna necesidad, dilo con honestidad y propone cómo rescatarla.
${HECHOS_FEEL_INK}`;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { brandId?: string; texto?: string; imagenUrl?: string };
  const texto = (b.texto ?? '').trim();
  if (!b.brandId || (!texto && !b.imagenUrl)) return NextResponse.json({ error: 'Escribe la idea' }, { status: 400 });
  let ctx;
  try {
    ctx = await contextoCreativo(getSupabase(), b.brandId, user.id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: e instanceof HoyError ? e.status : 500 });
  }
  const contenido: Bloque[] = [];
  if (b.imagenUrl && /^https?:\/\//.test(b.imagenUrl)) contenido.push({ type: 'text', text: 'Imagen que acompaña la idea:' }, imagen(b.imagenUrl));
  contenido.push({ type: 'text', text: `IDEA: "${texto.slice(0, 1500)}"\n\nCONTEXTO DE LA CUENTA\n${contextoEnTexto(ctx)}` });
  try {
    const out = await pedirJson<Record<string, unknown>>({
      system: SISTEMA,
      contenido,
      nombre: 'encajar_idea',
      descripcion: 'Dice dónde encaja la idea en la cuenta.',
      esquema: {
        properties: {
          veredicto: enumDe(['lanzala', 'ajustala', 'despues'], 'lanzala = encaja ya; ajustala = sirve con un cambio; despues = no es prioridad ahora.'),
          puerta: enumDe(['adaptar', 'guiones', 'iterar']),
          tipo: enumDe(['iteracion', 'concepto']),
          origen_ad_id: str('ad_id del ganador si itera; "".'),
          capa: enumDe(['mensaje', 'mecanismo', 'avatar', 'educacion', 'oferta', 'visual', '']),
          persona_id: str('id del avatar o "".'),
          avatar: str(),
          trabajo: enumDe(['atencion', 'valor', 'confianza']),
          concepto: str('La idea reescrita como concepto en una frase.'),
          necesidad: str('Qué necesidad de la cuenta cubre (o "ninguna").'),
          como_encaja: str('2-3 frases: dónde cae en el sistema y por qué.'),
          ajuste: str('El cambio que la mejora; "" si no hace falta.'),
          siguiente_paso: str('Qué hacer ahora en una línea.'),
        },
        required: ['veredicto', 'puerta', 'tipo', 'origen_ad_id', 'capa', 'persona_id', 'avatar', 'trabajo', 'concepto', 'necesidad', 'como_encaja', 'ajuste', 'siguiente_paso'],
      },
      maxTokens: 1500,
    });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo' }, { status: 502 });
  }
}
