'use client';

// =============================================================================
// AdDNA — CEREBRO de la marca.
// El banco de todo lo que cimenta un buen anuncio, en pestañas:
// Chat · Personas · Ángulos · Hooks · Aprendizajes · Fuentes.
// El chat sigue igual (contexto completo: cerebro + ganadores + aprendizajes).
// "Ángulos" muestra de dónde salió cada uno y cómo le fue con dinero real
// (últimos 30 días de /api/library). "Fuentes" junta documentos, notas y
// búsqueda web. Los conceptos ya no viven aquí: se producen en Producción.
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Loader2, Send, Trash2, Plus, X, Brain, Lightbulb, ChevronDown, ChevronRight, Save,
  FileText, Upload, Users, Compass, Zap, CheckCircle2, Globe, Search, Sparkles, PenLine,
  Copy, ArrowLeftRight, AlertTriangle,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import BrainSync from '@/components/BrainSync';
import Sheet, { type SheetCol } from '@/components/Sheet';
import { createBrowserClient } from '@/lib/supabase-browser';
import { beginPending, endPending, usePendingWarning } from '@/lib/pending-saves';
import { useMe } from '@/lib/use-me';
import { ANGLE_STATUS, AWARENESS_STAGES } from '@/lib/plan';
import { fmtMoney, resolveEconomics, type Economics } from '@/lib/meta';

/** Redondeo de ROAS para mostrar. */
const fmtRoas = (r: number | null) => (r == null ? '—' : `x${r.toFixed(2)}`);

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface Msg { id?: string; role: 'user' | 'assistant'; content: string }
interface Section { id: string; title: string; content: string; sort: number }
interface Learning {
  id: string; text: string; evidence: string | null; source_ad: string | null;
  active: boolean; source: string | null; created_at?: string | null;
  status?: string | null; suspect?: boolean | null;
  dimension?: string | null; dimension_value?: string | null;
}
interface Persona {
  id: string; name: string | null; description: string | null; pains: string | null;
  desires: string | null; objections: string | null; awareness_stage: string | null;
  callout: string | null; education_gap: string | null; solutions: string | null; offer_fit: string | null;
  evidence: string | null; status: string | null; source: string | null;
}
interface Angle {
  id: string; code: string | null; name: string | null; persona_id: string | null;
  // La biblioteca de conceptos: qué es, un ejemplo y la referencia visual.
  definition: string | null; example: string | null;
  reference_url: string | null; reference_kind: string | null;
  pain: string | null; mechanism: string | null; psychology: string | null; objection: string | null;
  status: string | null; evidence: string | null; source: string | null;
  // Estaban en la tabla y en el GET, pero no en el tipo ni en la UI: datos que
  // nadie podia leer ni corregir.
  desire: string | null; learnings: string | null; awareness_stage: string | null;
}
/** Fila de /api/library. Todo opcional: la ruta la está reescribiendo otro agente. */
interface LibAd {
  ad_id?: string; ad_name?: string | null; spend?: number | null; purchases?: number | null;
  revenue?: number | null; angle_id?: string | null;
  // Con qué avatar se produjo ese anuncio. Lo llena el clasificador al analizar,
  // así que la columna "Avatares" de Conceptos se alimenta sola.
  persona_id?: string | null; persona?: string | null; thumbnail_url?: string | null;
}
interface AngleStats { n: number; spend: number; purchases: number; revenue: number; roas: number | null; cpa: number | null }
interface Note {
  id: string; kind: string; title: string; body: string | null;
  source: string | null; evidence: string | null; status: string; created_at: string;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'chat', label: 'Chat', icon: Brain },
  { id: 'personas', label: 'Personas', icon: Users },
  { id: 'conceptos', label: 'Conceptos', icon: Compass },
  { id: 'hooks', label: 'Hooks', icon: Zap },
  { id: 'aprendizajes', label: 'Aprendizajes', icon: Lightbulb },
  { id: 'fuentes', label: 'Fuentes', icon: Globe },
] as const;

/** Pestañas viejas que pueden seguir en links guardados. */
/** Pestañas viejas que pueden seguir en links guardados. `angulos` se quedó en
 *  marcadores y en el historial: sigue funcionando y cae en Conceptos. */
const TAB_ALIASES: Record<string, TabId> = { pruebas: 'aprendizajes', externo: 'fuentes', angulos: 'conceptos' };

type TabId = (typeof TABS)[number]['id'];

const SUGGESTIONS = [
  'Dame 3 guiones nuevos basados en lo que está funcionando ahora',
  '¿Qué patrón comparten mis ganadores actuales?',
  '¿Qué anuncio debería iterar primero y cómo?',
  'Escríbeme 5 hooks nuevos con el ángulo de mi mejor anuncio',
];

const RESEARCH_QUICK = [
  'Busca reseñas reales de productos como el mío: ¿qué palabras usan los clientes felices?',
  'Encuentra las dudas y objeciones más comunes antes de comprar este tipo de producto',
  '¿Qué ángulos están usando los competidores en sus anuncios ahora?',
  'Dame 5 ángulos nuevos que NO estoy usando, basados en lo que ya funciona',
];

const NOTE_STATUS = [
  { id: 'idea', label: 'Idea', cls: 'border-line-strong text-ink-3' },
  { id: 'en_prueba', label: 'En prueba', cls: 'border-warn/40 text-warn' },
  { id: 'funciona', label: 'Funciona', cls: 'border-ok/40 text-ok' },
  { id: 'descartado', label: 'Descartado', cls: 'border-danger/40 text-danger' },
] as const;

const INPUT_CLS =
  'w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-4 focus:border-accent outline-none';

// ---------------------------------------------------------------------------
// Piezas reutilizables
// ---------------------------------------------------------------------------

/** Campo que se guarda solo mientras escribes (debounce) y tambien al salir.
 *
 *  Antes guardaba SOLO en onBlur: escribir y recargar sin hacer clic fuera
 *  perdia el texto en silencio. Ahora hay debounce de 1.2 s, indicador visible
 *  por campo y, con `validate`, el valor invalido ni siquiera se manda.
 *  Sigue sin controlar el valor para no provocar parpadeo al teclear. */
function Field({ label, value, placeholder, rows, mono, validate, onSave }: {
  label?: string;
  value: string | null;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  /** Devuelve el mensaje de error, o null si el valor es valido. */
  validate?: (v: string) => string | null;
  onSave: (v: string) => void | Promise<unknown>;
}) {
  const [estado, setEstado] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [aviso, setAviso] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimo = useRef((value ?? '').trim());
  const sucio = useRef(false);

  const limpiar = useCallback(() => {
    if (sucio.current) { sucio.current = false; endPending(); }
  }, []);

  const guardar = useCallback(async (raw: string) => {
    const v = raw.trim();
    if (v === ultimo.current) { limpiar(); setEstado('idle'); return; }
    const err = validate ? validate(v) : null;
    if (err) { setEstado('error'); setAviso(err); return; }
    setAviso(null);
    setEstado('saving');
    try {
      const r = await onSave(v);
      if (r === false) throw new Error('rechazado');
      ultimo.current = v;
      setEstado('saved');
    } catch {
      setEstado('error');
      setAviso('No se guardó. Vuelve a intentarlo.');
    } finally {
      limpiar();
    }
  }, [onSave, validate, limpiar]);

  const alEscribir = (raw: string) => {
    if (!sucio.current) { sucio.current = true; beginPending(); }
    setEstado('idle');
    setAviso(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void guardar(raw); }, 1200);
  };

  const alSalir = (raw: string) => {
    if (timer.current) clearTimeout(timer.current);
    void guardar(raw);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const etiqueta = estado === 'saving' ? 'Guardando…'
    : estado === 'saved' ? 'Guardado'
    : estado === 'error' ? 'Error'
    : null;
  const cls = estado === 'error' ? 'text-danger' : estado === 'saved' ? 'text-ok' : 'text-ink-4';

  return (
    <div className="w-full min-w-0">
      {(label || etiqueta) && (
        <div className="flex items-center justify-between gap-2 mb-1">
          {label
            ? <p className="text-[10px] uppercase tracking-wide text-ink-4">{label}</p>
            : <span />}
          {etiqueta && <span className={`text-[10px] ${cls}`}>{etiqueta}</span>}
        </div>
      )}
      {rows ? (
        <textarea
          defaultValue={value ?? ''}
          placeholder={placeholder}
          rows={rows}
          onChange={(e) => alEscribir(e.target.value)}
          onBlur={(e) => alSalir(e.target.value)}
          className={`${INPUT_CLS} resize-y leading-relaxed`}
        />
      ) : (
        <input
          defaultValue={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => alEscribir(e.target.value)}
          onBlur={(e) => alSalir(e.target.value)}
          className={`${INPUT_CLS}${mono ? ' font-[family-name:var(--font-mono)] uppercase tracking-wide' : ''}`}
        />
      )}
      {aviso && <p className="text-[10px] text-danger mt-1 break-words">{aviso}</p>}
    </div>
  );
}

