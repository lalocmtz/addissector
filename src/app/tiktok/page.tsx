'use client';

// =============================================================================
// /tiktok — el modo TikTok Shop.
//
// Un vendedor de TikTok Shop no trabaja como una marca DTC. No tiene una cuenta
// publicitaria ni un ROAS: tiene PRODUCTOS, y de cada producto tiene videos que
// vendieron y videos que no. Su trabajo real —el que hoy hace en carpetas y en
// la cabeza— es mirar los que sí funcionaron, entender por qué, y repetir la
// mecánica con el siguiente producto.
//
// Esta pantalla es eso y nada más: producto → sus videos → el desmenuzado de
// cada uno → el destilado para pegarle a una IA. Sin métricas de venta, a
// propósito: lo que hace útil una biblioteca no es guardarlo todo, es que el
// humano marque cuáles ganaron. Esa marca es el único juicio que la máquina no
// puede hacer sola, y es de donde sale todo lo demás.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, X, Loader2, Upload, Sparkles, Copy, CheckCircle2, Trophy,
  ChevronDown, ChevronRight, AlertTriangle, Trash2,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { createBrowserClient } from '@/lib/supabase-browser';
import { usePendingWarning } from '@/lib/pending-saves';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface Producto {
  id: string; name: string | null; category: string | null;
  notes: string | null; mechanism: string | null; status: string | null;
}

interface Beat { t: number; what: string; role: string }

interface Video {
  id: string; product_id: string | null; title: string | null;
  storage_path: string | null; duration: number | null;
  origin: string; winner: boolean;
  transcript: string | null; hook: string | null; headline: string | null;
  framework: string | null; why_worked: string | null;
  beats: Beat[] | null; analyzed_at: string | null; notes: string | null;
  created_at: string;
}

const INPUT = 'w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-4 focus:border-accent outline-none';

// ---------------------------------------------------------------------------

