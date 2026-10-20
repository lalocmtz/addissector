// =============================================================================
// POST /api/estaticos/analizar — el adaptador de estáticos, paso 1.
//   { brandId, referenciaUrl, fotos?: string[], nota?, adId? }
// Claude mira la referencia (de otra marca, de Trend Track o un ganador) y la
// desarma con las reglas del Director de estáticos: formato, qué para el
// scroll, esqueleto, mecanismo, cómo encaja en la cuenta, y 3 variantes (A
// control, B otro avatar/objeción, C otra ejecución) con copy literal y el
// prompt de 8 bloques para Kie.ai. Las imágenes se generan en /generar.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { contextoCreativo, contextoEnTexto } from '@/lib/contexto-creativo';
import { HoyError } from '@/lib/hoy';
import { DIRECTOR_ESTATICOS, HECHOS_FEEL_INK } from '@/lib/prompts-creativos';
import { pedirJson, imagen, str, strs, enumDe, obj, arr, type Bloque } from '@/lib/ai-json';

export const runtime = 'nodejs';
export const maxDuration = 300;

const ESQUEMA = {
  properties: {
    analisis: obj({
      formato: str('Arquetipo (I01-I10, F01-F20) o "formato nuevo" con su esqueleto.'),
      para_el_scroll: str('Qué detiene el pulgar y la idea visual de 1 segundo.'),
      esqueleto: strs('Slots numerados en orden de lectura (1 headline, 2 subheadline… 8 foto principal, 9 prueba).'),
      mecanismo: str('Tipo de gancho y razón para creer.'),
      etapa: enumDe(['TOF', 'MOF', 'BOF']),
      estilo: enumDe(['limpio', 'nativo']),
      hipotesis: str('Lo único que prueba.'),
    }),
    encaje: obj({
      tipo: enumDe(['iteracion', 'concepto']),
      origen_ad_id: str('ad_id del ganador si esto lo itera; "" si no.'),
      capa: enumDe(['mensaje', 'mecanismo', 'avatar', 'educacion', 'oferta', 'visual', '']),
      persona_id: str('id del avatar de la lista o "".'),
      avatar: str(),
      trabajo: enumDe(['atencion', 'valor', 'confianza']),
      necesidad: str('Qué necesidad de la cuenta cubre.'),
      porque: str('Por qué vale la pena adaptarla para Feel Ink (o por qué no).'),
    }),
    adaptacion: obj({
      viaja: strs('Lo que se conserva de la referencia (esqueleto, jerarquía, mecanismo).'),
      se_reemplaza: strs('Lo que NO viaja y con qué se sustituye (reseñas, cifras, caras, marcas).'),
    }),
    concepto: str('El concepto adaptado en una frase.'),
    concepto_corto: str('2-3 palabras para el nombre del conjunto.'),
    variantes: arr(obj({
      etiqueta: enumDe(['A', 'B', 'C']),
      que_cambia: str('A control; B otro avatar u objeción; C otra ejecución.'),
      copy_en_imagen: strs('Cada texto literal que va en la imagen, en orden.'),
      prompt: str('Prompt completo de 8 bloques ([1] FORMATO … [8] NEGATIVE) en español, copy entre «comillas».'),
      fotos_usar: { type: 'array', items: { type: 'integer' }, description: 'Índices (desde 0) de las fotos de producto que debe usar.' },
    }), 3, 3),
    textos: strs('2 textos principales para Meta, muy distintos.', 2, 2),
    titulares: strs('2 titulares de ≤6 palabras.', 2, 2),
    bloqueos: strs('[DATO REAL] que falta para que la pieza no invente nada.'),
  },
  required: ['analisis', 'encaje', 'adaptacion', 'concepto', 'concepto_corto', 'variantes', 'textos', 'titulares', 'bloqueos'],
};

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { brandId?: string; referenciaUrl?: string; fotos?: string[]; nota?: string; adId?: string };
  if (!b.brandId || !/^https?:\/\//.test(b.referenciaUrl ?? '')) return NextResponse.json({ error: 'Falta la imagen de referencia' }, { status: 400 });
  const fotos = (b.fotos ?? []).filter((u) => /^https?:\/\//.test(u)).slice(0, 6);

  let ctx;
  try {
    ctx = await contextoCreativo(getSupabase(), b.brandId, user.id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: e instanceof HoyError ? e.status : 500 });
  }

  const contenido: Bloque[] = [
    { type: 'text', text: 'REFERENCIA a adaptar (no es de Feel Ink salvo que se diga):' },
    imagen(b.referenciaUrl!),
  ];
  fotos.forEach((u, i) => { contenido.push({ type: 'text', text: `FOTO REAL DE PRODUCTO #${i}:` }, imagen(u)); });
  contenido.push({ type: 'text', text: `${b.nota ? `Nota del usuario: "${b.nota.slice(0, 600)}"\n` : ''}${b.adId ? `Es una iteración del anuncio ad_id ${b.adId}.\n` : ''}
Analiza la referencia y adáptala a Feel Ink en 3 variantes (A control, B otro avatar u objeción, C otra ejecución).
- La imagen se generará con un modelo de imagen que recibe SOLO las fotos reales de producto (#0…#${Math.max(0, fotos.length - 1)}) y tu prompt. ${fotos.length ? 'Indica en cada variante qué fotos usar y escribe en [3] PRODUCTO que use exactamente el diseño de la foto adjunta.' : 'No hay fotos de producto: dilo en bloqueos y escribe el prompt para que el diseño se reemplace después.'}
- Describe con palabras la composición de la referencia; nunca pidas copiar su marca, caras, reseñas o cifras.
- Formato 9:16 con el contenido crítico en el cuadrado central.

CONTEXTO DE LA CUENTA
${contextoEnTexto(ctx)}` });

  try {
    const out = await pedirJson<Record<string, unknown>>({
      system: `${DIRECTOR_ESTATICOS}\n\n${HECHOS_FEEL_INK}`,
      contenido,
      nombre: 'entregar_adaptacion',
      descripcion: 'Entrega el análisis de la referencia y las 3 variantes para Feel Ink.',
      esquema: ESQUEMA,
      maxTokens: 9000,
    });
    return NextResponse.json({ ...out, fotos });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo analizar' }, { status: 502 });
  }
}
