// =============================================================================
// pedirJson — una llamada a Claude que regresa JSON con forma garantizada.
// Usa una herramienta forzada (tool_choice) con el esquema: el modelo no puede
// contestar texto suelto ni JSON roto.
// =============================================================================

import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODEL, cachedSystem } from '@/lib/ai';

export type Bloque = Anthropic.Messages.ContentBlockParam;

/** Imagen por URL pública para el mensaje. */
export function imagen(url: string): Bloque {
  return { type: 'image', source: { type: 'url', url } };
}

export async function pedirJson<T>(o: {
  system: string;
  contenido: Bloque[];
  nombre: string;
  descripcion: string;
  esquema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: o.maxTokens ?? 8000,
    system: cachedSystem(o.system),
    tools: [{ name: o.nombre, description: o.descripcion, input_schema: { type: 'object', ...o.esquema } as Anthropic.Messages.Tool.InputSchema }],
    tool_choice: { type: 'tool', name: o.nombre },
    messages: [{ role: 'user', content: o.contenido }],
  });
  const uso = res.content.find((b) => b.type === 'tool_use');
  if (!uso || uso.type !== 'tool_use') throw new Error('El modelo no regresó el resultado');
  return uso.input as T;
}

// Atajos de esquema.
export const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
export const strs = (description?: string, min?: number, max?: number) => ({
  type: 'array', items: { type: 'string' }, ...(description ? { description } : {}),
  ...(min != null ? { minItems: min } : {}), ...(max != null ? { maxItems: max } : {}),
});
export const enumDe = (vals: string[], description?: string) => ({ type: 'string', enum: vals, ...(description ? { description } : {}) });
export const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required });
export const arr = (items: unknown, min?: number, max?: number) => ({ type: 'array', items, ...(min != null ? { minItems: min } : {}), ...(max != null ? { maxItems: max } : {}) });