export default function TikTokPage() {
  usePendingWarning();
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();
  const esTikTok = activeBrand?.kind === 'tiktok_shop';

  return (
    <main className="flex-1 min-h-screen">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />
      <section className="px-4 sm:px-6 py-6">
        <div className="max-w-[1400px] mx-auto">
          {!activeBrandId ? null : !esTikTok ? (
            <div className="rounded-xl border border-dashed border-line bg-surface p-10 text-center">
              <p className="text-sm text-ink-2 max-w-lg mx-auto leading-relaxed">
                Esta pantalla es para las marcas de tipo <strong>TikTok Shop</strong>.
                {' '}<strong>{activeBrand?.name}</strong> está configurada como marca con cuenta de Meta,
                así que su trabajo vive en Producción y Meta.
              </p>
            </div>
          ) : (
            <Vendedor key={activeBrandId} brandId={activeBrandId} brandName={activeBrand?.name ?? ''} />
          )}
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// El vendedor: lista de productos + el producto abierto
// ---------------------------------------------------------------------------

function Vendedor({ brandId, brandName }: { brandId: string; brandName: string }) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    await Promise.resolve();
    try {
      const r = await fetch(`/api/tiktok/products?brand=${brandId}`);
      const d = (await r.json().catch(() => ({}))) as { items?: Producto[]; error?: string };
      if (!r.ok) throw new Error(d.error ?? `El servidor respondió ${r.status}`);
      setProductos(d.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los productos');
    } finally {
      setCargando(false);
    }
  }, [brandId]);

  useEffect(() => { void Promise.resolve().then(cargar); }, [cargar]);

  const crear = async () => {
    const r = await fetch('/api/tiktok/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId, name: 'Producto nuevo' }),
    });
    const d = (await r.json().catch(() => ({}))) as { item?: Producto; error?: string };
    if (!r.ok) { setError(d.error ?? 'No se pudo crear'); return; }
    await cargar();
    if (d.item?.id) setSel(d.item.id);
  };

  const guardar = async (id: string, payload: Record<string, unknown>) => {
    setProductos((p) => p.map((x) => (x.id === id ? { ...x, ...payload } as Producto : x)));
    const r = await fetch('/api/tiktok/products', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...payload }),
    });
    return r.ok;
  };

  const borrar = async (id: string) => {
    setProductos((p) => p.filter((x) => x.id !== id));
    if (sel === id) setSel(null);
    await fetch(`/api/tiktok/products?id=${id}`, { method: 'DELETE' });
  };

  const activo = useMemo(() => productos.find((p) => p.id === sel) ?? productos[0] ?? null, [productos, sel]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-lg font-bold font-[family-name:var(--font-serif)] tracking-tight">
            Productos · {brandName}
          </h1>
          <p className="text-xs text-ink-3 mt-0.5 max-w-2xl">
            Un producto, sus videos que funcionaron, y por qué funcionaron. Marca los ganadores:
            de ahí sale el destilado que le pegas a la IA para escribir los siguientes.
          </p>
        </div>
        <button onClick={() => void crear()} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-on-accent shrink-0">
          <Plus className="w-3.5 h-3.5" /> Agregar producto
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm text-danger flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto shrink-0"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {cargando ? (
        <div className="flex items-center gap-2 text-xs text-ink-4 py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      ) : productos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface p-10 text-center">
          <p className="text-sm text-ink-4 max-w-lg mx-auto leading-relaxed">
            Empieza por un producto. El aceite de orégano, la faja, lo que estés vendiendo.
            Cada uno tiene su propia biblioteca de videos y sus propios frameworks.
          </p>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-5 items-start">
          <div className="w-full lg:w-64 shrink-0 lg:sticky lg:top-4 space-y-1">
            {productos.map((p) => {
              const on = activo?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSel(p.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                    on ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong'
                  }`}
                >
                  <p className={`text-sm font-medium break-words ${on ? 'text-ink' : 'text-ink-2'}`}>
                    {p.name ?? 'Sin nombre'}
                  </p>
                  {p.category && <p className="text-[11px] text-ink-4 mt-0.5">{p.category}</p>}
                </button>
              );
            })}
          </div>

          {activo && (
            <ProductoFicha
              key={activo.id}
              brandId={brandId}
              producto={activo}
              onSave={(payload) => guardar(activo.id, payload)}
              onRemove={() => { if (confirm('¿Eliminar este producto y sus videos?')) void borrar(activo.id); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Un producto: su ficha, sus videos y su destilado
// ---------------------------------------------------------------------------

function ProductoFicha({ brandId, producto, onSave, onRemove }: {
  brandId: string;
  producto: Producto;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    await Promise.resolve();
    try {
      const r = await fetch(`/api/tiktok/videos?brand=${brandId}&product=${producto.id}`);
      const d = (await r.json().catch(() => ({}))) as { items?: Video[] };
      setVideos(d.items ?? []);
    } catch { setVideos([]); }
    finally { setCargando(false); }
  }, [brandId, producto.id]);

  useEffect(() => { void Promise.resolve().then(cargar); }, [cargar]);

  /** Sube el archivo al bucket, crea la fila y dispara el desmenuzado. */
  const subir = async (files: FileList) => {
    for (const file of Array.from(files)) {
      setSubiendo(file.name);
      setError(null);
      try {
        const u = await fetch('/api/tiktok/upload-url', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandId, filename: file.name }),
        });
        const j = (await u.json()) as { path?: string; token?: string; bucket?: string; error?: string };
        if (!u.ok || !j.path || !j.token) throw new Error(j.error ?? 'No se pudo preparar la subida');

        const sb = createBrowserClient();
        const up = await sb.storage.from(j.bucket ?? 'creative-videos')
          .uploadToSignedUrl(j.path, j.token, file, { contentType: file.type || undefined });
        if (up.error) throw new Error(up.error.message);

        const c = await fetch('/api/tiktok/videos', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            brandId, productId: producto.id, storage_path: j.path,
            title: file.name.replace(/\.[^.]+$/, ''), origin: 'referencia',
          }),
        });
        const cj = (await c.json()) as { item?: Video; error?: string };
        if (!c.ok || !cj.item) throw new Error(cj.error ?? 'No se pudo guardar el video');
        setVideos((v) => [cj.item!, ...v]);
        // El desmenuzado corre solo: subir sin analizar deja una carpeta, no una biblioteca.
        void analizar(cj.item.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Falló la subida');
      } finally {
        setSubiendo(null);
        if (fileRef.current) fileRef.current.value = '';
      }
    }
  };

  const analizar = async (id: string) => {
    setVideos((v) => v.map((x) => (x.id === id ? { ...x, analyzed_at: null, framework: 'analizando…' } : x)));
    try {
      const r = await fetch('/api/tiktok/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: id, force: true }),
      });
      const d = (await r.json().catch(() => ({}))) as { item?: Video; error?: string };
      if (!r.ok) throw new Error(d.error ?? 'Falló el análisis');
      if (d.item) setVideos((v) => v.map((x) => (x.id === id ? { ...x, ...d.item } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falló el análisis');
      setVideos((v) => v.map((x) => (x.id === id ? { ...x, framework: null } : x)));
    }
  };

  const patch = async (id: string, payload: Record<string, unknown>) => {
    setVideos((v) => v.map((x) => (x.id === id ? { ...x, ...payload } as Video : x)));
    await fetch('/api/tiktok/videos', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...payload }),
    });
  };

  const borrarVideo = async (id: string) => {
    setVideos((v) => v.filter((x) => x.id !== id));
    await fetch(`/api/tiktok/videos?id=${id}`, { method: 'DELETE' });
  };

  const ganadores = videos.filter((v) => v.winner).length;

  return (
    <div className="flex-1 min-w-0 space-y-5">
      {/* Ficha del producto */}
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-2">
            <input
              defaultValue={producto.name ?? ''}
              onBlur={(e) => void onSave({ name: e.target.value.trim() || 'Producto sin nombre' })}
              placeholder="Nombre del producto"
              className="w-full bg-transparent text-lg font-semibold text-ink outline-none border-b border-transparent focus:border-accent"
            />
            <input
              defaultValue={producto.category ?? ''}
              onBlur={(e) => void onSave({ category: e.target.value.trim() })}
              placeholder="Categoría (salud, belleza, hogar…)"
              className={INPUT}
            />
          </div>
          <button onClick={onRemove} className="text-ink-4 hover:text-danger shrink-0 mt-1" title="Eliminar producto">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Campo label="Qué es y por qué se vende" value={producto.notes} rows={4}
            placeholder="En tus palabras: qué resuelve y a quién le urge"
            onSave={(v) => onSave({ notes: v })} />
          <Campo label="Mecanismo — por qué funciona de verdad" value={producto.mechanism} rows={4}
            placeholder="El ingrediente, la característica o el proceso que lo hace funcionar"
            onSave={(v) => onSave({ mechanism: v })} />
        </div>
      </div>

      <Destilado productId={producto.id} ganadores={ganadores} />

      {/* Biblioteca */}
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-ink">Videos</h2>
            <p className="text-xs text-ink-4 mt-0.5">
              {videos.length} guardado{videos.length === 1 ? '' : 's'} · {ganadores} marcado{ganadores === 1 ? '' : 's'} como ganador
              {ganadores === 0 && videos.length > 0 && ' — marca los que sí vendieron, es de donde sale todo'}
            </p>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={Boolean(subiendo)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-line text-ink-2 hover:text-ink disabled:opacity-60 shrink-0"
          >
            {subiendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {subiendo ? `Subiendo ${subiendo.slice(0, 20)}…` : 'Subir videos'}
          </button>
          <input ref={fileRef} type="file" accept="video/*" multiple className="hidden"
            onChange={(e) => e.target.files?.length && void subir(e.target.files)} />
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-xs text-danger flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto shrink-0"><X className="w-3 h-3" /></button>
          </div>
        )}

        {cargando ? (
          <p className="text-xs text-ink-4 py-6 text-center">Cargando…</p>
        ) : videos.length === 0 ? (
          <p className="text-xs text-ink-4 py-8 text-center max-w-md mx-auto leading-relaxed">
            Sube los videos que ya viste funcionar. Cada uno se desmenuza solo: la primera frase,
            el texto en pantalla, la estructura segundo a segundo y por qué hace comprar.
          </p>
        ) : (
          <div className="space-y-2">
            {videos.map((v) => (
              <VideoFila
                key={v.id}
                video={v}
                onPatch={(p) => void patch(v.id, p)}
                onAnalizar={() => void analizar(v.id)}
                onRemove={() => { if (confirm('¿Eliminar este video de la biblioteca?')) void borrarVideo(v.id); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function VideoFila({ video: v, onPatch, onAnalizar, onRemove }: {
  video: Video;
  onPatch: (payload: Record<string, unknown>) => void;
  onAnalizar: () => void;
  onRemove: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const analizando = v.framework === 'analizando…';

  return (
    <div className={`rounded-lg border ${v.winner ? 'border-ok/40 bg-ok-soft/30' : 'border-line bg-canvas'}`}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button onClick={() => setAbierto((x) => !x)} className="text-ink-4 hover:text-ink-1 mt-0.5 shrink-0">
          {abierto ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={() => onPatch({ winner: !v.winner })}
          title={v.winner ? 'Quitar de ganadores' : 'Marcar como ganador'}
          className={`shrink-0 mt-0.5 ${v.winner ? 'text-ok' : 'text-ink-4 hover:text-ok'}`}
        >
          <Trophy className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <input
            defaultValue={v.title ?? ''}
            onBlur={(e) => onPatch({ title: e.target.value })}
            placeholder="Título del video"
            className="w-full bg-transparent text-sm text-ink outline-none"
          />
          <p className="text-[11px] text-ink-4 break-words leading-snug">
            {analizando ? (
              <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Desmenuzando…</span>
            ) : v.framework ? (
              <span className="text-ink-3">{v.framework}</span>
            ) : v.analyzed_at ? (
              'Sin framework detectado'
            ) : (
              'Sin analizar'
            )}
            {v.duration ? ` · ${Math.round(v.duration)}s` : ''}
            {v.origin === 'mio' ? ' · mío' : ''}
          </p>
        </div>

        <select
          value={v.origin}
          onChange={(e) => onPatch({ origin: e.target.value })}
          className="text-[11px] rounded border border-line bg-canvas px-1.5 py-1 text-ink-3 shrink-0"
        >
          <option value="referencia">Referencia</option>
          <option value="mio">Mío</option>
        </select>

        <button onClick={onAnalizar} disabled={analizando} className="text-ink-4 hover:text-accent shrink-0 mt-0.5 disabled:opacity-40" title="Volver a desmenuzar">
          <Sparkles className="w-3.5 h-3.5" />
        </button>
        <button onClick={onRemove} className="text-ink-4 hover:text-danger shrink-0 mt-0.5" title="Eliminar">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {abierto && (
        <div className="px-3 pb-3 pt-1 border-t border-line/60 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Campo label="Primera frase (lo que se dice)" value={v.hook} rows={2}
              placeholder="La primera frase, palabra por palabra" onSave={(x) => onPatch({ hook: x })} />
            <Campo label="Primer texto en pantalla" value={v.headline} rows={2}
              placeholder="Lo que se lee en el primer segundo" onSave={(x) => onPatch({ headline: x })} />
          </div>
          <Campo label="Framework" value={analizando ? '' : v.framework} rows={2}
            placeholder="Nombre corto de la estructura, para poder pedirla otra vez"
            onSave={(x) => onPatch({ framework: x })} />
          <Campo label="Por qué funcionó" value={v.why_worked} rows={3}
            placeholder="La palanca real: prueba visible, urgencia, identificación…"
            onSave={(x) => onPatch({ why_worked: x })} />

          {v.beats && v.beats.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1.5">Estructura</p>
              <div className="space-y-1">
                {v.beats.map((b, i) => (
                  <div key={i} className="flex gap-2 text-[11px] leading-snug">
                    <span className="font-[family-name:var(--font-mono)] tabular-nums text-ink-4 shrink-0 w-8">{b.t}s</span>
                    <span className="text-accent shrink-0 w-24 truncate">{b.role}</span>
                    <span className="text-ink-3 min-w-0 break-words">{b.what}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Campo label="Mi nota" value={v.notes} rows={2}
            placeholder="Lo que tú viste y la IA no" onSave={(x) => onPatch({ notes: x })} />

          {v.transcript && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-ink-4 hover:text-ink-2">Transcripción</summary>
              <p className="mt-1.5 text-ink-3 whitespace-pre-wrap break-words leading-relaxed">{v.transcript}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Destilado({ productId, ganadores }: { productId: string; ganadores: number }) {
  const [prompt, setPrompt] = useState('');
  const [cargando, setCargando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [abierto, setAbierto] = useState(false);

  const traer = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch(`/api/tiktok/digest?product=${productId}`);
      const d = (await r.json().catch(() => ({}))) as { prompt?: string };
      setPrompt(d.prompt ?? '');
    } catch { setPrompt(''); }
    finally { setCargando(false); }
  }, [productId]);

  // Se recalcula cuando cambia el número de ganadores: es su única entrada.
  useEffect(() => { void Promise.resolve().then(traer); }, [traer, ganadores]);

  const copiar = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* sin portapapeles: queda el textarea */ }
  };

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Sparkles className="w-4 h-4 text-accent shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Destilado del producto</p>
          <p className="text-[11px] text-ink-4 break-words">
            {ganadores === 0
              ? 'Marca videos como ganadores y aquí sale el bloque para pegarle a la IA.'
              : `Los ${ganadores} ganadores, sus frameworks y su estructura, listos para pegar.`}
          </p>
        </div>
        <button
          onClick={() => void copiar()}
          disabled={!prompt || cargando}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-on-accent disabled:opacity-50 shrink-0"
        >
          {copiado ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      {prompt && (
        <div className="px-4 pb-4">
          <button onClick={() => setAbierto((x) => !x)} className="flex items-center gap-1 text-[11px] text-ink-4 hover:text-ink-2 mb-2">
            {abierto ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {abierto ? 'Ocultar el texto' : 'Ver el texto antes de copiarlo'}
          </button>
          {abierto && (
            <textarea
              readOnly value={prompt} rows={16}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[11px] leading-relaxed text-ink-2 font-[family-name:var(--font-mono)] resize-y"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Campo de texto que guarda al salir. Sencillo a propósito: aquí no hay
 *  cientos de campos abiertos como en el Cerebro. */
function Campo({ label, value, rows = 2, placeholder, onSave }: {
  label?: string; value: string | null; rows?: number; placeholder?: string;
  onSave: (v: string) => void | Promise<unknown>;
}) {
  return (
    <div className="min-w-0">
      {label && <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1">{label}</p>}
      <textarea
        defaultValue={value ?? ''}
        rows={rows}
        placeholder={placeholder}
        onBlur={(e) => void onSave(e.target.value)}
        className={`${INPUT} resize-y leading-relaxed`}
      />
    </div>
  );
}
