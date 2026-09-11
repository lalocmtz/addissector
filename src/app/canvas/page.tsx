'use client';

// =============================================================================
// Canvas — tablero libre (tipo Miro) para planear: notas, conceptos, hooks,
// links y respuestas del cerebro. Abajo, un chat que siempre habla con el
// cerebro usando lo que está en el tablero; de un concepto se crea una tanda
// en Producción.
//
// Todo el tablero vive en canvas_board.data y se guarda solo (800 ms).
// =============================================================================

import { useState, useEffect, useRef, useCallback, type PointerEvent as RPointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { MousePointer2, Hand, StickyNote, Lightbulb, Zap, Link2, Square, Sparkles, Plus, Minus, Loader2, X, Check, BrainCircuit, ArrowRight, ImagePlus, Type as TypeIcon, AlertTriangle } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { createBrowserClient } from '@/lib/supabase-browser';
import { useT } from '@/lib/i18n';
import CanvasCard from '@/components/canvas/CanvasCard';
import CanvasChat from '@/components/canvas/CanvasChat';
import {
  uid, clampZoom, groupAtCenter, groupSendsToBrain, dumpForBrain, imagesForBrain, sortForRender, fitBox,
  DEFAULT_SIZE, ZOOM_MIN, ZOOM_MAX,
  type CanvasData, type CanvasItem, type CanvasGroup, type CanvasKind, type View,
} from '@/components/canvas/types';

type Tool = 'select' | 'pan';
type Status = 'loading' | 'saved' | 'saving' | 'error';

interface Drag {
  type: 'pan' | 'item' | 'group' | 'resize-item' | 'resize-group';
  id?: string;
  sx: number; sy: number;            // pointer start (screen)
  ox: number; oy: number;            // original x/y (world, or view offset for pan)
  ow: number; oh: number;            // original size
  ratio?: number;                    // proporción a respetar (imágenes)
  members?: Record<string, { x: number; y: number }>;
}

const ADD_KINDS: CanvasKind[] = ['note', 'text', 'concept', 'hook', 'link'];
const KIND_ICON: Record<CanvasKind, typeof StickyNote> = { note: StickyNote, text: TypeIcon, concept: Lightbulb, hook: Zap, link: Link2, ai: Sparkles, image: ImagePlus };
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_BUCKET = 'brand-assets';
const GRID = 24;
const MIN_ITEM = { w: 160, h: 80 };
const MIN_MEDIA = { w: 60, h: 40 };
const MIN_GROUP = { w: 220, h: 140 };
const SAVE_DELAY = 800;
const viewKey = (brandId: string) => `addna-canvas-view-${brandId}`;

const toolBtn = 'flex items-center gap-1.5 sm:justify-center sm:w-9 sm:h-9 px-2 py-1.5 sm:p-0 rounded-md text-xs text-ink-2 hover:bg-surface-2 hover:text-ink shrink-0';
const toolActive = 'bg-accent-soft text-accent';

function normalize(raw: unknown): CanvasData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<CanvasData>;
  return { items: Array.isArray(d.items) ? d.items : [], groups: Array.isArray(d.groups) ? d.groups : [] };
}

function seed(t: (k: string) => string): CanvasData {
  const now = new Date().toISOString();
  const gid = uid();
  return {
    groups: [{ id: gid, title: t('canvas.seed.group'), x: 40, y: 40, w: 560, h: 320, toBrain: true, createdAt: now }],
    items: [{ id: uid(), kind: 'note', x: 64, y: 96, w: 300, h: 150, groupId: gid, text: t('canvas.seed.note'), createdAt: now }],
  };
}

