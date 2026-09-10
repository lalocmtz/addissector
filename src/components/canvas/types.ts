// =============================================================================
// Canvas — tipos del tablero y helpers puros (sin React).
// El tablero se guarda entero en canvas_board.data = { items, groups }.
// =============================================================================

export type CanvasKind = 'note' | 'concept' | 'hook' | 'link' | 'ai';

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
};

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

type Labels = { kind: Record<CanvasKind, string>; field: Record<ConceptField, string>; loose: string; group: string };

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
