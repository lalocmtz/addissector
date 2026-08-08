'use client';

// =============================================================================
// AdDNA — CEREBRO de la marca.
// El banco de todo lo que cimenta un buen anuncio, en pestañas:
// Chat · Personas · Ángulos · Conceptos · Hooks · Pruebas efectivas · Externo.
// El chat sigue igual (contexto completo: cerebro + ganadores + aprendizajes),
// y "Externo" absorbe lo que antes era Research: búsqueda web, notas y
// documentos de la marca.
// =============================================================================

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, Send, Trash2, Plus, X, Brain, Lightbulb, ChevronDown, ChevronRight, Save,
  FileText, Upload, Users, Compass, Layers, Zap, CheckCircle2, Globe, Search, ArrowRight,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { ANGLE_STATUS, CONCEPT_STATUS } from '@/lib/plan';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface Msg { id?: string; role: 'user' | 'assistant'; content: string }
interface Section { id: string; title: string; content: string; sort: number }
interface Learning { id: string; text: string; evidence: string | null; source_ad: string | null; active: boolean }
interface Persona {
  id: string; name: string | null; description: string | null; pains: string | null;
  desires: string | null; objections: string | null; awareness_stage: string | null;
  evidence: string | null; status: string | null;
}
interface Angle {
  id: string; code: string | null; name: string | null; persona_id: string | null;
  pain: string | null; mechanism: string | null; objection: string | null;
  status: string | null; evidence: string | null; source: string | null;
}
interface Concept {
  id: string; angle_id: string | null; number: number | null; code: string | null;
  name: string | null; narrative_format: string | null; hypothesis: string | null;
  status: string | null;
}
interface Note {
  id: string; kind: string; title: string; body: string | null;
  source: string | null; status: string; created_at: string;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'chat', label: 'Chat', icon: Brain },
  { id: 'personas', label: 'Personas', icon: Users },
  { id: 'angulos', label: 'Ángulos', icon: Compass },
  { id: 'conceptos', label: 'Conceptos', icon: Layers },
  { id: 'hooks', label: 'Hooks', icon: Zap },
  { id: 'pruebas', label: 'Pruebas efectivas', icon: CheckCircle2 },
  { id: 'externo', label: 'Externo', icon: Globe },
] as const;

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
  { id: 'idea', label: 'Idea', cls: 'border-[#334155] text-[#94a3b8]' },
  { id: 'en_prueba', label: 'En prueba', cls: 'border-[#eab308]/40 text-[#facc15]' },
  { id: 'funciona', label: 'Funciona', cls: 'border-[#22c55e]/40 text-[#4ade80]' },
  { id: 'descartado', label: 'Descartado', cls: 'border-[#ef4444]/40 text-[#f87171]' },
] as const;

const INPUT_CLS =
  'w-full rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-2.5 py-1.5 text-xs text-[#e2e8f0] placeholder:text-[#475569] focus:border-[#3b82f6] outline-none';

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
    <div>
      {label && <p className="text-[9px] uppercase tracking-wide text-[#475569] mb-1">{label}</p>}
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

