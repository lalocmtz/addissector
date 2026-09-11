'use client';

// =============================================================================
// Canvas — una tarjeta del tablero (nota, concepto, hook, link o respuesta
// del cerebro). El arrastre/resize lo maneja la página vía los handlers.
// =============================================================================

import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { X, GripHorizontal, ExternalLink, Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import { CONCEPT_FIELDS, type CanvasItem, type CanvasKind } from './types';

type T = (k: string, v?: Record<string, string | number>) => string;

const KIND_STYLE: Record<CanvasKind, string> = {
  note: 'border-line',
  concept: 'border-accent/50',
  hook: 'border-warn/50',
  link: 'border-line',
  ai: 'border-accent/40 bg-accent-soft/40',
  image: 'border-transparent bg-transparent shadow-none',
  text: 'border-transparent bg-transparent shadow-none',
};

const TEXT_SIZE: Record<string, string> = { s: 'text-sm', m: 'text-lg', l: 'text-2xl', xl: 'text-4xl' };

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

  // --- Imagen: se arrastra desde la propia imagen y vive en la capa de atrás ---
  if (item.kind === 'image') {
    const uploading = meta.uploading === '1';
    return (
      <div
        className={`absolute group rounded-lg ${selected ? 'ring-2 ring-accent' : ''}`}
        style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
        onPointerDown={stop}
      >
        <div onPointerDown={onHeaderDown} className="w-full h-full cursor-grab active:cursor-grabbing touch-none select-none overflow-hidden rounded-lg bg-surface-2">
          {item.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.url} alt={item.title ?? ''} draggable={false} className="w-full h-full object-contain pointer-events-none" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-4"><Loader2 className="w-5 h-5 animate-spin" /></div>
          )}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-canvas/50 rounded-lg">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
            </div>
          )}
        </div>

        {/* Barra flotante: solo al pasar el mouse o si está seleccionada */}
        <div className={`absolute -top-3 left-1 right-1 flex items-center gap-1 rounded-lg border border-line bg-surface px-1.5 py-0.5 shadow-sm transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <div onPointerDown={onHeaderDown} className="shrink-0 cursor-grab active:cursor-grabbing touch-none">
            <GripHorizontal className="w-3.5 h-3.5 text-ink-4" />
          </div>
          <input value={item.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} onPointerDown={stop}
            placeholder={t('canvas.image.caption')}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-ink placeholder:text-ink-4 focus:outline-none" />
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" onPointerDown={stop} className="p-0.5 rounded text-ink-4 hover:text-accent shrink-0" title={t('canvas.image.open')}>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <button onClick={onDelete} onPointerDown={stop} className="p-0.5 rounded text-ink-4 hover:text-danger shrink-0" title={t('canvas.card.delete')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {item.title && !selected && (
          <div className="absolute -bottom-5 left-0 right-0 truncate text-[11px] text-ink-3 pointer-events-none">{item.title}</div>
        )}

        <div onPointerDown={onResizeDown} className="absolute right-0 bottom-0 w-5 h-5 cursor-nwse-resize touch-none" title={t('canvas.card.resize')}>
          <div className={`absolute right-1 bottom-1 w-2.5 h-2.5 border-r-2 border-b-2 rounded-br-sm ${selected ? 'border-accent' : 'border-ink-4 opacity-0 group-hover:opacity-100'}`} />
        </div>
      </div>
    );
  }

  // --- Texto libre: para escribir ENCIMA de las imágenes ---------------------
  if (item.kind === 'text') {
    const size = TEXT_SIZE[meta.size ?? 'm'] ?? TEXT_SIZE.m;
    return (
      <div
        className={`absolute group rounded-md ${selected ? 'ring-2 ring-accent' : ''}`}
        style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
        onPointerDown={stop}
      >
        <div className={`absolute -top-3 left-0 flex items-center gap-1 rounded-lg border border-line bg-surface px-1.5 py-0.5 shadow-sm transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          <div onPointerDown={onHeaderDown} className="shrink-0 cursor-grab active:cursor-grabbing touch-none">
            <GripHorizontal className="w-3.5 h-3.5 text-ink-4" />
          </div>
          <select value={meta.size ?? 'm'} onChange={(e) => setMeta('size', e.target.value)} onPointerDown={stop}
            className="bg-transparent text-[10px] text-ink-3 focus:outline-none">
            <option value="s">S</option><option value="m">M</option><option value="l">L</option><option value="xl">XL</option>
          </select>
          <button onClick={() => setMeta('tone', meta.tone === 'accent' ? '' : 'accent')} onPointerDown={stop}
            className={`px-1 rounded text-[10px] ${meta.tone === 'accent' ? 'text-accent' : 'text-ink-4'}`} title={t('canvas.text.highlight')}>A</button>
          <button onClick={onDelete} onPointerDown={stop} className="p-0.5 rounded text-ink-4 hover:text-danger shrink-0" title={t('canvas.card.delete')}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <textarea value={item.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} placeholder={t('canvas.text.placeholder')}
          className={`w-full h-full resize-none bg-transparent font-semibold leading-tight focus:outline-none placeholder:text-ink-4/70 break-words ${size} ${meta.tone === 'accent' ? 'text-accent' : 'text-ink'}`}
          style={{ textShadow: '0 1px 2px var(--color-canvas)' }} />
        <div onPointerDown={onResizeDown} className="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize touch-none">
          <div className={`absolute right-0.5 bottom-0.5 w-2 h-2 border-r-2 border-b-2 rounded-br-sm ${selected ? 'border-accent' : 'border-ink-4 opacity-0 group-hover:opacity-100'}`} />
        </div>
      </div>
    );
  }

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
