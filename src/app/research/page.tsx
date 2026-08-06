'use client';

// =============================================================================
// AdDNA — RESEARCH creativo.
// Busca reseñas, dudas y ángulos nuevos (con búsqueda web) cruzados contra lo
// que YA funciona en la cuenta, y mantiene el banco de ángulos con estado.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Search, Plus, X, Compass } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';

interface Note {
  id: string; kind: string; title: string; body: string | null;
  source: string | null; status: string; created_at: string;
}

const STATUS = [
  { id: 'idea', label: 'Idea', cls: 'border-[#334155] text-[#94a3b8]' },
  { id: 'en_prueba', label: 'En prueba', cls: 'border-[#eab308]/40 text-[#facc15]' },
  { id: 'funciona', label: 'Funciona', cls: 'border-[#22c55e]/40 text-[#4ade80]' },
  { id: 'descartado', label: 'Descartado', cls: 'border-[#ef4444]/40 text-[#f87171]' },
] as const;

const QUICK = [
  'Busca reseñas reales de productos como el mío: ¿qué palabras usan los clientes felices?',
  'Encuentra las dudas y objeciones más comunes antes de comprar este tipo de producto',
  '¿Qué ángulos están usando los competidores en sus anuncios ahora?',
  'Dame 5 ángulos nuevos que NO estoy usando, basados en lo que ya funciona',
];

export default function ResearchPage() {
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newAngle, setNewAngle] = useState('');

  const loadNotes = useCallback(async () => {
    if (!activeBrandId) return;
    const d = await fetch(`/api/research/notes?brand=${activeBrandId}`).then((r) => r.json()).catch(() => ({}));
    setNotes(d.notes ?? []);
  }, [activeBrandId]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const run = async (q?: string) => {
    const text = (q ?? query).trim();
    if (!text || !activeBrandId || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: activeBrandId, query: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error en research');
    } finally {
      setRunning(false);
    }
  };

  const addNote = async (title: string, body?: string) => {
    if (!activeBrandId || !title.trim()) return;
    await fetch('/api/research/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId: activeBrandId, title: title.trim(), body: body ?? null, kind: 'angulo' }),
    });
    loadNotes();
  };

  const setStatus = async (id: string, status: string) => {
    await fetch('/api/research/notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    loadNotes();
  };

  const removeNote = async (id: string) => {
    await fetch(`/api/research/notes?id=${id}`, { method: 'DELETE' });
    loadNotes();
  };

  return (
    <main className="flex-1 min-h-screen">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-4 sm:px-6 py-6">
        <div className="max-w-[1400px] mx-auto grid lg:grid-cols-[1fr_380px] gap-5 items-start">
          {/* Research */}
          <div>
            <h1 className="text-xl font-bold font-[family-name:var(--font-mono)] tracking-tight mb-1">
              Research · {activeBrand?.name ?? ''}
            </h1>
            <p className="text-xs text-[#64748b] mb-4">
              Reseñas, dudas y ángulos nuevos — siempre cruzados contra lo que ya funciona en tu cuenta.
            </p>

            <div className="flex gap-2 mb-3">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
                rows={2}
                placeholder="¿Qué quieres investigar? (reseñas, dudas, competidores, ángulos…)"
                className="flex-1 rounded-lg border border-[#1e1e2e] bg-[#0d0d14] px-3 py-2 text-sm text-[#f1f5f9] focus:border-[#3b82f6] outline-none resize-none"
              />
              <button
                onClick={() => run()}
                disabled={running || !query.trim()}
                className="px-4 rounded-lg gradient-blue text-white disabled:opacity-50"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-5">
              {QUICK.map((q) => (
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
                <Loader2 className="w-4 h-4 animate-spin" /> Investigando (búsqueda web + tu contexto)…
              </div>
            )}
            {error && <p className="text-sm text-[#f87171]">{error}</p>}
            {result && (
              <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-5">
                <div className="text-sm text-[#cbd5e1] whitespace-pre-wrap leading-relaxed">{result}</div>
                <div className="mt-4 pt-3 border-t border-[#1e1e2e] flex items-center gap-2">
                  <p className="text-xs text-[#64748b]">¿Salió un ángulo bueno? Guárdalo en el banco →</p>
                </div>
              </div>
            )}
            {!result && !running && (
              <div className="rounded-xl border border-dashed border-[#1e1e2e] bg-[#0d0d14] p-10 text-center">
                <Compass className="w-8 h-8 text-[#334155] mx-auto mb-3" />
                <p className="text-sm text-[#64748b]">
                  El research usa búsqueda web y conoce tus ganadores: los ángulos que proponga
                  vienen justificados con tus números.
                </p>
              </div>
            )}
          </div>

          {/* Banco de ángulos */}
          <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-[#94a3b8] mb-3">
              Banco de ángulos ({notes.length})
            </h2>
            <div className="flex gap-2 mb-3">
              <input
                value={newAngle}
                onChange={(e) => setNewAngle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newAngle.trim()) { addNote(newAngle); setNewAngle(''); } }}
                placeholder="Nuevo ángulo…"
                className="flex-1 rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-2.5 py-1.5 text-xs text-[#f1f5f9] focus:border-[#3b82f6] outline-none"
              />
              <button
                onClick={() => { if (newAngle.trim()) { addNote(newAngle); setNewAngle(''); } }}
                className="px-3 rounded-lg border border-[#1e1e2e] text-[#94a3b8] hover:text-[#f1f5f9]"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-2 max-h-[65vh] overflow-y-auto">
              {notes.map((n) => (
                <div key={n.id} className="group rounded-lg border border-[#15151f] bg-[#0a0a0f] px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <p className="flex-1 text-xs text-[#e2e8f0] font-medium">{n.title}</p>
                    <button onClick={() => removeNote(n.id)} className="opacity-0 group-hover:opacity-100 text-[#64748b] hover:text-[#f43f5e]">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {n.body && <p className="text-[10px] text-[#64748b] mt-1 line-clamp-3">{n.body}</p>}
                  <div className="flex gap-1 mt-2">
                    {STATUS.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setStatus(n.id, s.id)}
                        className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                          n.status === s.id ? s.cls : 'border-transparent text-[#475569] hover:text-[#94a3b8]'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {notes.length === 0 && (
                <p className="text-xs text-[#64748b]">
                  Guarda aquí los ángulos que valga la pena probar. El Cerebro los conoce y los
                  cruza con tus resultados.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