/** ¿Lo detectó la plataforma sola (IA / clasificador / Meta) o lo escribió Eduardo? */
function isAiSource(source: string | null | undefined): boolean {
  return source === 'ia' || source === 'classifier' || source === 'meta';
}

/** Chip chico de origen: IA o manual. */
function SourceChip({ source }: { source: string | null | undefined }) {
  return isAiSource(source) ? (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-accent/40 bg-accent-soft text-accent shrink-0">
      <Sparkles className="w-2.5 h-2.5" /> IA
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-line text-ink-3 shrink-0">
      <PenLine className="w-2.5 h-2.5" /> Manual
    </span>
  );
}

/** Línea de origen explícita, en texto. Debajo, la evidencia (si hay) en letra chica. */
function IaMark({ source, evidence }: { source: string | null; evidence?: string | null }) {
  const ai = isAiSource(source);
  return (
    <div className="space-y-1 min-w-0">
      <p className="text-[11px] text-ink-3 flex items-center gap-1.5 min-w-0">
        <SourceChip source={source} />
        <span className="truncate">
          {ai ? 'Origen: detectado por IA en los anuncios de Meta' : 'Origen: creado a mano'}
        </span>
      </p>
      {ai && evidence && (
        <p className="text-[10px] text-ink-4 leading-snug whitespace-pre-wrap break-words">{evidence}</p>
      )}
    </div>
  );
}

/** Cabecera de pestaña: título + UNA frase de para qué sirve. */
function TabHead({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-bold font-[family-name:var(--font-serif)] tracking-tight">{title}</h1>
        <p className="text-xs text-ink-3 mt-0.5 max-w-2xl break-words">{hint}</p>
      </div>
      {action}
    </div>
  );
}

/** Subtítulo de sección dentro de una pestaña. */
function SectionHead({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        <p className="text-xs text-ink-4 mt-0.5 break-words">{hint}</p>
      </div>
      {action}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-10 text-center">
      <p className="text-sm text-ink-4 max-w-lg mx-auto leading-relaxed">{children}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-xs text-ink-4 py-10 justify-center">
      <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
    </div>
  );
}

/** Carga un banco (/api/plan/*) y expone los helpers de escritura. */
function useBank<T extends { id: string }>(url: string, brandId: string | null) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    await Promise.resolve();
    if (!brandId) { setItems([]); setLoading(false); return; }
    try {
      const r = await fetch(`${url}?brand=${brandId}`);
      const d = await r.json();
      setItems((d.items ?? d.notes ?? d.learnings ?? []) as T[]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [url, brandId]);

  // La carga va dentro de un microtask: así el efecto nunca hace setState síncrono.
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const create = async (payload: Record<string, unknown>) => {
    if (!brandId) return false;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, ...payload }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        // Antes fallaba en silencio: el boton simplemente no hacia nada.
        setError(d.error ?? `El servidor respondió ${r.status}`);
        return false;
      }
      setError(null);
      await load();
      return true;
    } catch {
      setError('No hubo conexión con el servidor.');
      return false;
    }
  };

  /** Guarda un campo. Reintenta los 5xx con backoff y devuelve si quedo. */
  const patch = async (id: string, payload: Record<string, unknown>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...payload } as T : it)));
    for (let intento = 0; intento < 3; intento += 1) {
      try {
        const r = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...payload }),
        });
        if (r.ok) return true;
        // 4xx no mejora reintentando; 5xx sí (concurrencia, pool, red).
        if (r.status < 500) return false;
      } catch { /* red: reintentamos */ }
      if (intento < 2) await new Promise((res) => setTimeout(res, 400 * (intento + 1)));
    }
    return false;
  };

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    await fetch(`${url}?id=${id}`, { method: 'DELETE' });
  };

  return { items, loading, error, setError, load, create, patch, remove };
}


// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function CerebroPage() {
  usePendingWarning();
  return (
    <Suspense fallback={<main className="flex-1 min-h-screen" />}>
      <CerebroInner />
    </Suspense>
  );
}

