// =============================================================================
// POST /api/guiones — guiones para grabar, con justificación.
//   { brandId, talento: founder|modelo|creador, cantidad (1-6),
//     enfoque: auto|iterar|explorar, personaId?, adId?, tema? }
// Lee la cuenta (ganadores con su transcripción y veredicto, avatares, lotes,
// necesidades) y escribe con las reglas del Guionista (src/lib/prompts-creativos).
// Cada guion trae 3 hooks sobre el mismo cuerpo = un lote de 3 anuncios.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { contextoCreativo, contextoEnTexto } from '@/lib/contexto-creativo';
import { HoyError } from '@/lib/hoy';
import { GUIONISTA, HECHOS_FEEL_INK, TALENTOS, type Talento } from '@/lib/prompts-creativos';
import { pedirJson, str, strs, enumDe, obj, arr } from '@/lib/ai-json';

export const runtime = 'nodejs';
export const maxDuration = 300;

const CAPAS = ['mensaje', 'mecanismo', 'avatar', 'educacion', 'oferta', 'visual'];

const ESQUEMA = {
  properties: {
    lectura: str('2-3 frases: qué está pidiendo la cuenta y cómo repartiste iterar vs explorar.'),
    guiones: arr(obj({
      titulo: str('Nombre corto del guion.'),
      tipo: enumDe(['iteracion', 'concepto']),
      origen_ad_id: str('ad_id del ganador que se itera; "" si es concepto nuevo.'),
      origen_nombre: str('Nombre del anuncio ganador; "" si es nuevo.'),
      capa: enumDe([...CAPAS, ''], 'La única capa que cambia (solo iteración).'),
      persona_id: str('id del avatar de la lista; "" si ninguno encaja.'),
      avatar: str('Nombre corto del avatar + su conducta en 4-8 palabras.'),
      angulo: str(),
      objecion: str('La objeción que ataca.'),
      trabajo: enumDe(['atencion', 'valor', 'confianza'], 'Anillo: el trabajo del anuncio.'),
      concepto: str('El concepto en una frase.'),
      concepto_corto: str('2-3 palabras para el nombre del conjunto (ej. "vs calcomania").'),
      formato: str('Código y nombre del formato (V01-V04) o el más cercano.'),
      duracion_seg: { type: 'number' },
      hooks: arr(obj({ dice: str('Lo que se dice (0-3 s).'), se_ve: str('Lo que se ve en el s0.'), texto_pantalla: str('Texto grande en pantalla.') }), 3, 3),
      cuerpo: arr(obj({ seg: str('ej. 3-7'), bloque: str('problema, mecanismo, prueba, CTA…'), dice: str(), se_ve: str('Grabable: persona, lugar, acción.') }), 3, 12),
      cta: str(),
      textos: strs('2 textos principales para Meta, muy distintos.', 2, 2),
      titulares: strs('2 titulares de ≤6 palabras.', 2, 2),
      notas_toma: str('Tono, energía, vestuario, props, cuántas tomas.'),
      justificacion: str('Por qué este guion ahora: qué necesidad cubre, qué capa mueve y por qué este formato.'),
      evidencia: str('El dato de la cuenta en que se apoya (ganador, ROAS, hook rate, objeción).'),
      metrica: str('La métrica que lo valida o lo mata a los 7 días.'),
      alertas: strs('Datos reales que faltan ([DATO REAL]); vacío si nada.'),
    })),
  },
  required: ['lectura', 'guiones'],
};

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { brandId?: string; talento?: string; cantidad?: number; enfoque?: string; personaId?: string; adId?: string; tema?: string; trabajo?: string };
  if (!b.brandId) return NextResponse.json({ error: 'Falta brandId' }, { status: 400 });
  const talento: Talento = (['founder', 'modelo', 'creador'] as const).includes(b.talento as Talento) ? (b.talento as Talento) : 'creador';
  const cantidad = Math.max(1, Math.min(6, Math.round(Number(b.cantidad) || 3)));
  const enfoque = ['iterar', 'explorar'].includes(b.enfoque ?? '') ? b.enfoque! : 'auto';

  let ctx;
  try {
    ctx = await contextoCreativo(getSupabase(), b.brandId, user.id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: e instanceof HoyError ? e.status : 500 });
  }

  const reparto = enfoque === 'iterar'
    ? 'Todos los guiones son ITERACIONES de ganadores (cambia una sola capa, conserva la receta).'
    : enfoque === 'explorar'
      ? 'Todos los guiones son CONCEPTOS NUEVOS alrededor de los avatares que ya funcionan o de avatares sin explorar.'
      : `Reparte: aprox. 60-70% iteraciones de ganadores y 30-40% conceptos nuevos (mínimo 1 de cada si cantidad ≥ 2). Si no hay ganadores, todo es concepto nuevo y dilo.`;
  const foco = [
    b.adId ? `Itera específicamente el anuncio ad_id ${b.adId}.` : '',
    b.personaId ? `Escribe para el avatar id ${b.personaId}.` : '',
    b.trabajo ? `El trabajo del lote es ${b.trabajo.toUpperCase()}.` : '',
    b.tema ? `Idea del usuario a desarrollar: "${b.tema.slice(0, 800)}"` : '',
  ].filter(Boolean).join('\n');

  const pedido = `Escribe ${cantidad} guion(es) para grabar con el talento: ${TALENTOS[talento]}
${reparto}
${foco}

Reglas de este pedido:
- Cada guion = 1 concepto × 1 avatar × 1 trabajo. Sus 3 hooks van sobre el MISMO cuerpo: serán 3 anuncios del mismo lote.
- Iteración: di qué capa cambia (mensaje, mecanismo, avatar, educación, oferta o visual) y respeta lo que el ganador hace bien (receta, conservar).
- Concepto nuevo: apóyate en un avatar con dolor/objeción concreta; no repitas lotes recientes.
- Prioriza lo que la cuenta necesita hoy (lista abajo).
- Todo grabable por ${talento === 'founder' ? 'el founder' : talento === 'modelo' ? 'modelos' : 'creadores'} con celular.

CONTEXTO DE LA CUENTA
${contextoEnTexto(ctx, { personaId: b.personaId })}`;

  try {
    const out = await pedirJson<{ lectura: string; guiones: unknown[] }>({
      system: `${GUIONISTA}\n\n${HECHOS_FEEL_INK}`,
      contenido: [{ type: 'text', text: pedido }],
      nombre: 'entregar_guiones',
      descripcion: 'Entrega los guiones listos para grabar.',
      esquema: ESQUEMA,
      maxTokens: 4000 + cantidad * 2200,
    });
    return NextResponse.json({ ...out, talento });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudieron escribir' }, { status: 502 });
  }
}