/** Tamaño real de la imagen antes de subirla (para no deformarla en el tablero). */
function imageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    const done = (w: number, h: number) => { URL.revokeObjectURL(url); resolve({ w, h }); };
    img.onload = () => done(img.naturalWidth || 320, img.naturalHeight || 320);
    img.onerror = () => done(320, 320);
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
export default function CanvasPage() {
  const { me, activeBrand, setActiveBrandId } = useMe();
  const t = useT();
  const router = useRouter();
  const brandId = activeBrand?.id ?? null;

  const [board, setBoard] = useState<CanvasData | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [view, setView] = useState<View>({ x: 40, y: 40, z: 1 });
  const [tool, setTool] = useState<Tool>('select');
  const [space, setSpace] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [upErr, setUpErr] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const viewRef = useRef(view);
  const dirtyRef = useRef(false);
  const loadedForRef = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { viewRef.current = view; }, [view]);

  // --- Carga del tablero ------------------------------------------------------
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    const run = async () => {
      setBoard(null); setStatus('loading'); setSelected(null);
      try {
        const res = await fetch(`/api/canvas?brand=${brandId}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? 'Failed');
        let data = normalize(json.data);
        dirtyRef.current = false;
        if (data.items.length === 0 && data.groups.length === 0) { data = seed(t); dirtyRef.current = true; }
        try {
          const v = localStorage.getItem(viewKey(brandId));
          const parsed = v ? (JSON.parse(v) as View) : null;
          setView(parsed && Number.isFinite(parsed.x) ? { x: parsed.x, y: parsed.y, z: clampZoom(parsed.z || 1) } : { x: 40, y: 40, z: 1 });
        } catch { setView({ x: 40, y: 40, z: 1 }); }
        loadedForRef.current = brandId;
        setBoard(data);
        setStatus(dirtyRef.current ? 'saving' : 'saved');
      } catch {
        if (!cancelled) setStatus('error');
      }
    };
    void Promise.resolve().then(run);
    return () => { cancelled = true; };
  }, [brandId, t]);

  // --- Guardado con debounce -----------------------------------------------
  useEffect(() => {
    if (!board || !brandId || !dirtyRef.current || loadedForRef.current !== brandId) return;
    const timer = setTimeout(async () => {
      dirtyRef.current = false;
      try {
        const res = await fetch('/api/canvas', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandId, data: board }),
        });
        setStatus(res.ok ? 'saved' : 'error');
      } catch { setStatus('error'); }
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [board, brandId]);

  // --- Vista (pan/zoom) en localStorage ----------------------------------------
  useEffect(() => {
    if (!brandId || loadedForRef.current !== brandId) return;
    try { localStorage.setItem(viewKey(brandId), JSON.stringify(view)); } catch { /* sin storage */ }
  }, [view, brandId]);

  const update = useCallback((fn: (b: CanvasData) => CanvasData) => {
    dirtyRef.current = true;
    setStatus('saving');
    setBoard((b) => (b ? fn(b) : b));
  }, []);

  const patchItem = useCallback((id: string, patch: Partial<CanvasItem>) =>
    update((b) => ({ ...b, items: b.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) })), [update]);
  const patchGroup = useCallback((id: string, patch: Partial<CanvasGroup>) =>
    update((b) => ({ ...b, groups: b.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) })), [update]);
  const removeItem = useCallback((id: string) => update((b) => ({ ...b, items: b.items.filter((it) => it.id !== id) })), [update]);
  const removeGroup = useCallback((id: string) => update((b) => ({
    groups: b.groups.filter((g) => g.id !== id),
    items: b.items.map((it) => (it.groupId === id ? { ...it, groupId: null } : it)),
  })), [update]);

  // --- Coordenadas ------------------------------------------------------------
  /** Centro del viewport en coordenadas del mundo, con un pequeño desfase para no apilar. */
  const viewportCenter = useCallback((w: number, h: number) => {
    const r = boardRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    const jitter = Math.round(Math.random() * 3) * GRID;
    const cx = r ? (r.width / 2 - v.x) / v.z : 200;
    const cy = r ? (r.height / 2 - v.y) / v.z : 200;
    return { x: Math.round((cx - w / 2 + jitter) / GRID) * GRID, y: Math.round((cy - h / 2 + jitter) / GRID) * GRID };
  }, []);

  /** Punto del mundo bajo el puntero (o el centro del viewport si no hay). */
  const worldPoint = useCallback((clientX?: number, clientY?: number) => {
    const r = boardRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!r || clientX === undefined || clientY === undefined) return null;
    return { x: (clientX - r.left - v.x) / v.z, y: (clientY - r.top - v.y) / v.z };
  }, []);

  const addItem = useCallback((kind: CanvasKind, extra: Partial<CanvasItem> = {}, at?: { x: number; y: number }) => {
    const size = { w: extra.w ?? DEFAULT_SIZE[kind].w, h: extra.h ?? DEFAULT_SIZE[kind].h };
    const pos = at ? { x: Math.round(at.x - size.w / 2), y: Math.round(at.y - size.h / 2) } : viewportCenter(size.w, size.h);
    const id = uid();
    update((b) => {
      const item: CanvasItem = { id, kind, ...pos, ...size, groupId: null, createdAt: new Date().toISOString(), ...extra };
      item.groupId = groupAtCenter(item, b.groups);
      return { ...b, items: [...b.items, item] };
    });
    setSelected(id);
  }, [update, viewportCenter]);

  // --- Imágenes: subir al bucket y soltarlas en el tablero --------------------
  const addImages = useCallback(async (files: File[], at?: { x: number; y: number }) => {
    if (!brandId) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    setUpErr(null);
    let drop = at ?? null;
    for (const file of images) {
      if (file.size > MAX_IMAGE_BYTES) { setUpErr(t('canvas.image.tooBig')); continue; }
      setUploading((n) => n + 1);
      try {
        const dims = await imageSize(file);
        const res = await fetch('/api/canvas/upload-url', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandId, filename: file.name || 'captura.png' }),
        });
        const json = (await res.json()) as { path?: string; token?: string; url?: string; error?: string };
        if (!res.ok || !json.path || !json.token || !json.url) throw new Error(json.error ?? t('canvas.image.failed'));
        const sb = createBrowserClient();
        const up = await sb.storage.from(IMAGE_BUCKET).uploadToSignedUrl(json.path, json.token, file, { contentType: file.type || undefined });
        if (up.error) throw new Error(up.error.message);
        const box = fitBox(dims.w, dims.h);
        addItem('image', { url: json.url, path: json.path, ratio: dims.w / dims.h, ...box }, drop ?? undefined);
        if (drop) drop = { x: drop.x + 32, y: drop.y + 32 };
      } catch (e) {
        setUpErr(e instanceof Error ? e.message : t('canvas.image.failed'));
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
  }, [brandId, addItem, t]);

  // Pegar: imagen del portapapeles → tarjeta de imagen; texto largo → nota.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        e.preventDefault();
        const p = pointerRef.current;
        void addImages(files, p ? worldPoint(p.x, p.y) ?? undefined : undefined);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const text = dt.getData('text/plain').trim();
      if (!text) return;
      e.preventDefault();
      const p = pointerRef.current;
      const at = p ? worldPoint(p.x, p.y) ?? undefined : undefined;
      if (/^https?:\/\/\S+$/i.test(text)) {
        if (/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(text)) addItem('image', { url: text }, at);
        else addItem('link', { url: text }, at);
      } else {
        addItem('note', { text }, at);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImages, addItem, worldPoint]);

  // Soltar un archivo fuera del tablero no debe hacer que el navegador lo abra.
  useEffect(() => {
    const swallow = (e: DragEvent) => { e.preventDefault(); };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => { window.removeEventListener('dragover', swallow); window.removeEventListener('drop', swallow); };
  }, []);

  const addGroup = useCallback(() => {
    const size = { w: 480, h: 300 };
    const pos = viewportCenter(size.w, size.h);
    update((b) => ({ ...b, groups: [...b.groups, { id: uid(), title: t('canvas.group.new'), ...pos, ...size, toBrain: true, createdAt: new Date().toISOString() }] }));
  }, [update, viewportCenter, t]);

  const zoomBy = useCallback((factor: number, px?: number, py?: number) => {
    const r = boardRef.current?.getBoundingClientRect();
    const cx = px ?? (r ? r.width / 2 : 0);
    const cy = py ?? (r ? r.height / 2 : 0);
    setView((v) => {
      const nz = clampZoom(v.z * factor);
      if (nz === v.z) return v;
      return { z: nz, x: cx - (cx - v.x) * (nz / v.z), y: cy - (cy - v.y) * (nz / v.z) };
    });
  }, []);

  // --- Rueda: ctrl/⌘ = zoom, normal = pan (listener nativo para preventDefault) ---
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomBy(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // --- Teclado: espacio = mover, Delete = borrar seleccionada, Esc ---------------
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.code === 'Space') { e.preventDefault(); setSpace(true); }
      if (e.key === 'Escape') setSelected(null);
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { removeItem(selected); setSelected(null); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [selected, removeItem]);

  // --- Arrastre (window listeners mientras dura) --------------------------------
  const startDrag = useCallback((e: RPointerEvent, drag: Omit<Drag, 'sx' | 'sy'>) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { ...drag, sx: e.clientX, sy: e.clientY };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const z = viewRef.current.z;
      const dx = (ev.clientX - d.sx) / z;
      const dy = (ev.clientY - d.sy) / z;
      switch (d.type) {
        case 'pan':
          setView((v) => ({ ...v, x: d.ox + (ev.clientX - d.sx), y: d.oy + (ev.clientY - d.sy) }));
          break;
        case 'item':
          update((b) => ({ ...b, items: b.items.map((it) => (it.id === d.id ? { ...it, x: d.ox + dx, y: d.oy + dy } : it)) }));
          break;
        case 'group':
          update((b) => ({
            groups: b.groups.map((g) => (g.id === d.id ? { ...g, x: d.ox + dx, y: d.oy + dy } : g)),
            items: b.items.map((it) => (d.members?.[it.id] ? { ...it, x: d.members[it.id].x + dx, y: d.members[it.id].y + dy } : it)),
          }));
          break;
        case 'resize-item':
          update((b) => ({
            ...b,
            items: b.items.map((it) => {
              if (it.id !== d.id) return it;
              const min = it.kind === 'image' || it.kind === 'text' ? MIN_MEDIA : MIN_ITEM;
              if (d.ratio) {
                // La imagen conserva su proporción: manda el lado que más se movió.
                const w = Math.max(min.w, Math.abs(dx) > Math.abs(dy) ? d.ow + dx : (d.oh + dy) * d.ratio);
                return { ...it, w, h: Math.max(min.h, w / d.ratio) };
              }
              return { ...it, w: Math.max(min.w, d.ow + dx), h: Math.max(min.h, d.oh + dy) };
            }),
          }));
          break;
        case 'resize-group':
          update((b) => ({ ...b, groups: b.groups.map((g) => (g.id === d.id ? { ...g, w: Math.max(MIN_GROUP.w, d.ow + dx), h: Math.max(MIN_GROUP.h, d.oh + dy) } : g)) }));
          break;
      }
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!d) return;
      // Al soltar: la tarjeta cae en el grupo que contiene su centro; al mover/redimensionar
      // un grupo, se recalcula la pertenencia de todas.
      if (d.type === 'item') {
        update((b) => ({ ...b, items: b.items.map((it) => (it.id === d.id ? { ...it, groupId: groupAtCenter(it, b.groups) } : it)) }));
      } else if (d.type === 'group' || d.type === 'resize-group') {
        update((b) => ({ ...b, items: b.items.map((it) => ({ ...it, groupId: groupAtCenter(it, b.groups) })) }));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [update]);

  const onBoardDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    setSelected(null);
    startDrag(e, { type: 'pan', ox: viewRef.current.x, oy: viewRef.current.y, ow: 0, oh: 0 });
  };

  const onItemDown = (it: CanvasItem) => (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setSelected(it.id);
    if (tool === 'pan' || space) { startDrag(e, { type: 'pan', ox: viewRef.current.x, oy: viewRef.current.y, ow: 0, oh: 0 }); return; }
    startDrag(e, { type: 'item', id: it.id, ox: it.x, oy: it.y, ow: it.w, oh: it.h });
  };
  const onItemResize = (it: CanvasItem) => (e: RPointerEvent<HTMLDivElement>) =>
    startDrag(e, { type: 'resize-item', id: it.id, ox: it.x, oy: it.y, ow: it.w, oh: it.h, ratio: it.kind === 'image' ? (it.ratio ?? it.w / it.h) : undefined });

  const onGroupDown = (g: CanvasGroup) => (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !board) return;
    const members: Drag['members'] = {};
    for (const it of board.items) if (it.groupId === g.id) members[it.id] = { x: it.x, y: it.y };
    startDrag(e, { type: 'group', id: g.id, ox: g.x, oy: g.y, ow: g.w, oh: g.h, members });
  };
  const onGroupResize = (g: CanvasGroup) => (e: RPointerEvent<HTMLDivElement>) =>
    startDrag(e, { type: 'resize-group', id: g.id, ox: g.x, oy: g.y, ow: g.w, oh: g.h });

  // --- Chat ↔ tablero ------------------------------------------------------------
  const buildExtra = useCallback(() => {
    if (!board) return '';
    return dumpForBrain(board, {
      kind: { note: t('canvas.kind.note'), concept: t('canvas.kind.concept'), hook: t('canvas.kind.hook'), link: t('canvas.kind.link'), ai: t('canvas.badge.brain'), image: t('canvas.kind.image'), text: t('canvas.kind.text') },
      field: { angle: t('canvas.field.angle'), hook: t('canvas.field.hook'), format: t('canvas.field.format'), why: t('canvas.field.why') },
      loose: t('canvas.dump.loose'),
      group: t('canvas.dump.group'),
      imageFallback: t('canvas.image.fallback'),
    });
  }, [board, t]);

  const buildImages = useCallback(() => (board ? imagesForBrain(board) : []), [board]);

  const pinAnswer = useCallback((text: string) => addItem('ai', { text }), [addItem]);

  const createBatch = (it: CanvasItem) => {
    const m = it.meta ?? {};
    const q = new URLSearchParams({ new: '1', name: it.title ?? '', angle: m.angle ?? '', hook: m.hook ?? '', format: m.format ?? '' });
    router.push(`/workshop?${q.toString()}`);
  };

  const panning = tool === 'pan' || space;
  const statusKey = status === 'saving' ? 'canvas.status.saving' : status === 'error' ? 'canvas.status.error' : status === 'loading' ? 'canvas.status.loading' : 'canvas.status.saved';

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <div className="flex flex-col h-[calc(100dvh-52px)] lg:h-dvh">
        {/* Header row */}
        <div className="flex items-center gap-3 flex-wrap px-4 py-2 border-b border-line bg-surface">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-ink font-[family-name:var(--font-serif)] truncate">
              {t('canvas.title')}{activeBrand ? ` · ${activeBrand.name}` : ''}
              <span className={`ml-2 text-xs font-normal font-sans ${status === 'error' ? 'text-danger' : 'text-ink-4'}`}>
                {status === 'saving' && <Loader2 className="inline w-3 h-3 animate-spin mr-1" />}
                {status === 'saved' && <Check className="inline w-3 h-3 mr-1 text-ok" />}
                {t(statusKey)}
              </span>
            </h1>
            <p className="text-xs text-ink-3 truncate">{t('canvas.subtitle')}</p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {uploading > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-accent"><Loader2 className="w-3 h-3 animate-spin" />{t('canvas.image.uploading', { n: uploading })}</span>
            )}
            {upErr && (
              <button onClick={() => setUpErr(null)} className="inline-flex items-center gap-1 text-[11px] text-danger max-w-[260px] truncate" title={upErr}>
                <AlertTriangle className="w-3 h-3 shrink-0" /><span className="truncate">{upErr}</span>
              </button>
            )}
            <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-ink-4"><ArrowRight className="w-3 h-3" />{t('canvas.hint.production')}</span>
            <div className="inline-flex items-center rounded-md border border-line bg-surface">
              <button onClick={() => zoomBy(0.8)} disabled={view.z <= ZOOM_MIN} className="p-1.5 text-ink-3 hover:text-ink disabled:opacity-40" title={t('canvas.zoom.out')}><Minus className="w-3.5 h-3.5" /></button>
              <button onClick={() => setView((v) => ({ ...v, z: 1 }))} className="px-1.5 text-[11px] font-[family-name:var(--font-mono)] tabular-nums text-ink-2 w-12 text-center" title={t('canvas.zoom.reset')}>{Math.round(view.z * 100)}%</button>
              <button onClick={() => zoomBy(1.25)} disabled={view.z >= ZOOM_MAX} className="p-1.5 text-ink-3 hover:text-ink disabled:opacity-40" title={t('canvas.zoom.in')}><Plus className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
          {/* Toolbar */}
          <nav className="flex sm:flex-col items-center gap-0.5 p-1.5 border-b sm:border-b-0 sm:border-r border-line bg-surface overflow-x-auto sm:overflow-visible shrink-0">
            <button onClick={() => setTool('select')} className={`${toolBtn} ${tool === 'select' ? toolActive : ''}`} title={t('canvas.tool.select')}>
              <MousePointer2 className="w-4 h-4" /><span className="sm:hidden">{t('canvas.tool.select')}</span>
            </button>
            <button onClick={() => setTool('pan')} className={`${toolBtn} ${tool === 'pan' ? toolActive : ''}`} title={t('canvas.tool.pan')}>
              <Hand className="w-4 h-4" /><span className="sm:hidden">{t('canvas.tool.pan')}</span>
            </button>
            <div className="w-px h-5 sm:w-5 sm:h-px bg-line mx-1 sm:mx-0 sm:my-1 shrink-0" />
            {ADD_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <button key={k} onClick={() => addItem(k)} disabled={!board} className={`${toolBtn} disabled:opacity-40`} title={t(`canvas.tool.${k}`)}>
                  <Icon className="w-4 h-4" /><span className="sm:hidden">{t(`canvas.tool.${k}`)}</span>
                </button>
              );
            })}
            <button onClick={() => fileInput.current?.click()} disabled={!board} className={`${toolBtn} disabled:opacity-40`} title={t('canvas.tool.image')}>
              <ImagePlus className="w-4 h-4" /><span className="sm:hidden">{t('canvas.tool.image')}</span>
            </button>
            <button onClick={addGroup} disabled={!board} className={`${toolBtn} disabled:opacity-40`} title={t('canvas.tool.group')}>
              <Square className="w-4 h-4" /><span className="sm:hidden">{t('canvas.tool.group')}</span>
            </button>
            <div className="w-px h-5 sm:w-5 sm:h-px bg-line mx-1 sm:mx-0 sm:my-1 shrink-0" />
            <button onClick={() => setChatOpen((o) => !o)} className={`${toolBtn} ${chatOpen ? toolActive : ''}`} title={t('canvas.tool.brain')}>
              <BrainCircuit className="w-4 h-4" /><span className="sm:hidden">{t('canvas.tool.brain')}</span>
            </button>
          </nav>

          {/* Board */}
          <div
            ref={boardRef}
            onPointerDown={onBoardDown}
            onPointerMove={(e) => { pointerRef.current = { x: e.clientX, y: e.clientY }; }}
            onPointerLeave={() => { pointerRef.current = null; }}
            onDragOver={(e) => { e.preventDefault(); if (!dropping) setDropping(true); }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setDropping(false);
              const at = worldPoint(e.clientX, e.clientY) ?? undefined;
              const files = Array.from(e.dataTransfer.files ?? []);
              if (files.length > 0) { void addImages(files, at); return; }
              const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).trim();
              if (!url) return;
              if (/^https?:\/\//i.test(url)) addItem(/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) ? 'image' : 'link', { url }, at);
              else addItem('note', { text: url }, at);
            }}
            className={`relative flex-1 min-h-0 min-w-0 overflow-hidden touch-none select-none bg-canvas ${panning ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${dropping ? 'ring-2 ring-inset ring-accent' : ''}`}
            style={{
              backgroundImage: 'radial-gradient(var(--color-line-strong) 1px, transparent 1px)',
              backgroundSize: `${GRID * view.z}px ${GRID * view.z}px`,
              backgroundPosition: `${view.x}px ${view.y}px`,
            }}
          >
            {dropping && (
              <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none bg-accent-soft/30">
                <span className="rounded-lg border border-accent bg-surface px-3 py-1.5 text-xs text-accent shadow-sm">{t('canvas.image.drop')}</span>
              </div>
            )}
            {!board && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-3">
                {status === 'error' ? t('canvas.status.error') : !brandId ? t('canvas.noBrand') : <Loader2 className="w-5 h-5 animate-spin" />}
              </div>
            )}
            {board && (
              <div className="absolute left-0 top-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transformOrigin: '0 0' }}>
                {board.groups.map((g) => (
                  <GroupFrame key={g.id} g={g} t={t} count={board.items.filter((it) => it.groupId === g.id).length}
                    onHeaderDown={onGroupDown(g)} onResizeDown={onGroupResize(g)}
                    onChange={(p) => patchGroup(g.id, p)} onDelete={() => removeGroup(g.id)} />
                ))}
                {sortForRender(board.items).map((it) => (
                  <CanvasCard key={it.id} item={it} selected={selected === it.id} t={t}
                    onChange={(p) => patchItem(it.id, p)} onDelete={() => { removeItem(it.id); if (selected === it.id) setSelected(null); }}
                    onHeaderDown={onItemDown(it)} onResizeDown={onItemResize(it)}
                    onCreateBatch={it.kind === 'concept' ? () => createBatch(it) : undefined} />
                ))}
              </div>
            )}
          </div>
        </div>

        <input ref={fileInput} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void addImages(files); }} />

        {brandId && (
          <CanvasChat brandId={brandId} t={t} buildExtra={buildExtra} buildImages={buildImages} onPin={pinAnswer} open={chatOpen} onToggle={() => setChatOpen((o) => !o)} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function GroupFrame({ g, t, count, onHeaderDown, onResizeDown, onChange, onDelete }: {
  g: CanvasGroup; t: (k: string, v?: Record<string, string | number>) => string; count: number;
  onHeaderDown: (e: RPointerEvent<HTMLDivElement>) => void;
  onResizeDown: (e: RPointerEvent<HTMLDivElement>) => void;
  onChange: (p: Partial<CanvasGroup>) => void;
  onDelete: () => void;
}) {
  const on = groupSendsToBrain(g);
  const stop = (e: RPointerEvent) => e.stopPropagation();
  return (
    <div className={`absolute rounded-2xl border-2 border-dashed pointer-events-none ${on ? 'border-accent/40 bg-accent-soft/20' : 'border-line-strong bg-surface-2/40'}`}
      style={{ left: g.x, top: g.y, width: g.w, height: g.h }}>
      <div onPointerDown={onHeaderDown}
        className="pointer-events-auto absolute -top-4 left-3 right-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1 shadow-sm cursor-grab active:cursor-grabbing touch-none">
        <input value={g.title} onChange={(e) => onChange({ title: e.target.value })} onPointerDown={stop} placeholder={t('canvas.group.title')}
          className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-ink placeholder:text-ink-4 focus:outline-none" />
        <span className="text-[10px] text-ink-4 font-[family-name:var(--font-mono)] tabular-nums shrink-0">{count}</span>
        <button onClick={() => onChange({ toBrain: !on })} onPointerDown={stop} title={t('canvas.group.toBrain.help')}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] whitespace-nowrap shrink-0 ${on ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-4'}`}>
          <BrainCircuit className="w-3 h-3" />{t('canvas.group.toBrain')}{on ? ` ✓` : ''}
        </button>
        <button onClick={onDelete} onPointerDown={stop} className="p-0.5 rounded text-ink-4 hover:text-danger shrink-0" title={t('canvas.group.delete')}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div onPointerDown={onResizeDown} className="pointer-events-auto absolute right-0 bottom-0 w-5 h-5 cursor-nwse-resize touch-none">
        <div className="absolute right-1.5 bottom-1.5 w-2 h-2 border-r-2 border-b-2 border-ink-4 rounded-br-sm" />
      </div>
    </div>
  );
}
