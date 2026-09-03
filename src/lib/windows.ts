// =============================================================================
// Time windows and comparisons. One definition, used by the API and the UI.
//
//   today · yesterday · last3 · last7 · last14 · last30 · lifetime · custom
//
// Windows are anchored on the ACCOUNT's timezone day (ad_daily.date is Meta's
// reporting day in that timezone) and, by default, on the last day with data
// rather than the wall clock — a sync that has not landed yet must not show an
// empty "today". Every window knows its previous period for comparisons.
// =============================================================================

export type WindowId = 'today' | 'yesterday' | 'last3' | 'last7' | 'last14' | 'last30' | 'lifetime' | 'custom';
export const WINDOW_IDS: WindowId[] = ['today', 'yesterday', 'last3', 'last7', 'last14', 'last30', 'lifetime', 'custom'];

export interface DateRange { from: string | null; to: string | null }
export interface ResolvedWindow {
  id: WindowId;
  current: DateRange;
  /** the period of equal length right before `current`; null for lifetime */
  previous: DateRange | null;
  days: number | null;
}

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const shift = (s: string, days: number) => ymd(new Date(parse(s).getTime() + days * DAY));

/**
 * Resolves a window to concrete dates.
 * @param anchor  the reference "today" (YYYY-MM-DD) — normally the last day with data
 */
export function resolveWindow(id: WindowId, anchor: string, custom?: DateRange): ResolvedWindow {
  const span = (n: number): ResolvedWindow => {
    const to = anchor;
    const from = shift(anchor, -(n - 1));
    return { id, current: { from, to }, previous: { from: shift(from, -n), to: shift(from, -1) }, days: n };
  };
  switch (id) {
    case 'today': return { id, current: { from: anchor, to: anchor }, previous: { from: shift(anchor, -1), to: shift(anchor, -1) }, days: 1 };
    case 'yesterday': { const y = shift(anchor, -1); return { id, current: { from: y, to: y }, previous: { from: shift(y, -1), to: shift(y, -1) }, days: 1 }; }
    case 'last3': return span(3);
    case 'last7': return span(7);
    case 'last14': return span(14);
    case 'last30': return span(30);
    case 'lifetime': return { id, current: { from: null, to: null }, previous: null, days: null };
    case 'custom': {
      const from = custom?.from ?? anchor, to = custom?.to ?? anchor;
      const n = Math.max(1, Math.round((parse(to).getTime() - parse(from).getTime()) / DAY) + 1);
      return { id, current: { from, to }, previous: { from: shift(from, -n), to: shift(from, -1) }, days: n };
    }
  }
}

export function isWindowId(v: unknown): v is WindowId {
  return typeof v === 'string' && (WINDOW_IDS as string[]).includes(v);
}

/** Relative change in percent; null when the baseline is missing or zero. */
export function delta(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
