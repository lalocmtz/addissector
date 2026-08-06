'use client';

// =============================================================================
// AdDNA — CEREBRO de la marca.
// Chat estratégico con TODO el contexto (cerebro editable + ganadores actuales
// con números + guiones extraídos + aprendizajes + research). El contexto
// crece solo: cada ganador analizado y cada aprendizaje alimentan al chat.
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2, Send, Trash2, Plus, X, Brain, Lightbulb, ChevronDown, ChevronRight, Save,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';

interface Msg { id?: string; role: 'user' | 'assistant'; content: string }
interface Section { id: string; title: string; content: string; sort: number }
interface Learning { id: string; text: string; evidence: string | null; source_ad: string | null; active: boolean }

const SUGGESTIONS = [
  'Dame 3 guiones nuevos basados en lo que está funcionando ahora',
  '¿Qué patrón comparten mis ganadores actuales?',
  '¿Qué anuncio debería iterar primero y cómo?',
  'Escríbeme 5 hooks nuevos con el ángulo de mi mejor anuncio',
];

export default function CerebroPage() {
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [showNew, setShowNew] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!activeBrandId) return;
    const [chat, brain, learn] = await Promise.all([
      fetch(`/api/chat?brand=${activeBrandId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/brain?brand=${activeBrandId}`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/learnings?brand=${activeBrandId}`).then((r) => r.json()).catch(() => ({})),
    ]);
    setMessages(chat.messages ?? []);
    setSections(brain.sections ?? []);
    setLearnings((learn.learnings ?? []).filter((l: Learning) => l.active));
  }, [activeBrandId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, thinking]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || !activeBrandId || thinking) return;
    setInput('');
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    setThinking(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: activeBrandId, message: msg }),
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
    if (!activeBrandId || !confirm('¿Limpiar el hilo del chat?')) return;
    await fetch(`/api/chat?brand=${activeBrandId}`, { method: 'DELETE' });
    setMessages([]);
  };

  const saveSection = async (s: Partial<Section> & { title: string }) => {
    if (!activeBrandId) return;
    await fetch('/api/brain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, brandId: activeBrandId, title: s.title, content: s.content ?? '', sort: s.sort ?? sections.length }),
    });
    load();
  };

  const deleteSection = async (id: string) => {
    if (!confirm('¿Eliminar esta sección del cerebro?')) return;
    await fetch(`/api/brain?id=${id}`, { method: 'DELETE' });
    load();
  };

  const addLearning = async (text: string) => {
    if (!activeBrandId || !text.trim()) return;
    await fetch('/api/learnings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId: activeBrandId, text }),
    });
    load();
  };

  const removeLearning = async (id: string) => {
    await fetch(`/api/learnings?id=${id}`, { method: 'DELETE' });
    load();
  };

  // Detecta "💡 Aprendizaje sugerido:" en la última respuesta
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const suggestedLearning = lastAssistant?.content.match(/💡\s*Aprendizaje sugerido:\s*(.+)/)?.[1]?.trim();

  return (
    <main className="flex-1 min-h-screen flex flex-col">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="flex-1 px-4 sm:px-6 py-5">
        <div className="max-w-[1400px] mx-auto grid lg:grid-cols-[1fr_380px] gap-5 items-start">
          {/* ------------------------------------------------ Chat */}
          <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] flex flex-col" style={{ height: 'calc(100vh - 140px)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e2e]">
              <h1 className="text-sm font-bold flex items-center gap-2">
                <Brain className="w-4 h-4 text-[#3b82f6]" />
                Cerebro · {activeBrand?.name ?? ''}
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

          {/* ------------------------------------------------ Contexto */}
          <div className="space-y-4">
            {/* Secciones del cerebro */}
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
                    placeholder="Título (ej. Ángulos, Compliance, Persona)"
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
                  Aún no hay contexto. Crea secciones (persona, ángulos, compliance, tono…) — el chat las usa en cada respuesta.
                </p>
              )}
              <div className="space-y-1.5">
                {sections.map((s) => (
                  <SectionRow key={s.id} section={s} open={openSection === s.id}
                    onToggle={() => setOpenSection(openSection === s.id ? null : s.id)}
                    onSave={(content) => saveSection({ ...s, content })}
                    onDelete={() => deleteSection(s.id)}
                  />
                ))}
              </div>
            </div>

            {/* Aprendizajes */}
            <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4">
              <h2 className="text-xs font-bold uppercase tracking-wide text-[#94a3b8] mb-3 flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 text-[#eab308]" /> Aprendizajes ({learnings.length})
              </h2>
              <LearningInput onAdd={addLearning} />
              <div className="space-y-1.5 mt-3 max-h-72 overflow-y-auto">
                {learnings.map((l) => (
                  <div key={l.id} className="group flex items-start gap-2 text-xs text-[#cbd5e1] rounded-lg border border-[#15151f] bg-[#0a0a0f] px-2.5 py-2">
                    <span className="flex-1">{l.text}{l.source_ad ? <span className="text-[#64748b]"> · {l.source_ad}</span> : null}</span>
                    <button onClick={() => removeLearning(l.id)} className="opacity-0 group-hover:opacity-100 text-[#64748b] hover:text-[#f43f5e]">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {learnings.length === 0 && (
                  <p className="text-xs text-[#64748b]">Cada patrón que confirmes queda aquí y la IA lo cita al pedir guiones.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function SectionRow({ section, open, onToggle, onSave, onDelete }: {
  section: Section; open: boolean; onToggle: () => void;
  onSave: (content: string) => void; onDelete: () => void;
}) {
  const [content, setContent] = useState(section.content);
  const dirty = content !== section.content;
  useEffect(() => setContent(section.content), [section.content]);
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

function LearningInput({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onAdd(text.trim()); setText(''); } }}
        placeholder="Nuevo aprendizaje…"
        className="flex-1 rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-2.5 py-1.5 text-xs text-[#f1f5f9] focus:border-[#3b82f6] outline-none"
      />
      <button
        onClick={() => { if (text.trim()) { onAdd(text.trim()); setText(''); } }}
        className="text-xs px-3 rounded-lg border border-[#1e1e2e] text-[#94a3b8] hover:text-[#f1f5f9]"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
