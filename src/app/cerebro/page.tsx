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
  Copy, ArrowLeftRight,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { ANGLE_STATUS } from '@/lib/plan';
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
  evidence: string | null; status: string | null; source: string | null;
}
interface Angle {
  id: string; code: string | null; name: string | null; persona_id: string | null;
  pain: string | null; mechanism: string | null; psychology: string | null; objection: string | null;
  status: string | null; evidence: string | null; source: string | null;
}
/** Fila de /api/library. Todo opcional: la ruta la está reescribiendo otro agente. */
interface LibAd {
  ad_id?: string; ad_name?: string | null; spend?: number | null; purchases?: number | null;
  revenue?: number | null; angle_id?: string | null;
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
  { id: 'angulos', label: 'Ángulos', icon: Compass },
  { id: 'hooks', label: 'Hooks', icon: Zap },
  { id: 'aprendizajes', label: 'Aprendizajes', icon: Lightbulb },
  { id: 'fuentes', label: 'Fuentes', icon: Globe },
] as const;

/** Pestañas viejas que pueden seguir en links guardados. */
const TAB_ALIASES: Record<string, TabId> = { pruebas: 'aprendizajes', externo: 'fuentes', conceptos: 'angulos' };

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

/** Campo que se guarda solo al salir (onBlur). Sin controlar el valor: así no
 *  hay parpadeo mientras escribes ni estados sincronizados de más. */
function Field({ label, value, placeholder, rows, mono, onSave }: {
  label?: string;
  value: string | null;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  onSave: (v: string) => void;
}) {
  const commit = (v: string) => { if (v.trim() !== (value ?? '').trim()) onSave(v.trim()); };
  return (
    <div className="w-full min-w-0">
      {label && <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1">{label}</p>}
      {rows ? (
        <textarea
          defaultValue={value ?? ''}
          placeholder={placeholder}
          rows={rows}
          onBlur={(e) => commit(e.target.value)}
          className={`${INPUT_CLS} resize-y leading-relaxed`}
        />
      ) : (
        <input
          defaultValue={value ?? ''}
          placeholder={placeholder}
          onBlur={(e) => commit(e.target.value)}
          className={`${INPUT_CLS}${mono ? ' font-[family-name:var(--font-mono)] uppercase tracking-wide' : ''}`}
        />
      )}
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
    if (!brandId) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId, ...payload }),
    });
    await load();
  };

  const patch = async (id: string, payload: Record<string, unknown>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...payload } as T : it)));
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

  return { items, loading, load, create, patch, remove };
}

// ---------------------------------------------------------------------------
// Banner de ingesta — el cerebro se pone al día con los análisis pendientes.
// ---------------------------------------------------------------------------

interface Counts { personas: number; angles: number; hooks: number; learnings: number }

