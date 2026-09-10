'use client';

// =============================================================================
// Canvas — una tarjeta del tablero (nota, concepto, hook, link o respuesta
// del cerebro). El arrastre/resize lo maneja la página vía los handlers.
// =============================================================================

import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { X, GripHorizontal, ExternalLink, Sparkles, ArrowRight } from 'lucide-react';
import { CONCEPT_FIELDS, type CanvasItem, type CanvasKind } from './types';

type T = (k: string, v?: Record<string, string | number>) => string;

const KIND_STYLE: Record<CanvasKind, string> = {
  note: 'border-line',
  concept: 'border-accent/50',
  hook: 'border-warn/50',
  link: 'border-line',
  ai: 'border-accent/40 bg-accent-soft/40',
};

const field = 'w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent';
const label = 'block text-[10px] uppercase tracking-wide text-ink-4 mb-0.5';

function AutoTextarea({ value, onChange, placeholder, className = '' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2}
      className={`w-full resize-none bg-transparent text-sm text-ink placeholder:text-ink-4 focus:outline-none leading-snug break-words ${className}`} />
  );
}

export default function CanvasCard({ item, selected, t, onChange, onDelete, onHeaderDown, onResizeDown, onCreateBatch }: {
  item: CanvasItem;
  selected: boolean;
  t: T;
  onChange: (patch: Partial<CanvasItem>) => void;
  onDelete: () => void;
  onHeaderDown: (e: RPointerEvent<HTMLDivElement>) => void;
  onResizeDown: (e: RPointerEvent<HTMLDivElement>) => void;
  onCreateBatch?: () => void;
}) {
  const meta = item.meta ?? {};
  const setMeta = (k: string, v: string) => onChange({ meta: { ...meta, [k]: v } });
  const stop = (e: RPointerEvent) => e.stopPropagation();

  return (
    <div
      className={`absolute rounded-xl border bg-surface shadow-sm flex flex-col min-w-0 ${KIND_STYLE[item.kind]} ${selected ? 'ring-2 ring-accent' : ''}`}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
      onPointerDown={stop}
    >
      {/* Header: arrastrable */}
      <div onPointerDown={onHeaderDown}
        className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-line cursor-grab active:cursor-grabbing select-none touch-none">
        <GripHorizontal className="w-3.5 h-3.5 text-ink-4 shrink-0" />
        {item.kind === 'ai' ? (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-accent font-medium">
            <Sparkles className="w-3 h-3" />{t('canvas.badge.brain')}
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-ink-4">{t(`canvas.kind.${item.kind}`)}</span>
        )}
        <button onClick={onDelete} onPointerDown={stop} className="ml-auto p-0.5 rounded text-ink-4 hover:text-danger" title={t('canvas.card.delete')}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-1.5">
        {item.kind === 'note' && (
          <>
            <input value={item.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} placeholder={t('canvas.card.title')}
              className="w-full bg-transparent text-sm font-semibold text-ink placeholder:text-ink-4 focus:outline-none" />
            <AutoTextarea value={item.text ?? ''} onChange={(v) => onChange({ text: v })} placeholder={t('canvas.note.placeholder')} />
          </>
        )}

        {item.kind === 'concept' && (
          <>
            <input value={item.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} placeholder={t('canvas.concept.title')}
              className="w-full bg-transparent text-sm font-semibold text-ink placeholder:text-ink-4 focus:outline-none" />
            {CONCEPT_FIELDS.map((f) => (
              <div key={f}>
                <label className={label}>{t(`canvas.field.${f}`)}</label>
                <input value={meta[f] ?? ''} onChange={(e) => setMeta(f, e.target.value)} className={field} placeholder={t(`canvas.field.${f}.placeholder`)} />
              </div>
            ))}
            {onCreateBatch && (
              <button onClick={onCreateBatch} className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent text-on-accent text-xs font-medium">
                {t('canvas.concept.create')}<ArrowRight className="w-3 h-3" />
              </button>
            )}
          </>
        )}

        {item.kind === 'hook' && (
          <>
            <AutoTextarea value={item.text ?? ''} onChange={(v) => onChange({ text: v })} placeholder={t('canvas.hook.placeholder')} className="font-medium" />
            <select value={meta.type ?? ''} onChange={(e) => setMeta('type', e.target.value)} className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent">
              <option value="">{t('canvas.hook.type')}</option>
              <option value="voz">{t('canvas.hook.type.voice')}</option>
              <option value="headline">{t('canvas.hook.type.headline')}</option>
            </select>
          </>
        )}

        {item.kind === 'link' && (
          <>
            <input value={item.url ?? ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://" className={`${field} font-[family-name:var(--font-mono)]`} />
            <input value={item.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} placeholder={t('canvas.link.label')} className={field} />
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent underline truncate max-w-full">
                <ExternalLink className="w-3 h-3 shrink-0" /><span className="truncate">{item.title || item.url}</span>
              </a>
            )}
          </>
        )}

        {item.kind === 'ai' && (
          <p className="text-xs text-ink-2 whitespace-pre-wrap break-words leading-relaxed">{item.text}</p>
        )}
      </div>

      {/* Resize handle */}
      <div onPointerDown={onResizeDown} className="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize touch-none" title={t('canvas.card.resize')}>
        <div className="absolute right-1 bottom-1 w-2 h-2 border-r-2 border-b-2 border-ink-4 rounded-br-sm" />
      </div>
    </div>
  );
}