/** Cabecera de pestaña: título + explicación de para qué sirve el banco. */
function TabHead({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h1 className="text-lg font-bold font-[family-name:var(--font-mono)] tracking-tight">{title}</h1>
        <p className="text-xs text-[#64748b] mt-0.5 max-w-2xl">{hint}</p>
      </div>
      {action}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[#1e1e2e] bg-[#0d0d14] p-10 text-center">
      <p className="text-sm text-[#64748b] max-w-lg mx-auto leading-relaxed">{children}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-xs text-[#64748b] py-10 justify-center">
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
    const t = params.get('tab');
    return TABS.some((x) => x.id === t) ? (t as TabId) : 'chat';
  });

  const goTab = (id: TabId) => {
    setTab(id);
    router.replace(id === 'chat' ? '/cerebro' : `/cerebro?tab=${id}`, { scroll: false });
  };

  return (
    <main className="flex-1 min-h-screen flex flex-col">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      {/* Pestañas */}
      <div className="border-b border-[#1e1e2e] px-4 sm:px-6 bg-[#0a0a0f]">
        <div className="max-w-[1400px] mx-auto flex items-center gap-1 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => goTab(id)}
              className={`flex items-center gap-1.5 text-xs px-3 py-2.5 border-b-2 -mb-px whitespace-nowrap transition-colors ${
                tab === id
                  ? 'border-[#3b82f6] text-[#f1f5f9]'
                  : 'border-transparent text-[#64748b] hover:text-[#cbd5e1]'
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
          {tab === 'chat' && <ChatTab brandId={activeBrandId} brandName={activeBrand?.name ?? ''} />}
          {tab === 'personas' && <PersonasTab key={activeBrandId} brandId={activeBrandId} />}
          {tab === 'angulos' && <AnglesTab key={activeBrandId} brandId={activeBrandId} />}
          {tab === 'conceptos' && <ConceptsTab key={activeBrandId} brandId={activeBrandId} />}
          {tab === 'hooks' && <HooksTab key={activeBrandId} brandId={activeBrandId} />}
          {tab === 'pruebas' && <PruebasTab key={activeBrandId} brandId={activeBrandId} />}
          {tab === 'externo' && <ExternoTab key={activeBrandId} brandId={activeBrandId} />}
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
    <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
      <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] flex flex-col" style={{ height: 'calc(100vh - 190px)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e]">
          <h1 className="text-sm font-bold flex items-center gap-2">
            <Brain className="w-4 h-4 text-[#3b82f6]" />
            Cerebro · {brandName}
          </h1>
          {messages.length > 0 && (
            <button onClick={clearChat} className="text-xs text-[#64748b] hover:text-[#f43f5e] flex items-center gap-1">
              <Trash2 className="w-3.5 h-3.5" /> Limpiar
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !thinking && (
            <div className="text-center py-10">
              <Brain className="w-10 h-10 text-[#334155] mx-auto mb-3" />
              <p className="text-sm text-[#94a3b8]">
                Pregúntale al cerebro. Sabe qué está funcionando en Meta ahora mismo,
                qué dicen los guiones ganadores y qué has aprendido.
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-[#1e1e2e] text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[#3b82f6]/50 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m.id ?? i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === 'user'
                  ? 'bg-[#1d4ed8]/25 text-[#e2e8f0] border border-[#1d4ed8]/30'
                  : 'bg-[#111118] text-[#cbd5e1] border border-[#1e1e2e]'
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex items-center gap-2 text-xs text-[#64748b]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pensando con todo tu contexto…
            </div>
          )}
          {error && <p className="text-xs text-[#f87171]">{error}</p>}
          {suggestedLearning && !thinking && (
            <button
              onClick={() => addLearning(suggestedLearning)}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-[#eab308]/30 bg-[#eab308]/5 text-[#fde68a] hover:bg-[#eab308]/10"
            >
              <Lightbulb className="w-3.5 h-3.5" /> Guardar aprendizaje: “{suggestedLearning.slice(0, 90)}…”
            </button>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-3 border-t border-[#1e1e2e]">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              rows={2}
              placeholder="Pide guiones, hooks, diagnóstico, ideas…"
              className="flex-1 rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-sm text-[#f1f5f9] focus:border-[#3b82f6] outline-none resize-none"
            />
            <button
              onClick={() => send()}
              disabled={thinking || !input.trim()}
              className="px-4 rounded-lg gradient-blue text-white disabled:opacity-50"
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
    <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-[#94a3b8]">Contexto de la marca</h2>
        <button onClick={() => setShowNew((v) => !v)} className="text-xs text-[#3b82f6] hover:text-[#60a5fa] flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> Sección
        </button>
      </div>
      {showNew && (
        <div className="flex gap-2 mb-3">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Título (ej. Producto, Compliance, Tono)"
            className="flex-1 rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-2.5 py-1.5 text-xs text-[#f1f5f9] focus:border-[#3b82f6] outline-none"
          />
          <button
            onClick={() => { if (newTitle.trim()) { saveSection({ title: newTitle.trim() }); setNewTitle(''); setShowNew(false); } }}
            className="text-xs px-3 rounded-lg gradient-blue text-white"
          >
            Crear
          </button>
        </div>
      )}
      {sections.length === 0 && (
        <p className="text-xs text-[#64748b]">
          Aún no hay contexto. Crea secciones (producto, compliance, tono…) — el chat las usa en cada respuesta.
          Las personas y los ángulos ya tienen su propia pestaña arriba.
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
    <div className="rounded-lg border border-[#15151f] bg-[#0a0a0f]">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-[#e2e8f0]">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-[#64748b]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#64748b]" />}
        <span className="flex-1 text-left font-medium">{section.title}</span>
        {section.content && <span className="text-[9px] text-[#475569]">{section.content.length} chars</span>}
      </button>
      {open && (
        <div className="px-2.5 pb-2.5">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-[#1e1e2e] bg-[#0d0d14] px-2.5 py-2 text-xs text-[#e2e8f0] focus:border-[#3b82f6] outline-none resize-y"
          />
          <div className="flex justify-between mt-1.5">
            <button onClick={onDelete} className="text-[10px] text-[#64748b] hover:text-[#f43f5e]">Eliminar</button>
            {dirty && (
              <button onClick={() => onSave(content)} className="flex items-center gap-1 text-[10px] text-[#3b82f6] hover:text-[#60a5fa]">
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
        hint="A quién le hablas. Cada anuncio nace de una persona con un dolor concreto — si no sabes quién es, el anuncio le habla a nadie."
        action={
          <button
            onClick={() => create({ name: 'Persona nueva', status: 'activa' })}
            disabled={!brandId}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-white disabled:opacity-50 shrink-0"
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
            <div key={p.id} className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4 space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Field value={p.name} placeholder="Nombre de la persona" onSave={(v) => patch(p.id, { name: v })} />
                </div>
                <button
                  onClick={() => { if (confirm('¿Eliminar esta persona?')) remove(p.id); }}
                  className="text-[#475569] hover:text-[#f87171] mt-1.5"
                  title="Eliminar"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
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
// 3 · ÁNGULOS — la razón de compra. Lo que sostiene un concepto.
// ===========================================================================

function AnglesTab({ brandId }: { brandId: string | null }) {
  const { items, loading, create, patch, remove } = useBank<Angle>('/api/plan/angles', brandId);
  const personas = useBank<Persona>('/api/plan/personas', brandId);

  return (
    <div>
      <TabHead
        title="Ángulos"
        hint="La razón de compra. Un ángulo es dolor + mecanismo + objeción resuelta. Un mal concepto no mata un ángulo: pruébalo con tres antes de enterrarlo."
        action={
          <button
            onClick={() => create({ name: 'Ángulo nuevo', status: 'sin_probar' })}
            disabled={!brandId}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-white disabled:opacity-50 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar ángulo
          </button>
        }
      />
      {loading ? <Loading /> : items.length === 0 ? (
        <Empty>
          Aquí vive la razón por la que alguien compra, no el formato del video. Escribe el dolor,
          el mecanismo que lo resuelve y la objeción que hay que tumbar.
        </Empty>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {items.map((a) => (
            <div key={a.id} className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4 space-y-3">
              <div className="flex items-start gap-2">
                <div className="w-28 shrink-0">
                  <Field value={a.code} mono placeholder="CÓDIGO" onSave={(v) => patch(a.id, { code: v })} />
                </div>
                <div className="flex-1">
                  <Field value={a.name} placeholder="Nombre del ángulo" onSave={(v) => patch(a.id, { name: v })} />
                </div>
                <button
                  onClick={() => { if (confirm('¿Eliminar este ángulo?')) remove(a.id); }}
                  className="text-[#475569] hover:text-[#f87171] mt-1.5"
                  title="Eliminar"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex flex-wrap gap-1">
                {ANGLE_STATUS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => patch(a.id, { status: s.id })}
                    className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
                      a.status === s.id ? s.cls : 'border-transparent text-[#475569] hover:text-[#94a3b8]'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div>
                <p className="text-[9px] uppercase tracking-wide text-[#475569] mb-1">Persona</p>
                <select
                  value={a.persona_id ?? ''}
                  onChange={(e) => patch(a.id, { persona_id: e.target.value || null })}
                  className={INPUT_CLS}
                >
                  <option value="">Sin persona</option>
                  {personas.items.map((p) => (
                    <option key={p.id} value={p.id}>{p.name ?? 'Sin nombre'}</option>
                  ))}
                </select>
              </div>

              <Field label="Dolor" value={a.pain} rows={2} placeholder="Qué problema real ataca" onSave={(v) => patch(a.id, { pain: v })} />
              <Field label="Mecanismo" value={a.mechanism} rows={2} placeholder="Por qué el producto lo resuelve" onSave={(v) => patch(a.id, { mechanism: v })} />
              <Field label="Objeción" value={a.objection} rows={2} placeholder="Qué duda hay que tumbar" onSave={(v) => patch(a.id, { objection: v })} />
              <Field label="Evidencia" value={a.evidence} rows={2} placeholder="Qué te hace creer que este ángulo jala" onSave={(v) => patch(a.id, { evidence: v })} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 4 · CONCEPTOS — solo lectura. Se planean y se miden en Planificación.
// ===========================================================================

function ConceptsTab({ brandId }: { brandId: string | null }) {
  const { items, loading } = useBank<Concept>('/api/plan/concepts', brandId);

  const groups = CONCEPT_STATUS.map((s) => ({
    ...s,
    list: items.filter((c) => (c.status ?? 'idea') === s.id),
  })).filter((g) => g.list.length > 0);

  const sinEstado = items.filter((c) => !CONCEPT_STATUS.some((s) => s.id === (c.status ?? 'idea')));

  return (
    <div>
      <TabHead
        title="Conceptos"
        hint="La ejecución de un ángulo: el video concreto que se produce y se sube."
        action={
          <Link
            href="/plan"
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-[#3b82f6]/40 text-[#60a5fa] hover:bg-[#3b82f6]/10 shrink-0"
          >
            Los conceptos se planean y se miden en Planificación <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        }
      />
      {loading ? <Loading /> : items.length === 0 ? (
        <Empty>
          Todavía no hay conceptos. Se crean en Planificación, donde cada uno recibe su número,
          su código y sus variantes con el nombre exacto que se pega en Meta.
        </Empty>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] px-2 py-0.5 rounded border ${g.cls}`}>{g.label}</span>
                <span className="text-[10px] text-[#475569]">{g.list.length}</span>
              </div>
              <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] divide-y divide-[#15151f]">
                {g.list.map((c) => (
                  <div key={c.id} className="flex items-start gap-3 px-3 py-2.5">
                    <span className="text-[10px] font-[family-name:var(--font-mono)] text-[#64748b] w-36 shrink-0 truncate" title={c.code ?? ''}>
                      {c.code ?? `#${c.number ?? '—'}`}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#e2e8f0] truncate">{c.name ?? 'Sin nombre'}</p>
                      {c.hypothesis && <p className="text-[10px] text-[#64748b] truncate">{c.hypothesis}</p>}
                    </div>
                    {c.narrative_format && (
                      <span className="text-[9px] text-[#475569] shrink-0 hidden sm:inline">{c.narrative_format}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {sinEstado.length > 0 && (
            <p className="text-[10px] text-[#475569]">{sinEstado.length} concepto(s) con un estado que no reconozco.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 5 · HOOKS — los primeros 3 segundos que sí detuvieron el scroll.
// ===========================================================================

function HooksTab({ brandId }: { brandId: string | null }) {
  const { items, loading, create, patch, remove } = useBank<Note>('/api/research/notes', brandId);
  const hooks = items.filter((n) => n.kind === 'hook');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState('');

  const add = async () => {
    if (!title.trim()) return;
    await create({ kind: 'hook', title: title.trim(), body: body.trim() || null, source: source.trim() || null });
    setTitle(''); setBody(''); setSource('');
  };

  return (
    <div>
      <TabHead
        title="Hooks"
        hint="Los primeros segundos que sí detuvieron el scroll. Guárdalos literales: la frase exacta vale más que el resumen."
      />

      <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4 mb-5 space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="El hook, palabra por palabra…"
          className="w-full rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-sm text-[#f1f5f9] placeholder:text-[#475569] focus:border-[#3b82f6] outline-none"
        />
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="¿Por qué funcionó?"
            className={INPUT_CLS}
          />
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="¿De qué anuncio salió?"
            className={INPUT_CLS}
          />
        </div>
        <div className="flex justify-end">
          <button
            onClick={add}
            disabled={!brandId || !title.trim()}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-white disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Guardar hook
          </button>
        </div>
      </div>

      {loading ? <Loading /> : hooks.length === 0 ? (
        <Empty>
          Un hook que funcionó es un activo, no un accidente. Cópialo tal cual del anuncio ganador
          y anota por qué crees que jaló — eso es lo que vas a reciclar el mes que viene.
        </Empty>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {hooks.map((n) => (
            <div key={n.id} className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4 space-y-2.5">
              <div className="flex items-start gap-2">
                <Zap className="w-3.5 h-3.5 text-[#fbbf24] mt-1.5 shrink-0" />
                <div className="flex-1">
                  <Field value={n.title} placeholder="El hook literal" onSave={(v) => patch(n.id, { title: v })} />
                </div>
                <button
                  onClick={() => { if (confirm('¿Eliminar este hook?')) remove(n.id); }}
                  className="text-[#475569] hover:text-[#f87171] mt-1.5"
                  title="Eliminar"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <Field label="Por qué funcionó" value={n.body} rows={2} placeholder="Qué tensión abre, qué promete" onSave={(v) => patch(n.id, { body: v })} />
              <Field label="De qué anuncio salió" value={n.source} placeholder="Nombre del anuncio" onSave={(v) => patch(n.id, { source: v })} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 6 · PRUEBAS EFECTIVAS — los aprendizajes confirmados con números.
// ===========================================================================

function PruebasTab({ brandId }: { brandId: string | null }) {
  const { items, loading, create, patch, remove } = useBank<Learning>('/api/learnings', brandId);
  const [text, setText] = useState('');
  const [evidence, setEvidence] = useState('');
  const [sourceAd, setSourceAd] = useState('');

  const activas = items.filter((l) => l.active !== false);
  const archivadas = items.filter((l) => l.active === false);

  const add = async () => {
    if (!text.trim()) return;
    await create({ text: text.trim(), evidence: evidence.trim() || undefined, source_ad: sourceAd.trim() || undefined });
    setText(''); setEvidence(''); setSourceAd('');
  };

  const row = (l: Learning, muted: boolean) => (
    <div key={l.id} className={`rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4 space-y-2.5 ${muted ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-2">
        <CheckCircle2 className={`w-3.5 h-3.5 mt-1.5 shrink-0 ${muted ? 'text-[#475569]' : 'text-[#4ade80]'}`} />
        <div className="flex-1">
          <Field value={l.text} placeholder="Qué aprendiste" onSave={(v) => patch(l.id, { text: v })} />
        </div>
        <button
          onClick={() => patch(l.id, { active: l.active === false })}
          className="text-[9px] text-[#64748b] hover:text-[#cbd5e1] mt-2 shrink-0"
        >
          {l.active === false ? 'Reactivar' : 'Archivar'}
        </button>
        <button
          onClick={() => { if (confirm('¿Eliminar esta prueba?')) remove(l.id); }}
          className="text-[#475569] hover:text-[#f87171] mt-1.5 shrink-0"
          title="Eliminar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <Field label="Evidencia" value={l.evidence} rows={2} placeholder="Los números que lo prueban" onSave={(v) => patch(l.id, { evidence: v })} />
      <Field label="Anuncio" value={l.source_ad} placeholder="De qué anuncio salió" onSave={(v) => patch(l.id, { source_ad: v })} />
    </div>
  );

  return (
    <div>
      <TabHead
        title="Pruebas efectivas"
        hint="Lo que ya confirmaste con dinero real. Todo lo que está aquí activo lo cita la IA cuando le pides guiones."
      />

      <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4 mb-5 space-y-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Qué aprendiste (ej. el testimonio con cara a cámara supera al demo)"
          className="w-full rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-sm text-[#f1f5f9] placeholder:text-[#475569] focus:border-[#3b82f6] outline-none"
        />
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Evidencia: los números" className={INPUT_CLS} />
          <input
            value={sourceAd}
            onChange={(e) => setSourceAd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Anuncio de donde salió"
            className={INPUT_CLS}
          />
        </div>
        <div className="flex justify-end">
          <button
            onClick={add}
            disabled={!brandId || !text.trim()}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-white disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Guardar prueba
          </button>
        </div>
      </div>

      {loading ? <Loading /> : items.length === 0 ? (
        <Empty>
          Una prueba efectiva no es una opinión: es un patrón que ya te dio dinero dos veces.
          Si no puedes escribir el número que la sostiene, todavía no es una prueba.
        </Empty>
      ) : (
        <div className="space-y-5">
          <div className="grid md:grid-cols-2 gap-3">{activas.map((l) => row(l, false))}</div>
          {archivadas.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[#475569] mb-2">Archivadas ({archivadas.length})</p>
              <div className="grid md:grid-cols-2 gap-3">{archivadas.map((l) => row(l, true))}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 7 · EXTERNO — todo lo que entra de afuera: búsqueda web, notas y documentos.
// (Aquí vive lo que antes era la sección Research.)
// ===========================================================================

function ExternoTab({ brandId }: { brandId: string | null }) {
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

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
      <div>
        <TabHead
          title="Externo"
          hint="Lo que pasa afuera: reseñas, dudas reales, competidores. Todo lo que guardes aquí lo lee el Cerebro cuando le pides ideas."
        />

        <div className="flex gap-2 mb-3">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
            rows={2}
            placeholder="¿Qué quieres investigar? (reseñas, dudas, competidores, ángulos…)"
            className="flex-1 rounded-lg border border-[#1e1e2e] bg-[#0d0d14] px-3 py-2 text-sm text-[#f1f5f9] placeholder:text-[#475569] focus:border-[#3b82f6] outline-none resize-none"
          />
          <button
            onClick={() => run()}
            disabled={running || !query.trim() || !brandId}
            className="px-4 rounded-lg gradient-blue text-white disabled:opacity-50"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-5">
          {RESEARCH_QUICK.map((q) => (
            <button
              key={q}
              onClick={() => { setQuery(q); run(q); }}
              disabled={running}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#1e1e2e] text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[#3b82f6]/50 transition-colors disabled:opacity-50"
            >
              {q.length > 60 ? `${q.slice(0, 60)}…` : q}
            </button>
          ))}
        </div>

        {running && (
          <div className="flex items-center gap-2 text-sm text-[#64748b] py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Buscando (web + tu contexto)…
          </div>
        )}
        {error && <p className="text-sm text-[#f87171] mb-3">{error}</p>}
        {result && (
          <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-5 mb-5">
            <div className="text-sm text-[#cbd5e1] whitespace-pre-wrap leading-relaxed">{result}</div>
            <div className="mt-4 pt-3 border-t border-[#1e1e2e] flex items-center justify-between gap-3">
              <p className="text-xs text-[#64748b]">¿Sirve? Guárdalo y el Cerebro lo usa desde ahora.</p>
              <button
                onClick={saveResult}
                disabled={saved}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#3b82f6]/40 text-[#60a5fa] hover:bg-[#3b82f6]/10 disabled:opacity-50"
              >
                {saved ? <><CheckCircle2 className="w-3.5 h-3.5" /> Guardado</> : <><Plus className="w-3.5 h-3.5" /> Guardar como nota</>}
              </button>
            </div>
          </div>
        )}
        {!result && !running && (
          <div className="rounded-xl border border-dashed border-[#1e1e2e] bg-[#0d0d14] p-10 text-center mb-5">
            <Compass className="w-8 h-8 text-[#334155] mx-auto mb-3" />
            <p className="text-sm text-[#64748b] max-w-lg mx-auto">
              La búsqueda conoce tus ganadores: lo que proponga viene justificado con tus números,
              no con teoría de internet.
            </p>
          </div>
        )}

        {/* Notas externas guardadas */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-[#94a3b8]">
            Notas externas ({notes.length})
          </h2>
        </div>
        <div className="flex gap-2 mb-3">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim()) { create({ kind: 'externo', title: manual.trim() }); setManual(''); } }}
            placeholder="Pega algo que viste afuera: una reseña, un comentario, un anuncio…"
            className={INPUT_CLS}
          />
          <button
            onClick={() => { if (manual.trim()) { create({ kind: 'externo', title: manual.trim() }); setManual(''); } }}
            disabled={!brandId}
            className="px-3 rounded-lg border border-[#1e1e2e] text-[#94a3b8] hover:text-[#f1f5f9] disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? <Loading /> : notes.length === 0 ? (
          <Empty>
            Aquí se acumula lo de afuera: reseñas reales, dudas de clientes, anuncios de
            competidores. Entre más pegues, menos inventa la IA.
          </Empty>
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
              <div key={n.id} className="group rounded-lg border border-[#15151f] bg-[#0d0d14] px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <Field value={n.title} placeholder="Título de la nota" onSave={(v) => patch(n.id, { title: v })} />
                  </div>
                  <button
                    onClick={() => { if (confirm('¿Eliminar esta nota?')) remove(n.id); }}
                    className="opacity-0 group-hover:opacity-100 text-[#475569] hover:text-[#f87171] mt-1.5"
                    title="Eliminar"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {n.body && (
                  <p className="text-[10px] text-[#64748b] mt-1.5 whitespace-pre-wrap leading-relaxed line-clamp-6">{n.body}</p>
                )}
                <div className="flex flex-wrap items-center gap-1 mt-2">
                  {NOTE_STATUS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => patch(n.id, { status: s.id })}
                      className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                        n.status === s.id ? s.cls : 'border-transparent text-[#475569] hover:text-[#94a3b8]'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                  {n.source && <span className="text-[9px] text-[#475569] ml-1">· {n.source}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {brandId && <BrandDocsPanel brandId={brandId} />}
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
    <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-[#94a3b8] flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-[#8b5cf6]" /> Documentos de la marca ({docs.length})
        </h2>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs text-[#3b82f6] hover:text-[#60a5fa] disabled:opacity-60"
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
      <p className="text-[10px] text-[#64748b] mb-2">
        Tus análisis y research propios (PDF/TXT/MD, máx 8 MB). La IA los destila y los usa como
        fuente EXTERNA — separada de lo que sale de los anuncios.
      </p>
      {error && <p className="text-xs text-[#f87171] mb-2">{error}</p>}
      <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
        {docs.map((d) => (
          <div key={d.id} className="group flex items-center gap-2 text-xs text-[#cbd5e1] rounded-lg border border-[#15151f] bg-[#0a0a0f] px-2.5 py-2">
            <FileText className="w-3.5 h-3.5 text-[#64748b] shrink-0" />
            <span className="flex-1 truncate" title={d.filename}>{d.filename}</span>
            <span className="text-[9px] text-[#475569]">{new Date(d.created_at).toLocaleDateString('es-MX')}</span>
            <button onClick={() => remove(d.id)} className="opacity-0 group-hover:opacity-100 text-[#64748b] hover:text-[#f43f5e]">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        {docs.length === 0 && (
          <p className="text-xs text-[#64748b]">
            Sube aquí los análisis que ya hiciste — el chat, la búsqueda y los guiones los tomarán en cuenta.
          </p>
        )}
      </div>
    </div>
  );
}