function IngestBanner({ brandId }: { brandId: string | null }) {
  const [pending, setPending] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    await Promise.resolve();
    if (!brandId) { setPending(0); return; }
    try {
      const r = await fetch(`/api/brain/ingest?brand=${brandId}`);
      const d = await r.json();
      setPending(Number(d.pending) || 0);
    } catch {
      setPending(0);
    }
  }, [brandId]);

  // La carga va dentro de un microtask: así el efecto nunca hace setState síncrono.
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const run = async () => {
    if (!brandId || running) return;
    setRunning(true);
    setResult(null);
    setTotal(pending);
    setDone(0);
    const acc: Counts = { personas: 0, angles: 0, hooks: 0, learnings: 0 };
    let left = pending;
    try {
      // Se llama en bucle hasta que no quede nada. El backfill procesa de 8 en 8
      // para no pasarse del tiempo de la función.
      for (let i = 0; i < 40 && left > 0; i++) {
        const res = await fetch('/api/brain/ingest/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandId }),
        });
        const d = (await res.json()) as {
          processed?: number; remaining?: number; created?: Counts;
        };
        for (const k of ['personas', 'angles', 'hooks', 'learnings'] as const) {
          acc[k] += d.created?.[k] ?? 0;
        }
        const remaining = Number(d.remaining) || 0;
        setDone((v) => v + (Number(d.processed) || 0));
        setPending(remaining);
        // Si no avanzó, no tiene caso seguir dándole vueltas.
        if (!d.processed || remaining >= left) { left = 0; break; }
        left = remaining;
      }
      const parts: string[] = [];
      if (acc.personas) parts.push(`${acc.personas} persona${acc.personas > 1 ? 's' : ''}`);
      if (acc.angles) parts.push(`${acc.angles} ángulo${acc.angles > 1 ? 's' : ''}`);
      if (acc.hooks) parts.push(`${acc.hooks} hook${acc.hooks > 1 ? 's' : ''}`);
      if (acc.learnings) parts.push(`${acc.learnings} aprendizaje${acc.learnings > 1 ? 's' : ''}`);
      setResult(parts.length ? `El cerebro guardó ${parts.join(', ')}.` : 'El cerebro leyó todo: no había nada nuevo que guardar.');
    } catch {
      setResult('Algo falló leyendo los análisis. Vuelve a intentarlo.');
    } finally {
      setRunning(false);
      await load();
    }
  };

  if (!brandId || (pending === 0 && !running && !result)) return null;

  return (
    <div className="mb-4 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <p className="text-xs text-ink flex items-center gap-2 break-words">
          <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
          {running
            ? `Leyendo tus anuncios ganadores… ${done}${total ? ` de ${total}` : ''}`
            : pending > 0
              ? `Tienes ${pending} análisis que el cerebro todavía no ha leído`
              : 'El cerebro está al día'}
        </p>
        <p className="text-[10px] text-ink-4 mt-0.5 break-words">
          {result ?? 'De los análisis de tus anuncios salen las personas, los ángulos, los hooks y los aprendizajes.'}
        </p>
      </div>
      {pending > 0 && (
        <button
          onClick={run}
          disabled={running}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-on-accent disabled:opacity-60 shrink-0"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
          {running ? 'Leyendo…' : 'Alimentar el cerebro'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function CerebroPage() {
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
          <IngestBanner key={activeBrandId} brandId={activeBrandId} />
          {tab === 'chat' && <ChatTab brandId={activeBrandId} brandName={activeBrand?.name ?? ''} />}
          {tab === 'personas' && <PersonasTab key={activeBrandId} brandId={activeBrandId} />}
          {tab === 'angulos' && <AnglesTab key={activeBrandId} brandId={activeBrandId} />}
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
// 2 · PERSONAS — el banco de avatares. A quién le hablas.
// ===========================================================================

function PersonasTab({ brandId }: { brandId: string | null }) {
  const { items, loading, create, patch, remove } = useBank<Persona>('/api/plan/personas', brandId);

  return (
    <div>
      <TabHead
        title="Personas"
        hint="A quién le hablas. Cada anuncio nace de una persona con un dolor concreto."
        action={
          <button
            onClick={() => create({ name: 'Persona nueva', status: 'activa' })}
            disabled={!brandId}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-on-accent disabled:opacity-50 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar persona
          </button>
        }
      />
      {loading ? <Loading /> : items.length === 0 ? (
        <Empty>
          Sé específico. “Mujeres 25-45” no es una persona, es un censo. Escribe a quién le duele
          algo, qué le duele y qué ya intentó para quitárselo.
        </Empty>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((p) => (
            <div key={p.id} className="rounded-xl border border-line bg-surface p-4 space-y-3 min-w-0">
              <div className="flex items-start gap-2 min-w-0">
                <div className="flex-1 min-w-0">
                  <Field value={p.name} placeholder="Nombre de la persona" onSave={(v) => patch(p.id, { name: v })} />
                </div>
                <button
                  onClick={() => { if (confirm('¿Eliminar esta persona?')) remove(p.id); }}
                  className="text-ink-4 hover:text-danger mt-1.5 shrink-0"
                  title="Eliminar"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <IaMark source={p.source} />
              <Field label="Descripción" value={p.description} rows={2} placeholder="Quién es, en una frase que puedas imaginar" onSave={(v) => patch(p.id, { description: v })} />
              <Field label="Dolores" value={p.pains} rows={2} placeholder="Qué le duele, en sus palabras" onSave={(v) => patch(p.id, { pains: v })} />
              <Field label="Deseos" value={p.desires} rows={2} placeholder="Qué quiere que pase después de comprar" onSave={(v) => patch(p.id, { desires: v })} />
              <Field label="Objeciones" value={p.objections} rows={2} placeholder="Por qué no compraría" onSave={(v) => patch(p.id, { objections: v })} />
              <Field label="Evidencia" value={p.evidence} rows={2} placeholder="Reseña, comentario o mensaje que lo prueba" onSave={(v) => patch(p.id, { evidence: v })} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 3 · ÁNGULOS — la razón de compra. Cada tarjeta dice de dónde salió el
// ángulo y cómo le fue con dinero real (últimos 30 días de /api/library).
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

  // La carga va dentro de un microtask: así el efecto nunca hace setState síncrono.
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const stats = useMemo(() => statsByAngle(ads), [ads]);
  return { stats, eco, currency, loading };
}

function AnglesTab({ brandId }: { brandId: string | null }) {
  const { items, loading, create, patch, remove } = useBank<Angle>('/api/plan/angles', brandId);
  const personas = useBank<Persona>('/api/plan/personas', brandId);
  const lib = useAngleStats(brandId);

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

  return (
    <div>
      <TabHead
        title="Ángulos"
        hint="Un ángulo es la razón de compra. Los que detectó la IA vienen de los anuncios de Meta; el estado sale del gasto de los últimos 30 días, no de una opinión."
        action={
          <button
            onClick={() => create({ name: 'Ángulo nuevo', status: 'sin_probar', source: 'manual' })}
            disabled={!brandId}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-on-accent disabled:opacity-50 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar ángulo
          </button>
        }
      />
      {loading ? <Loading /> : items.length === 0 ? (
        <Empty>
          Aquí vive la razón por la que alguien compra, no el formato del video. Escribe el dolor
          y el mecanismo que lo resuelve; el estado se llena solo cuando haya anuncios ligados.
        </Empty>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {sorted.map((a) => (
            <AngleCard
              key={a.id}
              angle={a}
              stats={lib.stats.get(a.id)}
              statsLoading={lib.loading}
              eco={lib.eco}
              currency={lib.currency}
              personas={personas.items}
              onPatch={(payload) => patch(a.id, payload)}
              onRemove={() => { if (confirm('¿Eliminar este ángulo?')) remove(a.id); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AngleCard({ angle: a, stats, statsLoading, eco, currency, personas, onPatch, onRemove }: {
  angle: Angle;
  stats: AngleStats | undefined;
  statsLoading: boolean;
  eco: Economics;
  currency: string | null;
  personas: Persona[];
  onPatch: (payload: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [more, setMore] = useState(false);
  const verdict = ANGLE_VERDICT[angleVerdictId(stats, eco)];

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3 min-w-0">
      {/* Código + nombre + borrar */}
      <div className="flex items-start gap-2 min-w-0">
        <div className="w-36 shrink-0 min-w-0">
          <Field value={a.code} mono placeholder="CÓDIGO" onSave={(v) => onPatch({ code: v })} />
        </div>
        <div className="flex-1 min-w-0">
          <Field value={a.name} placeholder="Nombre del ángulo" onSave={(v) => onPatch({ name: v })} />
        </div>
        <button onClick={onRemove} className="text-ink-4 hover:text-danger mt-1.5 shrink-0" title="Eliminar">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Persona */}
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1">Persona</p>
        <select
          value={a.persona_id ?? ''}
          onChange={(e) => onPatch({ persona_id: e.target.value || null })}
          className={INPUT_CLS}
        >
          <option value="">Sin persona</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>{p.name ?? 'Sin nombre'}</option>
          ))}
        </select>
      </div>

      {/* Origen */}
      <IaMark source={a.source} />

      {/* Estado calculado + evidencia de los últimos 30 días */}
      <div className="rounded-lg border border-line bg-canvas px-3 py-2 space-y-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className={`text-[10px] px-2 py-0.5 rounded border font-medium shrink-0 ${verdict.cls}`}>
            {verdict.label}
          </span>
          <span className="text-[10px] text-ink-4">Estado calculado</span>
        </div>
        <p className="text-[11px] text-ink-3 break-words font-[family-name:var(--font-mono)] tabular-nums">
          {statsLoading
            ? 'Cargando últimos 30 días…'
            : stats && stats.n > 0
              ? `Últimos 30 días: ${stats.n} anuncio${stats.n === 1 ? '' : 's'} · ${fmtMoney(stats.spend, currency)} · ROAS ${fmtRoas(stats.roas)} · CPA ${stats.cpa == null ? '—' : fmtMoney(stats.cpa, currency)}`
              : 'Sin anuncios ligados todavía'}
        </p>
      </div>

      <Field label="Dolor" value={a.pain} rows={2} placeholder="Qué problema real ataca" onSave={(v) => onPatch({ pain: v })} />
      <Field label="Mecanismo (producto)" value={a.mechanism} rows={2} placeholder="Por qué el producto resuelve el dolor" onSave={(v) => onPatch({ mechanism: v })} />

      {/* Más: lo que no hace falta ver siempre */}
      <button
        onClick={() => setMore((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-ink-4 hover:text-ink-2"
      >
        {more ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {more ? 'Menos' : 'Más'}
      </button>
      {more && (
        <div className="space-y-3 pt-1 border-t border-line min-w-0">
          <Field label="Psicología (por qué convierte)" value={a.psychology} rows={2} placeholder="La palanca mental que activa" onSave={(v) => onPatch({ psychology: v })} />
          <Field label="Objeción" value={a.objection} rows={2} placeholder="Qué duda hay que tumbar" onSave={(v) => onPatch({ objection: v })} />
          <Field label="Evidencia" value={a.evidence} rows={2} placeholder="Qué te hace creer que este ángulo jala" onSave={(v) => onPatch({ evidence: v })} />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1">Estado manual (opcional)</p>
            <select
              value={a.status ?? ''}
              onChange={(e) => onPatch({ status: e.target.value || null })}
              className={INPUT_CLS}
            >
              <option value="">Sin estado manual</option>
              {ANGLE_STATUS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-ink-4 mt-1 break-words">
              No cambia el estado calculado de arriba; es solo tu nota.
            </p>
          </div>
        </div>
      )}
    </div>
  );
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
