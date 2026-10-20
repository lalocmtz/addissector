// =============================================================================
// La síntesis del Cerebro: Claude lee el destilado de 7 y 30 días y escribe lo
// que se REPITE en lo que funciona (hooks verbales, hooks visuales, estructuras
// de guion, estáticos), lo que hay que evitar, qué ganador se está cansando y
// 3 a 5 lotes para la siguiente semana. Cada patrón cita sus anuncios.
// =============================================================================

import type { Destilado } from '@/lib/cerebro-destilado';
import { pedirJson, str, strs, enumDe, obj, arr } from '@/lib/ai-json';
import { HECHOS_FEEL_INK } from '@/lib/prompts-creativos';

interface Patron { patron: string; ejemplos: string[]; evidencia: string }
interface Sintesis {
  resumen: string;
  hooks_verbales: Patron[];
  hooks_visuales: Patron[];
  estructuras_guion: Patron[];
  estaticos: Patron[];
  avatares_y_angulos: string;
  evitar: string[];
  cansancio: string[];
  siguientes_lotes: { tipo: 'iteracion' | 'concepto'; formato: 'video' | 'estatico'; idea: string; basado_en: string }[];
  huecos: string[];
}

const PATRON = obj({
  patron: str('El patrón en una frase, concreto (no "hooks emocionales").'),
  ejemplos: strs('Citas literales o descripciones de los anuncios que lo muestran.', 1, 4),
  evidencia: str('Nombres de los anuncios y su ROAS/gasto.'),
});

const SISTEMA = `Eres el analista creativo de la cuenta de Meta. Recibes el destilado de lo que ganó y perdió en 7 y 30 días, con el hook verbal, el hook visual, el texto en pantalla, la estructura y el guion de cada anuncio, y en estáticos su titular, copy y composición.
Tu trabajo: encontrar lo que se REPITE en los ganadores y no en los perdedores. Reglas:
- Cada patrón cita al menos un anuncio por nombre con su ROAS. Si un patrón sale de un solo anuncio, dilo.
- 7 días es lo que pasa ahora; 30 días es lo que es cierto de la cuenta. Un ganador de 30 días que ya no aparece en 7 es cansancio.
- Nada de adjetivos vacíos. Específico: qué se dice, qué se ve, en qué segundo.
- Si los datos no alcanzan (pocos ganadores o sin análisis), dilo en huecos en vez de inventar.
- Los siguientes lotes respetan las reglas de la marca.
${HECHOS_FEEL_INK}`;

export async function sintetizar(d: Destilado): Promise<{ markdown: string; json: Sintesis } | null> {
  const v7 = d.ventanas.find((v) => v.dias === 7);
  const v30 = d.ventanas.find((v) => v.dias === 30);
  if (!v7 && !v30) return null;
  if ((v7?.ganadores ?? 0) + (v30?.ganadores ?? 0) === 0) return null;
  const texto = [v7?.prompt, v30?.prompt].filter(Boolean).join('\n\n---\n\n').slice(0, 60_000);
  const j = await pedirJson<Sintesis>({
    system: SISTEMA,
    contenido: [{ type: 'text', text: `Marca: ${d.marca}. Equilibrio ${d.economics.breakeven}, King Goal ${d.economics.target}.\n\n${texto}` }],
    nombre: 'entregar_sintesis',
    descripcion: 'Entrega los patrones de lo que funciona.',
    esquema: {
      properties: {
        resumen: str('3 frases: qué está ganando ahora, qué es cierto en 30 días y qué cambió.'),
        hooks_verbales: arr(PATRON, 0, 5),
        hooks_visuales: arr(PATRON, 0, 5),
        estructuras_guion: arr(PATRON, 0, 4),
        estaticos: arr(PATRON, 0, 4),
        avatares_y_angulos: str('A quién le están hablando los ganadores y con qué razón de compra.'),
        evitar: strs('Lo que se repite en los perdedores.', 0, 5),
        cansancio: strs('Ganadores de 30 días que ya no ganan en 7 (nombre + qué hacer).', 0, 5),
        siguientes_lotes: arr(obj({
          tipo: enumDe(['iteracion', 'concepto']),
          formato: enumDe(['video', 'estatico']),
          idea: str('El lote en una frase: avatar, concepto y trabajo.'),
          basado_en: str('El patrón o anuncio del que sale.'),
        }), 3, 5),
        huecos: strs('Lo que falta para concluir (anuncios sin análisis, pocas ventas).', 0, 4),
      },
      required: ['resumen', 'hooks_verbales', 'hooks_visuales', 'estructuras_guion', 'estaticos', 'avatares_y_angulos', 'evitar', 'cansancio', 'siguientes_lotes', 'huecos'],
    },
    maxTokens: 6000,
  });

  const P = (titulo: string, xs: Patron[]) => xs.length
    ? [`### ${titulo}`, ...xs.map((x) => `- **${x.patron}** — ${x.evidencia}${x.ejemplos.length ? `\n  - ${x.ejemplos.join('\n  - ')}` : ''}`), '']
    : [];
  const md = [
    j.resumen, '',
    ...P('Hooks verbales', j.hooks_verbales),
    ...P('Hooks visuales (0-3 s)', j.hooks_visuales),
    ...P('Estructuras de guion', j.estructuras_guion),
    ...P('Estáticos', j.estaticos),
    '### Avatares y ángulos', j.avatares_y_angulos, '',
    ...(j.evitar.length ? ['### Evitar', ...j.evitar.map((x) => `- ${x}`), ''] : []),
    ...(j.cansancio.length ? ['### Se está cansando', ...j.cansancio.map((x) => `- ${x}`), ''] : []),
    '### Lotes sugeridos para la semana',
    ...j.siguientes_lotes.map((l) => `- [${l.tipo === 'iteracion' ? 'Iteración' : 'Concepto nuevo'} · ${l.formato === 'video' ? 'video' : 'estático'}] ${l.idea} — sale de: ${l.basado_en}`),
    ...(j.huecos.length ? ['', '### Huecos de datos', ...j.huecos.map((x) => `- ${x}`)] : []),
  ].join('\n');
  return { markdown: md, json: j };
}