function CerebroInner() {
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();
  const router = useRouter();
  const params = useSearchParams();

  const [tab, setTab] = useState<TabId>(() => {
    const t = params.get('tab') ?? '';
    if (TABS.some((x) => x.id === t)) return t as TabId;
    return TAB_ALIASES[t] ?? 'chat';
  });

  const goTab = (id: TabId) => {
    setTab(id);
    router.replace(id === 'chat' ? '/cerebro' : `/cerebro?tab=${id}`, { scroll: false });
  };

  return (
    <main className="flex-1 min-h-screen flex flex-col">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      {/* Pestañas */}
      <div className="border-b border-line px-4 sm:px-6 bg-canvas">
        <div className="max-w-[1400px] mx-auto flex items-center gap-1 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => goTab(id)}
              className={`flex items-center gap-1.5 text-xs px-3 py-2.5 border-b-2 -mb-px whitespace-nowrap transition-colors ${
                tab === id
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-4 hover:text-ink-2'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className="flex-1 px-4 sm:px-6 py-5">
        <div className="max-w-[1400px] mx-auto">
          <BrainSync key={activeBrandId} brandId={activeBrandId} />
          {tab === 'chat' && <ChatTab brandId={activeBrandId} brandName={activeBrand?.name ?? ''} />}
          {tab === 'personas' && <PersonasTab key={activeBrandId} brandId={activeBrandId} />}
          {tab === 'conceptos' && <ConceptosTab key={activeBrandId} brandId={activeBrandId} />}
          {tab === 'hooks' && <HooksTab key={activeBrandId} brandId={activeBrandId} />}
          {tab === 'aprendizajes' && <AprendizajesTab key={activeBrandId} brandId={activeBrandId} />}
          {tab === 'fuentes' && <FuentesTab key={activeBrandId} brandId={activeBrandId} />}
        </div>
      </section>
    </main>
  );
}

// ===========================================================================
// 1 · CHAT — el cerebro conversacional, con el contexto de la marca al lado.
// ===========================================================================

function ChatTab({ brandId, brandName }: { brandId: string | null; brandName: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    await Promise.resolve();
    if (!brandId) { setMessages([]); return; }
    const chat = await fetch(`/api/chat?brand=${brandId}`).then((r) => r.json()).catch(() => ({}));
    setMessages(chat.messages ?? []);
  }, [brandId]);

  // La carga va dentro de un microtask: así el efecto nunca hace setState síncrono.
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, thinking]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || !brandId || thinking) return;
    setInput('');
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    setThinking(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error en el chat');
    } finally {
      setThinking(false);
    }
  };

  const clearChat = async () => {
    if (!brandId || !confirm('¿Limpiar el hilo del chat?')) return;
    await fetch(`/api/chat?brand=${brandId}`, { method: 'DELETE' });
    setMessages([]);
  };

  const addLearning = async (text: string) => {
    if (!brandId || !text.trim()) return;
    await fetch('/api/learnings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId, text }),
    });
  };

  // Detecta "💡 Aprendizaje sugerido:" en la última respuesta
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const suggestedLearning = lastAssistant?.content.match(/💡\s*Aprendizaje sugerido:\s*(.+)/)?.[1]?.trim();

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start min-w-0">
      <div className="rounded-xl border border-line bg-surface flex flex-col min-w-0" style={{ height: 'calc(100vh - 190px)' }}>
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line min-w-0">
          <h1 className="text-sm font-bold flex items-center gap-2 min-w-0">
            <Brain className="w-4 h-4 text-accent shrink-0" />
            <span className="truncate">Cerebro · {brandName}</span>
          </h1>
          {messages.length > 0 && (
            <button onClick={clearChat} className="text-xs text-ink-4 hover:text-danger flex items-center gap-1 shrink-0">
              <Trash2 className="w-3.5 h-3.5" /> Limpiar
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !thinking && (
            <div className="text-center py-10">
              <Brain className="w-10 h-10 text-line-strong mx-auto mb-3" />
              <p className="text-sm text-ink-3">
                Pregúntale al cerebro. Sabe qué está funcionando en Meta ahora mismo,
                qué dicen los guiones ganadores y qué has aprendido.
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-line text-ink-3 hover:text-ink hover:border-accent/50 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id ?? i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] min-w-0 break-words rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === 'user'
                  ? 'bg-accent-strong/25 text-ink border border-accent-strong/30'
                  : 'bg-surface text-ink-2 border border-line'
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex items-center gap-2 text-xs text-ink-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pensando con todo tu contexto…
            </div>
          )}
          {error && <p className="text-xs text-danger break-words">{error}</p>}
          {suggestedLearning && !thinking && (
            <button
              onClick={() => addLearning(suggestedLearning)}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-warn/30 bg-warn/5 text-warn hover:bg-warn/10 max-w-full min-w-0 text-left"
            >
              <Lightbulb className="w-3.5 h-3.5 shrink-0" /> <span className="break-words">Guardar aprendizaje: “{suggestedLearning.slice(0, 90)}…”</span>
            </button>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t border-line">
          <div className="flex gap-2 min-w-0">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              rows={2}
              placeholder="Pide guiones, hooks, diagnóstico, ideas…"
              className="flex-1 min-w-0 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent outline-none resize-none"
            />
            <button
              onClick={() => send()}
              disabled={thinking || !input.trim()}
              className="px-4 rounded-lg gradient-blue text-on-accent disabled:opacity-50 shrink-0"
              title="Enviar"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <BrainContextPanel brandId={brandId} />
    </div>
  );
}

/** Contexto de la marca (brain_sections): lo que el chat lee en cada respuesta. */
function BrainContextPanel({ brandId }: { brandId: string | null }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    await Promise.resolve();
    if (!brandId) { setSections([]); return; }
    const brain = await fetch(`/api/brain?brand=${brandId}`).then((r) => r.json()).catch(() => ({}));
    setSections(brain.sections ?? []);
  }, [brandId]);

  // La carga va dentro de un microtask: así el efecto nunca hace setState síncrono.
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const saveSection = async (s: Partial<Section> & { title: string }) => {
    if (!brandId) return;
    await fetch('/api/brain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, brandId, title: s.title, content: s.content ?? '', sort: s.sort ?? sections.length }),
    });
    await load();
  };

  const deleteSection = async (id: string) => {
    if (!confirm('¿Eliminar esta sección del cerebro?')) return;
    await fetch(`/api/brain?id=${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink-3 truncate">Contexto de la marca</h2>
        <button onClick={() => setShowNew((v) => !v)} className="text-xs text-accent hover:text-accent flex items-center gap-1 shrink-0">
          <Plus className="w-3.5 h-3.5" /> Sección
        </button>
      </div>
      {showNew && (
        <div className="flex gap-2 mb-3 min-w-0">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Título (ej. Producto, Compliance, Tono)"
            className="flex-1 min-w-0 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink focus:border-accent outline-none"
          />
          <button
            onClick={() => { if (newTitle.trim()) { saveSection({ title: newTitle.trim() }); setNewTitle(''); setShowNew(false); } }}
            className="text-xs px-3 rounded-lg gradient-blue text-on-accent shrink-0"
          >
            Crear
          </button>
        </div>
      )}
      {sections.length === 0 && (
        <p className="text-xs text-ink-4 break-words">
          Aún no hay contexto. Crea secciones (producto, compliance, tono…): el chat las usa en cada respuesta.
        </p>
      )}
      <div className="space-y-1.5">
        {sections.map((s) => (
          <SectionRow
            key={`${s.id}:${s.content ?? ''}`}
            section={s}
            open={openSection === s.id}
            onToggle={() => setOpenSection(openSection === s.id ? null : s.id)}
            onSave={(content) => saveSection({ ...s, content })}
            onDelete={() => deleteSection(s.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SectionRow({ section, open, onToggle, onSave, onDelete }: {
  section: Section; open: boolean; onToggle: () => void;
  onSave: (content: string) => void; onDelete: () => void;
}) {
  const [content, setContent] = useState(section.content);
  const dirty = content !== section.content;
  return (
    <div className="rounded-lg border border-surface-2 bg-canvas">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-ink min-w-0">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-ink-4 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-4 shrink-0" />}
        <span className="flex-1 min-w-0 text-left font-medium truncate">{section.title}</span>
        {section.content && <span className="text-[9px] text-ink-4 shrink-0">{section.content.length} car.</span>}
      </button>
      {open && (
        <div className="px-2.5 pb-2.5">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-xs text-ink focus:border-accent outline-none resize-y"
          />
          <div className="flex justify-between mt-1.5">
            <button onClick={onDelete} className="text-[10px] text-ink-4 hover:text-danger">Eliminar</button>
            {dirty && (
              <button onClick={() => onSave(content)} className="flex items-center gap-1 text-[10px] text-accent hover:text-accent">
                <Save className="w-3 h-3" /> Guardar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 2 · PERSONAS — el banco de avatares, como hoja de cálculo.
//
// Antes era una tarjeta por avatar con diez campos abiertos: setenta cajas de
// texto apiladas para siete avatares. Comparar el "hueco de educación" de dos
// avatares —que es justo lo que se hace con un banco de avatares— obligaba a
// scrollear entre ellos y recordar. Ahora cada avatar es un renglón, cada campo
// una columna, el nombre se queda fijo a la izquierda, y el renglón se abre a
// lo ancho cuando un campo necesita espacio de verdad.
// ===========================================================================

/** Celda compacta: dos renglones, sin etiqueta (el encabezado ya la dice). */
function Celda({ value, placeholder, rows = 2, onSave }: {
  value: string | null; placeholder?: string; rows?: number;
  onSave: (v: string) => void | Promise<unknown>;
}) {
  return <Field value={value} rows={rows} placeholder={placeholder} onSave={onSave} />;
}

/** Cuenta los anuncios que el clasificador ligó a cada avatar / concepto. */
function contarPor(ads: LibAd[], campo: 'persona_id' | 'angle_id'): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of ads) {
    const id = a[campo];
    if (id) m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

function PersonasTab({ brandId }: { brandId: string | null }) {
  const { items, loading, error, setError, create, patch, remove } = useBank<Persona>('/api/plan/personas', brandId);
  const lib = useAngleStats(brandId);
  const porPersona = useMemo(() => contarPor(lib.ads, 'persona_id'), [lib.ads]);

  const cols: SheetCol<Persona>[] = [
    {
      key: 'callout', label: 'Callout', width: 230,
      hint: 'La frase con la que se reconoce en el primer segundo del anuncio.',
      render: (p) => <Celda value={p.callout} placeholder="Se reconoce en el primer segundo…" onSave={(v) => patch(p.id, { callout: v })} />,
    },
    {
      key: 'pains', label: 'Problemas', width: 240,
      hint: 'Qué le duele y qué conductas ya cambió por eso.',
      render: (p) => <Celda value={p.pains} placeholder="Qué le duele" onSave={(v) => patch(p.id, { pains: v })} />,
    },
    {
      key: 'education_gap', label: 'Hueco de educación', width: 260,
      hint: 'Qué creencia falsa hay que actualizar ANTES de que la solución tenga sentido.',
      render: (p) => <Celda value={p.education_gap} placeholder="La creencia que hay que corregir primero" onSave={(v) => patch(p.id, { education_gap: v })} />,
    },
    {
      key: 'solutions', label: 'Soluciones', width: 240,
      hint: 'El mecanismo del producto dicho en sus términos.',
      render: (p) => <Celda value={p.solutions} placeholder="Qué hace el producto por ella" onSave={(v) => patch(p.id, { solutions: v })} />,
    },
    {
      key: 'desires', label: 'Deseos', width: 220,
      hint: 'Qué quiere que pase después de comprar.',
      render: (p) => <Celda value={p.desires} placeholder="Qué quiere después de comprar" onSave={(v) => patch(p.id, { desires: v })} />,
    },
    {
      key: 'objections', label: 'Objeciones', width: 220,
      hint: 'Por qué no compraría.',
      render: (p) => <Celda value={p.objections} placeholder="Por qué no compraría" onSave={(v) => patch(p.id, { objections: v })} />,
    },
    {
      key: 'offer_fit', label: 'Oferta', width: 170,
      hint: 'Unidad simple, pack de 3, o ninguna oferta.',
      render: (p) => <Celda value={p.offer_fit} rows={2} placeholder="Pack de 3 / unidad / ninguna" onSave={(v) => patch(p.id, { offer_fit: v })} />,
    },
    {
      key: 'awareness', label: 'Conciencia', width: 140,
      hint: 'En qué etapa de conciencia está cuando ve el anuncio.',
      render: (p) => (
        <select
          value={p.awareness_stage ?? ''}
          onChange={(e) => patch(p.id, { awareness_stage: e.target.value || null })}
          className={INPUT_CLS}
        >
          <option value="">—</option>
          {AWARENESS_STAGES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      ),
    },
    {
      key: 'ads', label: 'Anuncios', width: 90,
      hint: 'Cuántos anuncios de los últimos 30 días se le hicieron a este avatar. Se llena solo al analizarlos.',
      render: (p) => {
        const n = porPersona.get(p.id) ?? 0;
        return (
          <p className="text-xs text-ink-3 font-[family-name:var(--font-mono)] tabular-nums pt-1.5">
            {lib.loading ? '…' : n === 0 ? <span className="text-ink-4">—</span> : n}
          </p>
        );
      },
    },
  ];

  return (
    <div>
      <TabHead
        title="Personas"
        hint="A quién le hablas. Un renglón por avatar; el nombre se queda fijo al desplazarte. Abre un renglón con la flecha para escribir a gusto."
        action={
          <button
            onClick={() => { void create({ name: 'Avatar nuevo', status: 'activa' }); }}
            disabled={!brandId}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-on-accent disabled:opacity-50 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar avatar
          </button>
        }
      />
      {error && <ErrorBanner error={error} onClose={() => setError(null)} />}
      {loading ? <Loading /> : items.length === 0 ? (
        <Empty>
          Sé específico. “Mujeres 25-45” no es una persona, es un censo. Escribe a quién le duele
          algo, qué le duele y qué ya intentó para quitárselo.
        </Empty>
      ) : (
        <Sheet
          rows={items}
          cols={cols}
          rowKey={(p) => p.id}
          stickyLabel="Avatar"
          stickyWidth={210}
          sticky={(p) => (
            <div className="space-y-1">
              <Field value={p.name} placeholder="Nombre del avatar" onSave={(v) => patch(p.id, { name: v })} />
              <SourceChip source={p.source} />
            </div>
          )}
          detail={(p) => (
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Descripción" value={p.description} rows={4} placeholder="Quién es, en una frase que puedas imaginar" onSave={(v) => patch(p.id, { description: v })} />
              <Field label="Evidencia" value={p.evidence} rows={4} placeholder="Reseña, comentario o mensaje que lo prueba" onSave={(v) => patch(p.id, { evidence: v })} />
              <Field label="Hueco de educación" value={p.education_gap} rows={5} placeholder="Qué creencia falsa hay que actualizar ANTES de que la solución tenga sentido" onSave={(v) => patch(p.id, { education_gap: v })} />
              <Field label="Problemas" value={p.pains} rows={5} placeholder="Qué le duele y qué conductas ya cambió por eso" onSave={(v) => patch(p.id, { pains: v })} />
            </div>
          )}
          onRemove={(p) => { if (confirm('¿Eliminar este avatar?')) remove(p.id); }}
        />
      )}
    </div>
  );
}

/** Franja roja compartida por los bancos. */
function ErrorBanner({ error, onClose }: { error: string; onClose: () => void }) {
  return (
    <div className="mb-4 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm text-danger flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{error}</span>
      <button onClick={onClose} className="ml-auto shrink-0 text-ink-4 hover:text-ink-1"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

// ===========================================================================
// 3 · CONCEPTOS — la biblioteca de formatos creativos.
//
// Dejaron de ser "ángulos" (la razón de compra) para ser lo que realmente se
// reutiliza al producir: el FORMATO. Un concepto se carga una vez —qué es, un
// ejemplo, y la referencia en imagen o video que se puede previsualizar— y de
// ahí se adapta a cada avatar. La columna "Avatares" no se escribe: sale de los
// anuncios ya analizados, así que la biblioteca aprende sola a qué avatar se le
// hizo cada concepto.
//
// El estado sigue saliendo del gasto de los últimos 30 días, no de una opinión.
// ===========================================================================

type AngleVerdictId = 'sin_datos' | 'muestra_chica' | 'funciona' | 'sobrevive' | 'no_funciona';

const ANGLE_VERDICT: Record<AngleVerdictId, { label: string; cls: string }> = {
  sin_datos: { label: 'Sin datos', cls: 'border-line text-ink-4' },
  muestra_chica: { label: 'Muestra chica', cls: 'border-warn/40 bg-warn-soft text-warn' },
  funciona: { label: 'Funciona', cls: 'border-ok/40 bg-ok-soft text-ok' },
  sobrevive: { label: 'Sobrevive', cls: 'border-warn/40 bg-warn-soft text-warn' },
  no_funciona: { label: 'No funciona', cls: 'border-danger/40 bg-danger-soft text-danger' },
};

/** El estado sale del gasto, no de una opinión. */
function angleVerdictId(s: AngleStats | undefined, eco: Economics): AngleVerdictId {
  if (!s || s.spend <= 0) return 'sin_datos';
  if (s.purchases < 3) return 'muestra_chica';
  const roas = s.roas ?? 0;
  if (roas >= eco.target) return 'funciona';
  if (roas >= eco.breakeven) return 'sobrevive';
  return 'no_funciona';
}

const EMPTY_STATS: AngleStats = { n: 0, spend: 0, purchases: 0, revenue: 0, roas: null, cpa: null };

/** Suma los anuncios de la biblioteca por angle_id. Todo defensivo: campos faltantes → 0. */
function statsByAngle(ads: LibAd[]): Map<string, AngleStats> {
  const acc = new Map<string, AngleStats>();
  for (const ad of ads) {
    const id = ad.angle_id;
    if (!id) continue;
    const cur = acc.get(id) ?? { ...EMPTY_STATS };
    cur.n += 1;
    cur.spend += Number(ad.spend) || 0;
    cur.purchases += Number(ad.purchases) || 0;
    cur.revenue += Number(ad.revenue) || 0;
    acc.set(id, cur);
  }
  for (const s of acc.values()) {
    s.roas = s.spend > 0 ? s.revenue / s.spend : null;
    s.cpa = s.purchases > 0 ? s.spend / s.purchases : null;
  }
  return acc;
}

/** Qué avatares recibieron ya un anuncio de cada concepto, con cuántos. */
function avataresPorConcepto(ads: LibAd[]): Map<string, { name: string; n: number }[]> {
  const acc = new Map<string, Map<string, { name: string; n: number }>>();
  for (const ad of ads) {
    if (!ad.angle_id) continue;
    const key = ad.persona_id ?? '—';
    const nombre = ad.persona ?? 'Sin avatar';
    const m = acc.get(ad.angle_id) ?? new Map();
    const cur = m.get(key) ?? { name: nombre, n: 0 };
    cur.n += 1;
    m.set(key, cur);
    acc.set(ad.angle_id, m);
  }
  const out = new Map<string, { name: string; n: number }[]>();
  for (const [id, m] of acc) out.set(id, [...m.values()].sort((a, b) => b.n - a.n));
  return out;
}

/** La miniatura del primer anuncio de cada concepto: referencia gratis. */
function miniaturaPorConcepto(ads: LibAd[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const ad of ads) {
    if (!ad.angle_id || !ad.thumbnail_url || out.has(ad.angle_id)) continue;
    out.set(ad.angle_id, ad.thumbnail_url);
  }
  return out;
}

/** Una sola llamada a /api/library (últimos 30 días) para toda la pestaña. */
function useAngleStats(brandId: string | null) {
  const [ads, setAds] = useState<LibAd[]>([]);
  const [eco, setEco] = useState<Economics>(() => resolveEconomics(null));
  const [currency, setCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    await Promise.resolve();
    if (!brandId) { setAds([]); setLoading(false); return; }
    try {
      const r = await fetch(`/api/library?brand=${brandId}&window=last_30d`);
      const d = (await r.json().catch(() => ({}))) as {
        ads?: unknown; economics?: unknown; currency?: unknown;
      };
      setAds(Array.isArray(d.ads) ? (d.ads as LibAd[]) : []);
      setEco(resolveEconomics(d.economics));
      setCurrency(typeof d.currency === 'string' ? d.currency : null);
    } catch {
      setAds([]);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const stats = useMemo(() => statsByAngle(ads), [ads]);
  return { ads, stats, eco, currency, loading };
}

/** Sube una imagen o un video de referencia al bucket y devuelve su URL pública. */
function ReferenciaCelda({ concepto, brandId, fallback, onSave }: {
  concepto: Angle;
  brandId: string | null;
  /** Miniatura de un anuncio del concepto, cuando todavía no hay referencia propia. */
  fallback: string | null;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const subir = async (file: File) => {
    if (!brandId) return;
    setSubiendo(true);
    setErr(null);
    try {
      const r = await fetch('/api/canvas/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, filename: file.name, folder: 'conceptos' }),
      });
      const j = (await r.json()) as { path?: string; token?: string; url?: string; error?: string };
      if (!r.ok || !j.path || !j.token || !j.url) throw new Error(j.error ?? 'No se pudo preparar la subida');
      const sb = createBrowserClient();
      const up = await sb.storage.from('brand-assets').uploadToSignedUrl(j.path, j.token, file, { contentType: file.type || undefined });
      if (up.error) throw new Error(up.error.message);
      onSave({ reference_url: j.url, reference_kind: file.type.startsWith('video') ? 'video' : 'image' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falló la subida');
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const url = concepto.reference_url;
  const esVideo = concepto.reference_kind === 'video';

  return (
    <div className="space-y-1">
      <div className="relative rounded-md border border-line bg-canvas overflow-hidden" style={{ aspectRatio: '4 / 5' }}>
        {url ? (
          esVideo
            ? <video src={url} className="w-full h-full object-cover" muted playsInline controls preload="metadata" />
            : <img src={url} alt="" className="w-full h-full object-cover" />
        ) : fallback ? (
          <img src={fallback} alt="" className="w-full h-full object-cover opacity-60" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-4">
            <Upload className="w-4 h-4" />
          </div>
        )}
        {subiendo && (
          <div className="absolute inset-0 grid place-items-center bg-canvas/80">
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => inputRef.current?.click()} disabled={!brandId || subiendo} className="text-[10px] text-accent hover:underline disabled:opacity-50">
          {url ? 'Cambiar' : 'Subir'}
        </button>
        {url && (
          <button onClick={() => onSave({ reference_url: '', reference_kind: '' })} className="text-[10px] text-ink-4 hover:text-danger">
            Quitar
          </button>
        )}
      </div>
      {!url && fallback && <p className="text-[9px] text-ink-4 leading-tight">De un anuncio</p>}
      {err && <p className="text-[9px] text-danger leading-tight break-words">{err}</p>}
      <input ref={inputRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => e.target.files?.[0] && void subir(e.target.files[0])} />
    </div>
  );
}

function ConceptosTab({ brandId }: { brandId: string | null }) {
  const { items, loading, error, setError, create, patch, remove } = useBank<Angle>('/api/plan/angles', brandId);
  const personas = useBank<Persona>('/api/plan/personas', brandId);
  const lib = useAngleStats(brandId);
  const avatares = useMemo(() => avataresPorConcepto(lib.ads), [lib.ads]);
  const minis = useMemo(() => miniaturaPorConcepto(lib.ads), [lib.ads]);

  // Más gasto primero; los que no tienen anuncios ligados, al final.
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const sa = lib.stats.get(a.id)?.spend ?? 0;
      const sb = lib.stats.get(b.id)?.spend ?? 0;
      if (sa === 0 && sb === 0) return 0;
      if (sa === 0) return 1;
      if (sb === 0) return -1;
      return sb - sa;
    });
  }, [items, lib.stats]);

  const cols: SheetCol<Angle>[] = [
    {
      key: 'ref', label: 'Referencia', width: 130,
      hint: 'La imagen o el video que muestra el concepto. Si no subes nada, se usa la miniatura de un anuncio suyo.',
      render: (a) => (
        <ReferenciaCelda
          concepto={a}
          brandId={brandId}
          fallback={minis.get(a.id) ?? null}
          onSave={(payload) => { void patch(a.id, payload); }}
        />
      ),
    },
    {
      key: 'definition', label: 'Qué es', width: 280,
      hint: 'El concepto en una frase que un editor pueda ejecutar sin preguntarte nada.',
      render: (a) => <Celda value={a.definition} rows={4} placeholder="El formato, explicado para quien lo va a editar" onSave={(v) => patch(a.id, { definition: v })} />,
    },
    {
      key: 'example', label: 'Ejemplo', width: 260,
      hint: 'Un caso concreto del concepto aplicado. Sirve de molde.',
      render: (a) => <Celda value={a.example} rows={4} placeholder="Un ejemplo concreto" onSave={(v) => patch(a.id, { example: v })} />,
    },
    {
      key: 'avatares', label: 'Avatares', width: 190,
      hint: 'A qué avatares ya se les adaptó este concepto. Se llena solo conforme se analizan los anuncios.',
      render: (a) => {
        const lista = avatares.get(a.id) ?? [];
        if (lib.loading) return <p className="text-[10px] text-ink-4 pt-1.5">…</p>;
        if (!lista.length) return <p className="text-[10px] text-ink-4 pt-1.5">Todavía a ninguno</p>;
        return (
          <div className="flex flex-wrap gap-1 pt-1">
            {lista.map((x) => (
              <span key={x.name} className="text-[10px] px-1.5 py-0.5 rounded border border-line text-ink-3 whitespace-nowrap">
                {x.name} <span className="text-ink-4">×{x.n}</span>
              </span>
            ))}
          </div>
        );
      },
    },
    {
      key: 'resultado', label: 'Resultado 30d', width: 190,
      hint: 'Lo que hicieron con dinero real los anuncios de este concepto. Sale del gasto, no de una opinión.',
      render: (a) => {
        const st = lib.stats.get(a.id);
        const v = ANGLE_VERDICT[angleVerdictId(st, lib.eco)];
        return (
          <div className="space-y-1 pt-1">
            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border font-medium ${v.cls}`}>{v.label}</span>
            <p className="text-[10px] text-ink-4 font-[family-name:var(--font-mono)] tabular-nums leading-snug">
              {lib.loading ? '…' : st && st.n > 0
                ? `${st.n} anuncio${st.n === 1 ? '' : 's'} · ${fmtMoney(st.spend, lib.currency)} · ${fmtRoas(st.roas)}`
                : 'Sin anuncios ligados'}
            </p>
          </div>
        );
      },
    },
    {
      key: 'awareness', label: 'Conciencia', width: 140,
      hint: 'De aquí sale el segmento CONCIENCIA del nombre del anuncio.',
      render: (a) => (
        <select
          value={a.awareness_stage ?? ''}
          onChange={(e) => patch(a.id, { awareness_stage: e.target.value || null })}
          className={INPUT_CLS}
        >
          <option value="">—</option>
          {AWARENESS_STAGES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      ),
    },
  ];

  return (
    <div>
      <TabHead
        title="Conceptos"
        hint="La biblioteca de formatos que reutilizas. Carga el concepto una vez con su referencia y de ahí lo adaptas a cada avatar; la columna Avatares se llena sola conforme se analizan los anuncios."
        action={
          <button
            onClick={() => { void create({ name: 'Concepto nuevo', status: 'sin_probar', source: 'manual' }); }}
            disabled={!brandId}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-on-accent disabled:opacity-50 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar concepto
          </button>
        }
      />
      {error && <ErrorBanner error={error} onClose={() => setError(null)} />}
      {loading ? <Loading /> : items.length === 0 ? (
        <Empty>
          Un concepto es el FORMATO que reutilizas, no la razón de compra: “reacción a comentario”,
          “tres razones en 15 segundos”, “antes y después sin voz”. Cárgalo con su referencia y de
          ahí lo adaptas a cada avatar.
        </Empty>
      ) : (
        <Sheet
          rows={sorted}
          cols={cols}
          rowKey={(a) => a.id}
          stickyLabel="Concepto"
          stickyWidth={230}
          sticky={(a) => (
            <div className="space-y-1">
              <Field value={a.name} placeholder="Nombre del concepto" onSave={(v) => patch(a.id, { name: v })} />
              <div className="flex items-center gap-1.5">
                <div className="w-24 shrink-0">
                  <Field value={a.code} mono placeholder="CÓDIGO" validate={validarCodigo(items, a.id)} onSave={(v) => patch(a.id, { code: v.toUpperCase() })} />
                </div>
                <SourceChip source={a.source} />
              </div>
            </div>
          )}
          detail={(a) => (
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1">Avatar principal</p>
                  <select
                    value={a.persona_id ?? ''}
                    onChange={(e) => patch(a.id, { persona_id: e.target.value || null })}
                    className={INPUT_CLS}
                  >
                    <option value="">Sin avatar</option>
                    {personas.items.map((p) => <option key={p.id} value={p.id}>{p.name ?? 'Sin nombre'}</option>)}
                  </select>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1">Estado manual (no cambia el calculado)</p>
                  <select
                    value={a.status ?? ''}
                    onChange={(e) => patch(a.id, { status: e.target.value || 'sin_probar' })}
                    className={INPUT_CLS}
                  >
                    <option value="sin_probar">Sin probar</option>
                    {ANGLE_STATUS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </div>
              </div>
              <IaMark source={a.source} evidence={a.evidence} />
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Dolor" value={a.pain} rows={3} placeholder="Qué problema real ataca" onSave={(v) => patch(a.id, { pain: v })} />
                <Field label="Mecanismo (producto)" value={a.mechanism} rows={3} placeholder="Por qué el producto resuelve el dolor" onSave={(v) => patch(a.id, { mechanism: v })} />
                <Field label="Psicología" value={a.psychology} rows={3} placeholder="La palanca mental que activa" onSave={(v) => patch(a.id, { psychology: v })} />
                <Field label="Objeción" value={a.objection} rows={3} placeholder="Qué duda hay que tumbar" onSave={(v) => patch(a.id, { objection: v })} />
                <Field label="Deseo" value={a.desire} rows={3} placeholder="Qué quiere que pase después de comprar" onSave={(v) => patch(a.id, { desire: v })} />
                <Field label="Aprendizajes" value={a.learnings} rows={3} placeholder="Qué te enseñaron los anuncios de este concepto" onSave={(v) => patch(a.id, { learnings: v })} />
              </div>
            </div>
          )}
          onRemove={(a) => { if (confirm('¿Eliminar este concepto?')) remove(a.id); }}
        />
      )}
    </div>
  );
}

/** 3–12 caracteres A-Z0-9, único en la marca. El guion está prohibido porque
 *  separa las partes del nombre del anuncio y rompería el parseo. Los códigos
 *  que puso la IA llegan a 11, así que el tope no puede ser 8. */
function validarCodigo(todos: Angle[], id: string) {
  return (v: string): string | null => {
    const c = v.trim().toUpperCase();
    if (!c) return 'El código no puede quedar vacío.';
    if (c.includes('-')) return 'Sin guiones: el guion separa las partes del nombre del anuncio.';
    if (!/^[A-Z0-9]{3,12}$/.test(c)) return 'Entre 3 y 12 caracteres, solo A-Z y 0-9.';
    if (todos.some((x) => x.id !== id && (x.code ?? '').trim().toUpperCase() === c)) return 'Ya hay otro concepto con ese código.';
    return null;
  };
}

// ===========================================================================
// 4 · HOOKS — los primeros segundos, palabra por palabra, con sus números.
// ===========================================================================

type HookKind = 'voz' | 'headline';

interface HookAd {
  meta_id: string; ad_id: string | null; name: string | null; thumbnail_url: string | null;
  asset_kind: string | null; spend: number; purchases: number | null; roas: number | null;
  cpa: number | null; hook_rate: number | null; hold_rate: number | null;
}

interface HookItem {
  id: string; title: string | null; body: string | null; hook_type: string | null;
  status: string | null; source: string | null; evidence: string | null;
  ad_ids: string[] | null; created_at: string;
  kind: HookKind; ads: HookAd[]; spend: number;
}

const HOOK_KIND: Record<HookKind, { label: string; cls: string }> = {
  voz: { label: 'Voz', cls: 'border-accent/40 bg-accent-soft text-accent' },
  headline: { label: 'Headline', cls: 'border-warn/40 bg-warn-soft text-warn' },
};

const HOOK_BODY_PREFIX = /^texto en pantalla del hook\.?\s*/i;

/** Igual que useBank, pero además guarda economics/currency que manda /api/plan/hooks. */
function useHookBank(brandId: string | null) {
  const url = '/api/plan/hooks';
  const [items, setItems] = useState<HookItem[]>([]);
  const [eco, setEco] = useState<Economics>(() => resolveEconomics(null));
  const [currency, setCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    await Promise.resolve();
    if (!brandId) { setItems([]); setLoading(false); return; }
    try {
      const r = await fetch(`${url}?brand=${brandId}`);
      const d = (await r.json().catch(() => ({}))) as { items?: unknown; economics?: unknown; currency?: unknown };
      setItems(Array.isArray(d.items) ? (d.items as HookItem[]) : []);
      setEco(resolveEconomics(d.economics));
      setCurrency(typeof d.currency === 'string' ? d.currency : null);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  // La carga va dentro de un microtask: así el efecto nunca hace setState síncrono.
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const create = async (payload: Record<string, unknown>) => {
    if (!brandId) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId, ...payload }),
    });
    await load();
  };

  const patch = async (id: string, payload: Record<string, unknown>) => {
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it;
      const next = { ...it, ...payload } as HookItem;
      if (typeof payload.hook_type === 'string') next.kind = payload.hook_type === 'headline' ? 'headline' : 'voz';
      return next;
    }));
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...payload }),
    });
  };

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    await fetch(`${url}?id=${id}`, { method: 'DELETE' });
  };

  return { items, eco, currency, loading, create, patch, remove };
}

/** Botón segmentado chico (Todos / Voz / Headline…). */
function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5 max-w-full overflow-x-auto">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 text-[11px] rounded-md whitespace-nowrap ${
            value === o.id ? 'bg-surface text-ink font-medium shadow-sm border border-line' : 'text-ink-3 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const fmtPct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);

function roasCls(r: number | null, eco: Economics): string {
  if (r == null) return 'text-ink-4';
  if (r >= eco.target) return 'text-ok';
  if (r >= eco.breakeven) return 'text-warn';
  return 'text-danger';
}

/** Un anuncio que corrió este hook: miniatura + nombre + números mono. */
function HookAdRow({ ad, eco, currency }: { ad: HookAd; eco: Economics; currency: string | null }) {
  const hasData = ad.spend > 0;
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      {ad.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.thumbnail_url} alt="" className="w-9 h-11 rounded-md object-cover bg-inset shrink-0" />
      ) : (
        <div className="w-9 h-11 rounded-md bg-inset flex items-center justify-center shrink-0">
          <Zap className="w-3.5 h-3.5 text-ink-4" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-ink truncate" title={ad.name ?? undefined}>{ad.name ?? ad.ad_id ?? 'Anuncio'}</p>
        {hasData ? (
          <p className="text-[11px] text-ink-3 font-[family-name:var(--font-mono)] tabular-nums break-words leading-snug">
            {fmtMoney(ad.spend, currency)}
            {' · '}{ad.purchases ?? 0} compra{(ad.purchases ?? 0) === 1 ? '' : 's'}
            {' · CPA '}{ad.cpa == null ? '—' : fmtMoney(ad.cpa, currency)}
            {' · ROAS '}<span className={roasCls(ad.roas, eco)}>{fmtRoas(ad.roas)}</span>
            {' · Hook '}{fmtPct(ad.hook_rate)}
            {' · Hold '}{fmtPct(ad.hold_rate)}
          </p>
        ) : (
          <p className="text-[11px] text-ink-4">Sin gasto en los últimos 30 días</p>
        )}
      </div>
    </div>
  );
}

function HookCard({ h, eco, currency, onPatch, onRemove }: {
  h: HookItem;
  eco: Economics;
  currency: string | null;
  onPatch: (payload: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const kind = HOOK_KIND[h.kind];
  const why = (h.body ?? '').replace(HOOK_BODY_PREFIX, '').trim();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(h.title ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* sin portapapeles: nada que hacer */ }
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3 min-w-0">
      {/* Pills */}
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border font-medium shrink-0 ${kind.cls}`}>
          {kind.label}
        </span>
        <SourceChip source={h.source} />
        {h.ads.length > 0 && (
          <span className="text-[10px] text-ink-4 font-[family-name:var(--font-mono)] tabular-nums">
            {h.ads.length} anuncio{h.ads.length === 1 ? '' : 's'} · {fmtMoney(h.spend, currency)}
          </span>
        )}
      </div>

      {/* La línea literal */}
      {editing ? (
        <Field
          value={h.title}
          placeholder={h.kind === 'voz' ? 'Lo que se dijo, palabra por palabra' : 'Lo que se leyó en pantalla'}
          rows={2}
          onSave={(v) => { onPatch({ title: v }); setEditing(false); }}
        />
      ) : (
        <p className="text-base leading-snug text-ink break-words font-[family-name:var(--font-serif)]">
          “{h.title?.trim() || 'Sin texto'}”
        </p>
      )}

      {why && (
        <p className="text-[11px] text-ink-3 leading-snug break-words">
          <span className="text-ink-4">Por qué detiene:</span> {why}
        </p>
      )}

      {/* Anuncios que lo corrieron */}
      {h.ads.length > 0 ? (
        <div className="rounded-lg border border-line bg-canvas px-3 py-2 space-y-2 min-w-0">
          {h.ads.map((ad) => <HookAdRow key={ad.meta_id} ad={ad} eco={eco} currency={currency} />)}
        </div>
      ) : (
        <p className="text-[11px] text-ink-4">
          {h.evidence ? h.evidence : 'Sin anuncio ligado todavía'}
        </p>
      )}

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-line">
        <button onClick={copy} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-ink-3 hover:text-ink hover:bg-inset">
          {copied ? <CheckCircle2 className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3" />} {copied ? 'Copiado' : 'Copiar'}
        </button>
        <button onClick={() => setEditing((v) => !v)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-ink-3 hover:text-ink hover:bg-inset">
          <PenLine className="w-3 h-3" /> {editing ? 'Cerrar' : 'Editar'}
        </button>
        <button
          onClick={() => onPatch({ hook_type: h.kind === 'voz' ? 'headline' : 'voz' })}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-ink-3 hover:text-ink hover:bg-inset"
          title="Cambiar entre voz y headline"
        >
          <ArrowLeftRight className="w-3 h-3" /> {h.kind === 'voz' ? 'Era headline' : 'Era voz'}
        </button>
        <button onClick={onRemove} className="ml-auto flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-ink-4 hover:text-danger hover:bg-inset" title="Eliminar">
          <Trash2 className="w-3 h-3" /> Eliminar
        </button>
      </div>
    </div>
  );
}

function HooksTab({ brandId }: { brandId: string | null }) {
  const { items: hooks, eco, currency, loading, create, patch, remove } = useHookBank(brandId);

  const [kindFilter, setKindFilter] = useState<'todos' | HookKind>('todos');
  const [originFilter, setOriginFilter] = useState<'todos' | 'ia' | 'manual'>('todos');

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<HookKind>('voz');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await create({ title: title.trim(), hook_type: kind, source: 'manual' });
      setTitle('');
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => {
    const voz = hooks.filter((h) => h.kind === 'voz').length;
    const adIds = new Set<string>();
    for (const h of hooks) for (const a of h.ads) adIds.add(a.meta_id);
    return { total: hooks.length, voz, headline: hooks.length - voz, ads: adIds.size };
  }, [hooks]);

  // El servidor ya manda gasto desc con los sin anuncio al final; aquí solo filtramos.
  const visible = useMemo(() => hooks.filter((h) => {
    if (kindFilter !== 'todos' && h.kind !== kindFilter) return false;
    if (originFilter === 'ia' && !isAiSource(h.source)) return false;
    if (originFilter === 'manual' && isAiSource(h.source)) return false;
    return true;
  }), [hooks, kindFilter, originFilter]);

  return (
    <div>
      <TabHead
        title="Hooks"
        hint="Los primeros segundos, palabra por palabra: lo que se dijo (voz) y lo que se leyó en pantalla (headline), con los números del anuncio que los corrió."
      />

      {/* Nuevo hook: una sola fila */}
      <div className="rounded-xl border border-line bg-surface p-3 mb-4 min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1.5">Nuevo hook</p>
        <div className="flex flex-col sm:flex-row gap-2 min-w-0">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="El hook, palabra por palabra…"
            className="flex-1 min-w-0 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-4 focus:border-accent outline-none"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value === 'headline' ? 'headline' : 'voz')}
            className="rounded-lg border border-line bg-canvas px-2.5 py-2 text-xs text-ink focus:border-accent outline-none sm:w-40 shrink-0"
          >
            <option value="voz">Voz (se dijo)</option>
            <option value="headline">Headline (se leyó)</option>
          </select>
          <button
            onClick={add}
            disabled={!brandId || !title.trim() || saving}
            className="flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-on-accent disabled:opacity-50 shrink-0"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Guardar
          </button>
        </div>
      </div>

      {loading ? <Loading /> : hooks.length === 0 ? (
        <Empty>
          Aquí aparecen los hooks tal cual salieron de los anuncios analizados: la frase que se dijo
          y el texto que se leyó. Corre el análisis de tus videos o escribe uno a mano arriba.
        </Empty>
      ) : (
        <>
          {/* Resumen + filtros */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 min-w-0">
            <p className="text-xs text-ink-3 font-[family-name:var(--font-mono)] tabular-nums break-words">
              {summary.total} hook{summary.total === 1 ? '' : 's'} · {summary.voz} de voz · {summary.headline} headline{summary.headline === 1 ? '' : 's'} · de {summary.ads} anuncio{summary.ads === 1 ? '' : 's'} analizado{summary.ads === 1 ? '' : 's'}
            </p>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <Segmented
                value={kindFilter}
                onChange={setKindFilter}
                options={[{ id: 'todos', label: 'Todos' }, { id: 'voz', label: 'Voz' }, { id: 'headline', label: 'Headline' }]}
              />
              <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-4">
                Origen
                <select
                  value={originFilter}
                  onChange={(e) => setOriginFilter(e.target.value as 'todos' | 'ia' | 'manual')}
                  className="rounded-lg border border-line bg-canvas px-2 py-1 text-[11px] normal-case tracking-normal text-ink focus:border-accent outline-none"
                >
                  <option value="todos">Todos</option>
                  <option value="ia">De los anuncios (IA)</option>
                  <option value="manual">Manuales</option>
                </select>
              </label>
            </div>
          </div>

          {visible.length === 0 ? (
            <Empty>No hay hooks con ese filtro.</Empty>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {visible.map((h) => (
                <HookCard
                  key={h.id}
                  h={h}
                  eco={eco}
                  currency={currency}
                  onPatch={(payload) => patch(h.id, payload)}
                  onRemove={() => { if (confirm('¿Eliminar este hook?')) remove(h.id); }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
// 5 · APRENDIZAJES — lo que ya se confirmó con números. Una lista limpia.
// ===========================================================================

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function AprendizajesTab({ brandId }: { brandId: string | null }) {
  const { items, loading, create, patch, remove } = useBank<Learning>('/api/learnings', brandId);
  const [text, setText] = useState('');
  const [evidence, setEvidence] = useState('');
  const [sourceAd, setSourceAd] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const activas = items.filter((l) => l.active !== false);
  const archivadas = items.filter((l) => l.active === false);

  const add = async () => {
    if (!text.trim()) return;
    await create({ text: text.trim(), evidence: evidence.trim() || undefined, source_ad: sourceAd.trim() || undefined, source: 'manual' });
    setText(''); setEvidence(''); setSourceAd('');
  };

  return (
    <div>
      <TabHead
        title="Aprendizajes"
        hint="Lo que ya confirmaste con dinero real. La IA cita cada aprendizaje activo cuando le pides guiones."
      />

      {/* Agregar */}
      <div className="rounded-xl border border-line bg-surface p-4 mb-5 space-y-2 min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-ink-4">Nuevo aprendizaje</p>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Qué aprendiste (ej. el testimonio a cámara supera al demo)"
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-4 focus:border-accent outline-none"
        />
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Evidencia: los números" className={INPUT_CLS} />
          <input
            value={sourceAd}
            onChange={(e) => setSourceAd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Anuncio de donde salió (opcional)"
            className={INPUT_CLS}
          />
        </div>
        <div className="flex justify-end">
          <button
            onClick={add}
            disabled={!brandId || !text.trim()}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-on-accent disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Guardar aprendizaje
          </button>
        </div>
      </div>

      {loading ? <Loading /> : items.length === 0 ? (
        <Empty>
          Un aprendizaje no es una opinión: es un patrón que ya te dio dinero. Si no puedes escribir
          el número que lo sostiene, todavía no es un aprendizaje.
        </Empty>
      ) : (
        <div className="space-y-5">
          {activas.length === 0 ? (
            <p className="text-xs text-ink-4">No hay aprendizajes activos.</p>
          ) : (
            <div className="space-y-2">
              {activas.map((l) => (
                <LearningCard key={l.id} l={l} onPatch={(p) => patch(l.id, p)} onRemove={() => { if (confirm('¿Eliminar este aprendizaje?')) remove(l.id); }} />
              ))}
            </div>
          )}
          {archivadas.length > 0 && (
            <div>
              <button
                onClick={() => setShowArchived((v) => !v)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-ink-4 hover:text-ink-2 mb-2"
              >
                {showArchived ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Archivados ({archivadas.length})
              </button>
              {showArchived && (
                <div className="space-y-2 opacity-60">
                  {archivadas.map((l) => (
                    <LearningCard key={l.id} l={l} onPatch={(p) => patch(l.id, p)} onRemove={() => { if (confirm('¿Eliminar este aprendizaje?')) remove(l.id); }} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LearningCard({ l, onPatch, onRemove }: {
  l: Learning;
  onPatch: (payload: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const date = fmtDate(l.created_at);
  const tags: string[] = [];
  if (l.dimension && l.dimension_value) tags.push(`${l.dimension}: ${l.dimension_value}`);
  else if (l.dimension_value) tags.push(l.dimension_value);
  if (l.source_ad) tags.push(`Anuncio: ${l.source_ad}`);
  if (l.suspect) tags.push('Por confirmar');

  return (
    <div className="rounded-xl border border-line bg-surface p-4 min-w-0">
      <div className="flex items-start gap-3 min-w-0">
        <CheckCircle2 className={`w-4 h-4 mt-0.5 shrink-0 ${l.active === false ? 'text-ink-4' : 'text-ok'}`} />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {date && <span className="text-[10px] text-ink-4 font-[family-name:var(--font-mono)] tabular-nums">{date}</span>}
            <SourceChip source={l.source} />
          </div>
          {editing ? (
            <div className="space-y-2">
              <Field label="Aprendizaje" value={l.text} rows={2} placeholder="Qué aprendiste" onSave={(v) => onPatch({ text: v })} />
              <Field label="Evidencia" value={l.evidence} rows={2} placeholder="Los números que lo prueban" onSave={(v) => onPatch({ evidence: v })} />
              <Field label="Anuncio" value={l.source_ad} placeholder="De qué anuncio salió" onSave={(v) => onPatch({ source_ad: v })} />
            </div>
          ) : (
            <>
              <p className="text-sm text-ink leading-relaxed break-words">{l.text}</p>
              {l.evidence && (
                <p className="text-xs text-ink-3 leading-relaxed break-words">
                  <span className="text-ink-4">Evidencia: </span>{l.evidence}
                </p>
              )}
            </>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-line text-ink-3 max-w-full truncate">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setEditing((v) => !v)} className="text-[10px] text-ink-4 hover:text-ink-2">
            {editing ? 'Listo' : 'Editar'}
          </button>
          <button onClick={() => onPatch({ active: l.active === false })} className="text-[10px] text-ink-4 hover:text-ink-2">
            {l.active === false ? 'Reactivar' : 'Archivar'}
          </button>
          <button onClick={onRemove} className="text-ink-4 hover:text-danger" title="Eliminar">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// 6 · FUENTES — lo que entra de afuera: documentos de la marca, notas y
// búsqueda web. Todo lo que se guarda aquí lo lee el Cerebro.
// ===========================================================================

function FuentesTab({ brandId }: { brandId: string | null }) {
  const { items, loading, create, patch, remove } = useBank<Note>('/api/research/notes', brandId);
  const notes = items.filter((n) => n.kind !== 'hook');

  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  const run = async (q?: string) => {
    const text = (q ?? query).trim();
    if (!text || !brandId || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setSaved(false);
    setLastQuery(text);
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, query: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error en la búsqueda');
    } finally {
      setRunning(false);
    }
  };

  const saveResult = async () => {
    if (!result) return;
    await create({ kind: 'externo', title: lastQuery.slice(0, 180), body: result, source: 'Búsqueda web' });
    setSaved(true);
  };

  const addManual = () => {
    if (!manual.trim() || !brandId) return;
    create({ kind: 'externo', title: manual.trim() });
    setManual('');
  };

  return (
    <div>
      <TabHead
        title="Fuentes"
        hint="Lo que entra de afuera: tus documentos, reseñas, dudas de clientes y competidores. Todo lo que guardes aquí lo usa el Cerebro."
      />

      <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start min-w-0">
        {/* Documentos de marca */}
        <div className="min-w-0">
          <SectionHead
            title="Documentos de marca"
            hint="Sube tus análisis, briefs o research (PDF/TXT/MD). La IA los destila y los usa como fuente aparte de los anuncios."
          />
          {brandId ? <BrandDocsPanel brandId={brandId} /> : <Empty>Elige una marca para subir documentos.</Empty>}
        </div>

        {/* Notas e investigación */}
        <div className="min-w-0">
          <SectionHead
            title="Notas e investigación"
            hint="Pega lo que viste afuera o busca en la web; cada nota queda como contexto del Cerebro."
          />

          {/* Buscar */}
          <div className="rounded-xl border border-line bg-surface p-4 mb-4 space-y-3 min-w-0">
            <div className="flex gap-2 min-w-0">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
                rows={2}
                placeholder="¿Qué quieres investigar? (reseñas, dudas, competidores, ángulos…)"
                className="flex-1 min-w-0 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-4 focus:border-accent outline-none resize-none"
              />
              <button
                onClick={() => run()}
                disabled={running || !query.trim() || !brandId}
                className="px-4 rounded-lg gradient-blue text-on-accent disabled:opacity-50 shrink-0"
                title="Buscar"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {RESEARCH_QUICK.map((q) => (
                <button
                  key={q}
                  onClick={() => { setQuery(q); run(q); }}
                  disabled={running}
                  className="text-xs px-3 py-1.5 rounded-lg border border-line text-ink-3 hover:text-ink hover:border-accent/50 transition-colors disabled:opacity-50 max-w-full truncate"
                  title={q}
                >
                  {q.length > 60 ? `${q.slice(0, 60)}…` : q}
                </button>
              ))}
            </div>

            {running && (
              <div className="flex items-center gap-2 text-sm text-ink-4 py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Buscando (web + tu contexto)…
              </div>
            )}
            {error && <p className="text-sm text-danger break-words">{error}</p>}
            {result && (
              <div className="rounded-lg border border-line bg-canvas p-4 min-w-0">
                <div className="text-sm text-ink-2 whitespace-pre-wrap leading-relaxed break-words">{result}</div>
                <div className="mt-4 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-ink-4">¿Sirve? Guárdalo y el Cerebro lo usa desde ahora.</p>
                  <button
                    onClick={saveResult}
                    disabled={saved}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-50 shrink-0"
                  >
                    {saved ? <><CheckCircle2 className="w-3.5 h-3.5" /> Guardado</> : <><Plus className="w-3.5 h-3.5" /> Guardar como nota</>}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Nota manual */}
          <div className="flex gap-2 mb-3 min-w-0">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addManual(); }}
              placeholder="Pega algo que viste afuera: una reseña, un comentario, un anuncio…"
              className={`${INPUT_CLS} min-w-0`}
            />
            <button
              onClick={addManual}
              disabled={!brandId || !manual.trim()}
              className="px-3 rounded-lg border border-line text-ink-3 hover:text-ink disabled:opacity-50 shrink-0"
              title="Guardar nota"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {loading ? <Loading /> : notes.length === 0 ? (
            <Empty>
              Todavía no hay notas. Entre más pegues de afuera (reseñas reales, dudas de clientes,
              anuncios de competidores), menos inventa la IA.
            </Empty>
          ) : (
            <div className="space-y-2">
              {notes.map((n) => (
                <div key={n.id} className="group rounded-lg border border-line bg-surface px-3 py-2.5 min-w-0">
                  <div className="flex items-start gap-2 min-w-0">
                    <div className="flex-1 min-w-0">
                      <Field value={n.title} placeholder="Título de la nota" onSave={(v) => patch(n.id, { title: v })} />
                    </div>
                    <button
                      onClick={() => { if (confirm('¿Eliminar esta nota?')) remove(n.id); }}
                      className="text-ink-4 hover:text-danger mt-1.5 shrink-0"
                      title="Eliminar"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {n.body && (
                    <p className="text-[11px] text-ink-3 mt-1.5 whitespace-pre-wrap leading-relaxed line-clamp-6 break-words">{n.body}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-1 mt-2 min-w-0">
                    {NOTE_STATUS.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => patch(n.id, { status: s.id })}
                        className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                          n.status === s.id ? s.cls : 'border-transparent text-ink-4 hover:text-ink-3'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                    {n.source && <span className="text-[9px] text-ink-4 ml-1 truncate">· {n.source}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}


/**
 * Documentos externos de la marca (análisis propios, research, briefs).
 * Se destilan con IA y alimentan TODO el ecosistema como fuente SEPARADA de
 * lo que se extrae de los anuncios.
 */
function BrandDocsPanel({ brandId }: { brandId: string }) {
  const [docs, setDocs] = useState<Array<{ id: string; filename: string; created_at: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    await Promise.resolve();
    const d = await fetch(`/api/brands/${brandId}/docs`)
      .then((r) => (r.ok ? r.json() : { docs: [] }))
      .catch(() => ({ docs: [] }));
    setDocs(d.docs ?? []);
  }, [brandId]);

  // La carga va dentro de un microtask: así el efecto nunca hace setState síncrono.
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const dataBase64 = btoa(binary);
      const mime = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain');
      const res = await fetch(`/api/brands/${brandId}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, dataBase64, mime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error subiendo el documento');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error subiendo el documento');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (id: string) => {
    if (!confirm('¿Quitar este documento del contexto?')) return;
    await fetch(`/api/brands/${brandId}/docs?doc=${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-3 flex items-center gap-1.5 min-w-0">
          <FileText className="w-3.5 h-3.5 text-accent shrink-0" /> <span className="truncate">{docs.length} documento{docs.length === 1 ? '' : 's'}</span>
        </h3>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs text-accent hover:text-accent disabled:opacity-60 shrink-0"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {uploading ? 'Destilando…' : 'Subir'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown,text/plain,application/pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </div>
      <p className="text-[10px] text-ink-4 mb-2 break-words">PDF, TXT o MD, máximo 8 MB.</p>
      {error && <p className="text-xs text-danger mb-2 break-words">{error}</p>}
      <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
        {docs.map((d) => (
          <div key={d.id} className="group flex items-center gap-2 text-xs text-ink-2 rounded-lg border border-surface-2 bg-canvas px-2.5 py-2 min-w-0">
            <FileText className="w-3.5 h-3.5 text-ink-4 shrink-0" />
            <span className="flex-1 min-w-0 truncate" title={d.filename}>{d.filename}</span>
            <span className="text-[9px] text-ink-4 shrink-0 font-[family-name:var(--font-mono)] tabular-nums">{new Date(d.created_at).toLocaleDateString('es-MX')}</span>
            <button onClick={() => remove(d.id)} className="text-ink-4 hover:text-danger shrink-0" title="Quitar">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        {docs.length === 0 && (
          <p className="text-xs text-ink-4 break-words">
            Todavía no hay documentos. Sube los análisis que ya hiciste: el chat, la búsqueda y los guiones los toman en cuenta.
          </p>
        )}
      </div>
    </div>
  );
}
