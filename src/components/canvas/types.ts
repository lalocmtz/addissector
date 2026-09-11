// =============================================================================
// Canvas — tipos del tablero y helpers puros (sin React).
// El tablero se guarda entero en canvas_board.data = { items, groups }.
// =============================================================================

export type CanvasKind = 'note' | 'concept' | 'hook' | 'link' | 'ai' | 'image' | 'text';

export interface CanvasItem {
  id: string;
  kind: CanvasKind;
  x: number;
  y: number;
  w: number;
  h: number;
  groupId?: string | null;
  color?: string;
  title?: string;
  text?: string;
  url?: string;
  /** Ruta en el bucket (solo imágenes subidas; sirve para borrarlas). */
  path?: string;
  /** Proporción ancho/alto original (solo imágenes): el resize la respeta. */
  ratio?: number;
  meta?: Record<string, string>;
  createdAt: string;
}

export interface CanvasGroup {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Incluir en el contexto del chat. Ausente = true. */
  toBrain?: boolean;
  createdAt: string;
}

export interface CanvasData {
  items: CanvasItem[];
  groups: CanvasGroup[];
}

export interface View { x: number; y: number; z: number }

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const CONCEPT_FIELDS = ['angle', 'hook', 'format', 'why'] as const;
export type ConceptField = (typeof CONCEPT_FIELDS)[number];

export const DEFAULT_SIZE: Record<CanvasKind, { w: number; h: number }> = {
  note: { w: 240, h: 160 },
  concept: { w: 280, h: 260 },
  hook: { w: 260, h: 120 },
  link: { w: 240, h: 110 },
  ai: { w: 320, h: 220 },
  image: { w: 360, h: 360 },
  text: { w: 280, h: 64 },
};

/** Capas de dibujo: las imágenes van al fondo para poder escribir encima. */
const LAYER: Record<CanvasKind, number> = { image: 0, note: 1, concept: 1, hook: 1, link: 1, ai: 1, text: 2 };

/** Orden de pintado: imágenes atrás, tarjetas en medio, textos sueltos al frente. */
export function sortForRender(items: CanvasItem[]): CanvasItem[] {
  return [...items].sort((a, b) => (LAYER[a.kind] ?? 1) - (LAYER[b.kind] ?? 1));
}

/** Caja que respeta la proporción original y cabe en `max` px por lado. */
export function fitBox(w: number, h: number, max = 380): { w: number; h: number } {
  if (!w || !h) return { w: max, h: max };
  const scale = Math.min(max / w, max / h, 1.5);
  return { w: Math.max(80, Math.round(w * scale)), h: Math.max(80, Math.round(h * scale)) };
}

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

export function groupSendsToBrain(g: CanvasGroup): boolean {
  return g.toBrain !== false;
}

/** Grupo cuyo rectángulo contiene el centro del item (o null). */
export function groupAtCenter(item: CanvasItem, groups: CanvasGroup[]): string | null {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  for (const g of groups) {
    if (cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h) return g.id;
  }
  return null;
}

type Labels = { kind: Record<CanvasKind, string>; field: Record<ConceptField, string>; loose: string; group: string; imageFallback: string };

/** Texto compacto del tablero para el chat (grupos con «Enviar al cerebro» + sueltas). */
export function dumpForBrain(data: CanvasData, labels: Labels, max = 12_000): string {
  const line = (it: CanvasItem): string => {
    const k = `[${labels.kind[it.kind]}]`;
    const title = (it.title ?? '').trim();
    const text = (it.text ?? '').trim();
    switch (it.kind) {
      case 'concept': {
        const m = it.meta ?? {};
        const fields = CONCEPT_FIELDS.filter((f) => (m[f] ?? '').trim()).map((f) => `${labels.field[f]}: ${m[f].trim()}`).join(' | ');
        return `${k} ${title || '—'}${fields ? ` | ${fields}` : ''}`;
      }
      case 'hook':
        return `${k} "${text}"${it.meta?.type ? ` (${it.meta.type})` : ''}`;
      case 'link':
        return `${k} ${title || it.url || ''}${it.url ? ` — ${it.url}` : ''}`;
      case 'image':
        return `${k} ${title || labels.imageFallback}${text ? ` — ${text}` : ''}`;
      case 'text':
        return `${k} ${text}`;
      case 'ai':
        return `${k} ${text.slice(0, 600)}`;
      default:
        return `${k} ${title ? `${title}: ` : ''}${text}`;
    }
  };
  const parts: string[] = [];
  for (const g of data.groups) {
    if (!groupSendsToBrain(g)) continue;
    const items = data.items.filter((it) => it.groupId === g.id);
    if (items.length === 0) continue;
    parts.push(`${labels.group}: ${g.title || '—'}\n${items.map((it) => `- ${line(it)}`).join('\n')}`);
  }
  const groupIds = new Set(data.groups.map((g) => g.id));
  const loose = data.items.filter((it) => !it.groupId || !groupIds.has(it.groupId));
  if (loose.length > 0) parts.push(`${labels.loose}:\n${loose.map((it) => `- ${line(it)}`).join('\n')}`);
  return parts.join('\n\n').slice(0, max);
}

/** URLs de las imágenes que el chat puede mirar (mismas reglas que dumpForBrain). */
export function imagesForBrain(data: CanvasData, max = 6): string[] {
  const groupIds = new Set(data.groups.map((g) => g.id));
  const offGroups = new Set(data.groups.filter((g) => !groupSendsToBrain(g)).map((g) => g.id));
  const urls: string[] = [];
  for (const it of data.items) {
    if (it.kind !== 'image') continue;
    if (it.groupId && groupIds.has(it.groupId) && offGroups.has(it.groupId)) continue;
    const u = (it.url ?? '').trim();
    if (/^https?:\/\//i.test(u) && !urls.includes(u)) urls.push(u);
    if (urls.length >= max) break;
  }
  return urls;
}
