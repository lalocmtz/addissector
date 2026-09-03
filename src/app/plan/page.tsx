'use client';

// =============================================================================
// AdDNA — PLANIFICACIÓN.
// El módulo que faltaba: la cadena Persona → Ángulo → Concepto → Anuncio,
// con estado de producción y cruzada contra los datos reales de Meta.
//
// Aquí planeas ANTES de producir, y aquí se valida o se invalida tu teoría
// cuando subes el export. Un concepto = una hipótesis = un grupo de anuncios.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, Plus, X, Copy, Check, ChevronRight, Trophy, AlertTriangle,
  Target, Users, Layers, LayoutGrid, Sparkles,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import {
  CONCEPT_STATUS, ANGLE_STATUS, NARRATIVE_FORMATS, OWNERS,
  type RollupMetrics, type GroupVerdict,
} from '@/lib/plan';
import type { Economics } from '@/lib/meta';

// ---------------------------------------------------------------------------
// Tipos del tablero
// ---------------------------------------------------------------------------
interface Persona { id: string; name: string; description: string | null; status: string }
interface AngleRow {
  id: string; code: string; name: string; persona_id: string | null; status: string;
  funnel_stage: string | null; priority: string | null; learnings: string | null;
  concepts: number; conceptsTested: number; metrics: RollupMetrics; verdict: GroupVerdict;
  bestConcept: { code: string; name: string; roas: number | null } | null;
}
interface PlannedAd {
  id: string; ad_name: string; variant: string | null; format: string | null;
  hook: string | null; status: string; owner: string | null;
  spend: number; roas: number | null; hook_rate: number | null; purchases: number; hasData: boolean;
}
interface ConceptRow {
  id: string; angle_id: string | null; persona_id: string | null; number: number; code: string;
  name: string; narrative_format: string | null; hypothesis: string | null; status: string;
  owner: string | null; target_assets: number | null; planned_for: string | null;
  origin: string; origin_ad_name: string | null; brief: string | null; do_not_change: string | null;
  metrics: RollupMetrics; verdict: GroupVerdict; ads: PlannedAd[];
}
interface Board {
  economics: Economics; brandName: string | null; days: number;
  personas: Persona[]; angles: AngleRow[]; concepts: ConceptRow[];
  rankings: {
    angles: AngleRow[]; concepts: ConceptRow[];
    formats: { format: string; concepts: number; metrics: RollupMetrics }[];
  };
  unplanned: {
    count: number; metrics: RollupMetrics;
    top: { ad_name: string; spend: number; roas: number | null; hook_rate: number | null; purchases: number }[];
  };
}

// ---------------------------------------------------------------------------
// Helpers de presentación
// ---------------------------------------------------------------------------
const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)}`;
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`);
const roasFmt = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));

function verdictCls(id: string): string {
  switch (id) {
    case 'ganador': return 'border-ok/40 text-ok bg-ok/5';
    case 'fatiga': return 'border-warn/40 text-warn bg-warn/5';
    case 'prometedor': return 'border-accent/40 text-accent bg-accent/5';
    case 'recortar': return 'border-danger/40 text-danger bg-danger/5';
    case 'sin_gasto': return 'border-line-strong text-ink-4';
    default: return 'border-line-strong text-ink-3';
  }
}

function roasCls(roas: number | null, eco: Economics): string {
  if (roas == null) return 'text-ink-4';
  if (roas >= eco.target) return 'text-ok';
  if (roas >= eco.breakeven) return 'text-warn';
  return 'text-danger';
}

function CopyChip({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className="inline-flex items-center gap-1.5 text-[10px] font-[family-name:var(--font-mono)] px-2 py-1 rounded border border-line text-ink-3 hover:text-ink hover:border-accent/50 transition-colors"
      title="Copiar para pegar en Meta"
    >
      {done ? <Check className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3" />}
      {text}
    </button>
  );
}

function Metric({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-ink-4">{label}</p>
      <p className={`text-sm font-[family-name:var(--font-mono)] ${cls ?? 'text-ink'}`}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
export default function PlanPage() {
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<'tablero' | 'conceptos' | 'angulos' | 'personas'>('tablero');
  const [newOpen, setNewOpen] = useState(false);
  const [openConcept, setOpenConcept] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeBrandId) return;
    setLoading(true);
    try {
      const d = await fetch(`/api/plan/board?brand=${activeBrandId}&days=${days}`).then((r) => r.json());
      if (!d.error) setBoard(d);
    } finally {
      setLoading(false);
    }
  }, [activeBrandId, days]);

  // El await inicial saca el setState de la fase síncrona del efecto.
  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (alive) await load();
    })();
    return () => { alive = false; };
  }, [load]);

  const eco = board?.economics;
  const totalSpend = useMemo(() => {
    if (!board) return 0;
    return board.concepts.reduce((s, c) => s + c.metrics.spend, 0) + board.unplanned.metrics.spend;
  }, [board]);
  const unplannedShare = totalSpend > 0 ? (board?.unplanned.metrics.spend ?? 0) / totalSpend : 0;

  const counts = useMemo(() => {
    const c = board?.concepts ?? [];
    return {
      total: c.length,
      produccion: c.filter((x) => x.status === 'produccion' || x.status === 'brief').length,
      subido: c.filter((x) => x.status === 'subido').length,
      ganadores: c.filter((x) => x.verdict.id === 'ganador').length,
    };
  }, [board]);

  return (
    <main className="flex-1 min-h-screen">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-4 sm:px-6 py-6">
        <div className="max-w-[1600px] mx-auto">
          {/* Encabezado */}
          <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
            <div>
              <h1 className="text-xl font-bold font-[family-name:var(--font-mono)] tracking-tight">
                Planificación · {activeBrand?.name ?? ''}
              </h1>
              <p className="text-xs text-ink-4 mt-0.5">
                Persona → Ángulo → Concepto → Anuncio. Planeas aquí, se valida con tu export de Meta.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-line overflow-hidden">
                {[7, 14, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`text-xs px-2.5 py-1.5 transition-colors ${
                      days === d ? 'bg-surface-2 text-ink' : 'text-ink-4 hover:text-ink-3'
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
              <button
                onClick={() => setNewOpen(true)}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg gradient-blue text-on-accent font-medium"
              >
                <Plus className="w-4 h-4" /> Nuevo concepto
              </button>
            </div>
          </div>

          {/* Tira de estado */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { l: 'Conceptos', v: String(counts.total), i: <Layers className="w-3.5 h-3.5" /> },
              { l: 'En producción', v: String(counts.produccion), i: <Loader2 className="w-3.5 h-3.5" /> },
              { l: 'Subidos', v: String(counts.subido), i: <ChevronRight className="w-3.5 h-3.5" /> },
              { l: 'Validados', v: String(counts.ganadores), i: <Trophy className="w-3.5 h-3.5" /> },
            ].map((k) => (
              <div key={k.l} className="rounded-xl border border-line bg-surface px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-4 flex items-center gap-1.5">{k.i}{k.l}</p>
                <p className="text-2xl font-[family-name:var(--font-mono)] text-ink mt-0.5">{k.v}</p>
              </div>
            ))}
          </div>

          {/* Aviso de anuncios sin planear */}
          {board && unplannedShare > 0.3 && (
            <div className="rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 mb-5 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-warn mt-0.5 shrink-0" />
              <div className="text-xs text-warn">
                <span className="font-semibold">
                  El {Math.round(unplannedShare * 100)}% de tu gasto está en anuncios que no existen en la planificación
                </span>{' '}
                ({board.unplanned.count} anuncios, {money(board.unplanned.metrics.spend)}). Los rankings de abajo solo
                miden lo planeado — hasta que los conectes, no son la foto completa.
              </div>
            </div>
          )}

          {/* Pestañas */}
          <div className="flex gap-1 mb-4 border-b border-line">
            {([
              ['tablero', 'Tablero', <LayoutGrid key="a" className="w-3.5 h-3.5" />],
              ['conceptos', 'Conceptos', <Layers key="b" className="w-3.5 h-3.5" />],
              ['angulos', 'Ángulos', <Target key="c" className="w-3.5 h-3.5" />],
              ['personas', 'Personas', <Users key="d" className="w-3.5 h-3.5" />],
            ] as const).map(([id, label, icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 text-sm px-3 py-2 border-b-2 -mb-px transition-colors ${
                  tab === id
                    ? 'border-accent text-ink'
                    : 'border-transparent text-ink-4 hover:text-ink-3'
                }`}
              >
                {icon}{label}
              </button>
            ))}
          </div>

          {loading && !board && (
            <div className="flex items-center gap-2 text-sm text-ink-4 py-16 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando el tablero…
            </div>
          )}

          {board && eco && (
            <>
              {tab === 'tablero' && (
                <BoardView board={board} eco={eco} onOpen={setOpenConcept} onChanged={load} />
              )}
              {tab === 'conceptos' && (
                <ConceptsTable board={board} eco={eco} onOpen={setOpenConcept} />
              )}
              {tab === 'angulos' && <AnglesTable board={board} eco={eco} onChanged={load} />}
              {tab === 'personas' && (
                <PersonasView board={board} brandId={activeBrandId!} onChanged={load} />
              )}
            </>
          )}
        </div>
      </section>

      {newOpen && activeBrandId && (
        <NewConceptModal
          brandId={activeBrandId}
          angles={board?.angles ?? []}
          personas={board?.personas ?? []}
          onClose={() => setNewOpen(false)}
          onCreated={() => { setNewOpen(false); load(); }}
        />
      )}

      {openConcept && board && eco && (
        <ConceptDrawer
          key={openConcept}
          concept={board.concepts.find((c) => c.id === openConcept)!}
          angles={board.angles}
          eco={eco}
          onClose={() => setOpenConcept(null)}
          onChanged={load}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// TABLERO — kanban por estado + rankings de lo que está validado
// ---------------------------------------------------------------------------
function BoardView({
  board, eco, onOpen, onChanged,
}: { board: Board; eco: Economics; onOpen: (id: string) => void; onChanged: () => void }) {
  const move = async (id: string, status: string) => {
    await fetch('/api/plan/concepts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    onChanged();
  };

  return (
    <div className="grid xl:grid-cols-[1fr_320px] gap-5 items-start">
      {/* Kanban */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max">
          {CONCEPT_STATUS.map((s) => {
            const items = board.concepts.filter((c) => c.status === s.id);
            return (
              <div key={s.id} className="w-[260px] shrink-0">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${s.cls}`}>
                    {s.label}
                  </span>
                  <span className="text-[10px] text-ink-4 font-[family-name:var(--font-mono)]">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((c) => {
                    const angle = board.angles.find((a) => a.id === c.angle_id);
                    return (
                      <div
                        key={c.id}
                        className="rounded-lg border border-line bg-surface p-3 hover:border-accent/40 transition-colors cursor-pointer"
                        onClick={() => onOpen(c.id)}
                      >
                        <p className="text-[10px] font-[family-name:var(--font-mono)] text-ink-4">{c.code}</p>
                        <p className="text-xs text-ink font-medium mt-0.5 leading-snug">{c.name}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {angle && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-2 text-ink-3 font-[family-name:var(--font-mono)]">
                              {angle.code}
                            </span>
                          )}
                          {c.narrative_format && (
                            <span className="text-[9px] text-ink-4">{c.narrative_format}</span>
                          )}
                        </div>
                        {c.metrics.spend > 0 && (
                          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-surface-2">
                            <span className="text-[10px] font-[family-name:var(--font-mono)] text-ink-3">
                              {money(c.metrics.spend)}
                            </span>
                            <span className={`text-[10px] font-[family-name:var(--font-mono)] ${roasCls(c.metrics.roas, eco)}`}>
                              {roasFmt(c.metrics.roas)}x
                            </span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border ml-auto ${verdictCls(c.verdict.id)}`}>
                              {c.verdict.label}
                            </span>
                          </div>
                        )}
                        <div className="flex gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                          {CONCEPT_STATUS.filter((x) => x.id !== c.status).slice(0, 6).map((x) => (
                            <button
                              key={x.id}
                              onClick={() => move(c.id, x.id)}
                              title={`Mover a ${x.label}`}
                              className="w-4 h-1 rounded-full bg-surface-2 hover:bg-accent transition-colors"
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {items.length === 0 && (
                    <div className="rounded-lg border border-dashed border-surface-2 py-6 text-center">
                      <p className="text-[10px] text-line-strong">Vacío</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rankings */}
      <div className="space-y-4">
        <RankPanel title="Ángulos validados" icon={<Target className="w-3.5 h-3.5" />}>
          {board.rankings.angles.length === 0 && <Empty>Todavía no hay ángulos con gasto suficiente para opinar.</Empty>}
          {board.rankings.angles.map((a) => (
            <div key={a.id} className="flex items-center gap-2 py-1.5 border-b border-surface-2 last:border-0">
              <span className="text-[10px] font-[family-name:var(--font-mono)] text-ink-3 w-20 truncate">{a.code}</span>
              <span className="text-[10px] text-ink-4 flex-1 truncate">{a.concepts} conc.</span>
              <span className="text-[10px] font-[family-name:var(--font-mono)] text-ink-4">{money(a.metrics.spend)}</span>
              <span className={`text-[11px] font-[family-name:var(--font-mono)] w-10 text-right ${roasCls(a.metrics.roas, eco)}`}>
                {roasFmt(a.metrics.roas)}
              </span>
            </div>
          ))}
        </RankPanel>

        <RankPanel title="Formatos narrativos" icon={<Layers className="w-3.5 h-3.5" />}>
          {board.rankings.formats.length === 0 && <Empty>Asigna un formato narrativo a tus conceptos para ver cuál gana.</Empty>}
          {board.rankings.formats.map((f) => (
            <div key={f.format} className="flex items-center gap-2 py-1.5 border-b border-surface-2 last:border-0">
              <span className="text-[10px] text-ink flex-1 truncate">{f.format}</span>
              <span className="text-[10px] text-ink-4">{f.concepts}</span>
              <span className="text-[10px] font-[family-name:var(--font-mono)] text-ink-4">{money(f.metrics.spend)}</span>
              <span className={`text-[11px] font-[family-name:var(--font-mono)] w-10 text-right ${roasCls(f.metrics.roas, eco)}`}>
                {roasFmt(f.metrics.roas)}
              </span>
            </div>
          ))}
        </RankPanel>

        {board.unplanned.count > 0 && (
          <RankPanel title={`Sin planear (${board.unplanned.count})`} icon={<AlertTriangle className="w-3.5 h-3.5" />}>
            <p className="text-[10px] text-ink-4 mb-2">
              Corren en Meta pero no salieron de un concepto. Créales uno para que entren al aprendizaje.
            </p>
            {board.unplanned.top.slice(0, 8).map((o) => (
              <div key={o.ad_name} className="flex items-center gap-2 py-1.5 border-b border-surface-2 last:border-0">
                <span className="text-[10px] text-ink-3 flex-1 truncate" title={o.ad_name}>{o.ad_name}</span>
                <span className="text-[10px] font-[family-name:var(--font-mono)] text-ink-4">{money(o.spend)}</span>
                <span className={`text-[11px] font-[family-name:var(--font-mono)] w-10 text-right ${roasCls(o.roas, eco)}`}>
                  {roasFmt(o.roas)}
                </span>
              </div>
            ))}
          </RankPanel>
        )}
      </div>
    </div>
  );
}

function RankPanel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-[10px] font-bold uppercase tracking-wide text-ink-3 mb-2 flex items-center gap-1.5">
        {icon}{title}
      </h3>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-ink-4 py-2">{children}</p>;
}

// ---------------------------------------------------------------------------
// CONCEPTOS — tabla con resultados reales
// ---------------------------------------------------------------------------
function ConceptsTable({ board, eco, onOpen }: { board: Board; eco: Economics; onOpen: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-ink-4 border-b border-line">
            <th className="text-left px-3 py-2.5 font-medium">Concepto</th>
            <th className="text-left px-3 py-2.5 font-medium">Ángulo</th>
            <th className="text-left px-3 py-2.5 font-medium">Formato</th>
            <th className="text-right px-3 py-2.5 font-medium">Anuncios</th>
            <th className="text-right px-3 py-2.5 font-medium">Gasto</th>
            <th className="text-right px-3 py-2.5 font-medium">ROAS</th>
            <th className="text-right px-3 py-2.5 font-medium">CPA</th>
            <th className="text-right px-3 py-2.5 font-medium">Hook</th>
            <th className="text-left px-3 py-2.5 font-medium">Veredicto</th>
            <th className="text-left px-3 py-2.5 font-medium">Qué hacer</th>
          </tr>
        </thead>
        <tbody>
          {[...board.concepts].sort((a, b) => b.metrics.spend - a.metrics.spend).map((c) => {
            const angle = board.angles.find((a) => a.id === c.angle_id);
            return (
              <tr
                key={c.id}
                onClick={() => onOpen(c.id)}
                className="border-b border-surface-2 last:border-0 hover:bg-surface cursor-pointer"
              >
                <td className="px-3 py-2.5">
                  <p className="font-[family-name:var(--font-mono)] text-[10px] text-ink-4">{c.code}</p>
                  <p className="text-ink">{c.name}</p>
                </td>
                <td className="px-3 py-2.5 font-[family-name:var(--font-mono)] text-[10px] text-ink-3">{angle?.code ?? '—'}</td>
                <td className="px-3 py-2.5 text-ink-3">{c.narrative_format ?? '—'}</td>
                <td className="px-3 py-2.5 text-right font-[family-name:var(--font-mono)] text-ink-3">
                  {c.metrics.adsWithData}/{c.metrics.ads}
                </td>
                <td className="px-3 py-2.5 text-right font-[family-name:var(--font-mono)] text-ink">{money(c.metrics.spend)}</td>
                <td className={`px-3 py-2.5 text-right font-[family-name:var(--font-mono)] ${roasCls(c.metrics.roas, eco)}`}>
                  {roasFmt(c.metrics.roas)}
                </td>
                <td className="px-3 py-2.5 text-right font-[family-name:var(--font-mono)] text-ink-3">{money(c.metrics.cpa)}</td>
                <td className="px-3 py-2.5 text-right font-[family-name:var(--font-mono)] text-ink-3">{pct(c.metrics.hookRate)}</td>
                <td className="px-3 py-2.5">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${verdictCls(c.verdict.id)}`}>{c.verdict.label}</span>
                </td>
                <td className="px-3 py-2.5 text-[10px] text-ink-4 max-w-[280px]">{c.verdict.action}</td>
              </tr>
            );
          })}
          {board.concepts.length === 0 && (
            <tr><td colSpan={10} className="px-3 py-10 text-center text-ink-4">
              Todavía no hay conceptos. Crea el primero — es la unidad que se briefea y se aprende.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ÁNGULOS — donde se decide qué razón de compra escalar y cuál archivar
// ---------------------------------------------------------------------------
function AnglesTable({ board, eco, onChanged }: { board: Board; eco: Economics; onChanged: () => void }) {
  const setStatus = async (id: string, status: string) => {
    await fetch('/api/plan/angles', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    onChanged();
  };

  return (
    <div className="space-y-2">
      {[...board.angles].sort((a, b) => b.metrics.spend - a.metrics.spend).map((a) => (
        <div key={a.id} className="rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-[220px]">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-[family-name:var(--font-mono)] px-1.5 py-0.5 rounded bg-surface-2 text-ink-3">
                  {a.code}
                </span>
                <p className="text-sm text-ink font-medium">{a.name}</p>
                <span className={`text-[9px] px-1.5 py-0.5 rounded border ${verdictCls(a.verdict.id)}`}>{a.verdict.label}</span>
              </div>
              <p className="text-[11px] text-ink-4 mt-1">{a.verdict.why}</p>
              <p className="text-[11px] text-accent mt-1.5 flex items-start gap-1.5">
                <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />{a.verdict.action}
              </p>
              {a.learnings && (
                <p className="text-[10px] text-ink-4 mt-1.5 italic">Aprendizaje: {a.learnings}</p>
              )}
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-5 gap-4">
              <Metric label="Conceptos" value={`${a.conceptsTested}/${a.concepts}`} />
              <Metric label="Gasto" value={money(a.metrics.spend)} />
              <Metric label="ROAS" value={roasFmt(a.metrics.roas)} cls={roasCls(a.metrics.roas, eco)} />
              <Metric label="CPA" value={money(a.metrics.cpa)} />
              <Metric label="Hook" value={pct(a.metrics.hookRate)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 mt-3 pt-3 border-t border-surface-2">
            {ANGLE_STATUS.map((s) => (
              <button
                key={s.id}
                onClick={() => setStatus(a.id, s.id)}
                className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
                  a.status === s.id ? s.cls : 'border-transparent text-ink-4 hover:text-ink-3'
                }`}
              >
                {s.label}
              </button>
            ))}
            {a.bestConcept && (
              <span className="ml-auto text-[10px] text-ink-4">
                Mejor concepto: <span className="font-[family-name:var(--font-mono)] text-ink-3">{a.bestConcept.code}</span>
                {' · '}{roasFmt(a.bestConcept.roas)}x
              </span>
            )}
          </div>
        </div>
      ))}
      {board.angles.length === 0 && (
        <div className="rounded-xl border border-dashed border-line p-10 text-center">
          <Target className="w-8 h-8 text-line-strong mx-auto mb-3" />
          <p className="text-sm text-ink-4">
            Sin ángulos todavía. Un ángulo es la razón por la que alguien compra: persona + dolor + mecanismo.
            De cada uno salen varios conceptos.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PERSONAS — el avatar. Si esto está vago, todo lo de abajo sale vago.
// ---------------------------------------------------------------------------
function PersonasView({ board, brandId, onChanged }: { board: Board; brandId: string; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    await fetch('/api/plan/personas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId, name: name.trim() }),
    });
    setName('');
    setSaving(false);
    onChanged();
  };

  const patch = async (id: string, field: string, value: string) => {
    await fetch('/api/plan/personas', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, [field]: value }),
    });
    onChanged();
  };

  const remove = async (id: string) => {
    await fetch(`/api/plan/personas?id=${id}`, { method: 'DELETE' });
    onChanged();
  };

  return (
    <div>
      <div className="flex gap-2 mb-4 max-w-xl">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Mujer de 34 que se depiló y le quedaron manchas…"
          className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent outline-none"
        />
        <button onClick={add} disabled={!name.trim() || saving} className="px-4 rounded-lg gradient-blue text-on-accent disabled:opacity-50">
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[11px] text-ink-4 mb-4 max-w-xl">
        Sé específico. &quot;Mujeres 25-45&quot; no es una persona: es un censo. Una persona es alguien
        con un problema concreto que puedes visualizar mientras escribes el guion.
      </p>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {board.personas.map((p) => {
          const usedBy = board.angles.filter((a) => a.persona_id === p.id).length;
          return (
            <div key={p.id} className="group rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start gap-2">
                <p className="flex-1 text-sm text-ink font-medium leading-snug">{p.name}</p>
                <button onClick={() => remove(p.id)} className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-danger">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <textarea
                defaultValue={p.description ?? ''}
                onBlur={(e) => patch(p.id, 'description', e.target.value)}
                rows={3}
                placeholder="Qué vive el día que ve el anuncio. Dolores en sus palabras, no en las tuyas."
                className="w-full mt-2 rounded-lg border border-surface-2 bg-canvas px-2.5 py-2 text-xs text-ink-2 focus:border-accent outline-none resize-none"
              />
              <p className="text-[10px] text-ink-4 mt-2">
                {usedBy} ángulo{usedBy === 1 ? '' : 's'} apuntan a esta persona
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NUEVO CONCEPTO — genera número, código y los nombres exactos para Meta
// ---------------------------------------------------------------------------
function NewConceptModal({
  brandId, angles, personas, onClose, onCreated,
}: {
  brandId: string; angles: AngleRow[]; personas: Persona[];
  onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [angleId, setAngleId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [format, setFormat] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [owner, setOwner] = useState('');
  const [assets, setAssets] = useState(3);
  const [newAngleCode, setNewAngleCode] = useState('');
  const [newAngleName, setNewAngleName] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ code: string; ads: { ad_name: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      let finalAngleId = angleId;
      // Ángulo nuevo al vuelo: sin ángulo, el concepto queda huérfano y no
      // aprende nada a nivel de razón de compra.
      if (!finalAngleId && newAngleCode.trim() && newAngleName.trim()) {
        const r = await fetch('/api/plan/angles', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            brandId, code: newAngleCode.trim().toUpperCase(), name: newAngleName.trim(),
            persona_id: personaId || null,
          }),
        }).then((x) => x.json());
        if (r.error) throw new Error(r.error);
        finalAngleId = r.item.id;
      }
      const res = await fetch('/api/plan/concepts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId, name, angleId: finalAngleId || null, personaId: personaId || null,
          narrativeFormat: format || null, hypothesis, owner: owner || null, targetAssets: assets,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setCreated({ code: data.item.code, ads: data.ads ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-overlay/70  flex items-start justify-center overflow-y-auto p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-ink">
            {created ? 'Concepto creado' : 'Nuevo concepto'}
          </h2>
          <button onClick={created ? onCreated : onClose} className="text-ink-4 hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>

        {created ? (
          <div>
            <p className="text-xs text-ink-3 mb-1">
              Código: <span className="font-[family-name:var(--font-mono)] text-ink">{created.code}</span>
            </p>
            <p className="text-[11px] text-ink-4 mb-3">
              Estos son los nombres exactos para pegar en Meta. Si los usas tal cual, el próximo export
              se conecta solo con este concepto y no tienes que mapear nada a mano.
            </p>
            <div className="space-y-1.5 mb-4">
              {created.ads.map((a) => <div key={a.ad_name}><CopyChip text={a.ad_name} /></div>)}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(created.ads.map((a) => a.ad_name).join('\n'))}
              className="w-full py-2 rounded-lg border border-line text-xs text-ink-3 hover:text-ink mb-2"
            >
              Copiar todos
            </button>
            <button onClick={onCreated} className="w-full py-2 rounded-lg gradient-blue text-on-accent text-sm font-medium">
              Listo
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Nombre del concepto">
              <input
                value={name} onChange={(e) => setName(e.target.value)} autoFocus
                placeholder="Duelo de productos"
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent outline-none"
              />
            </Field>

            <Field label="Ángulo (la razón de compra)">
              <select
                value={angleId} onChange={(e) => setAngleId(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent outline-none"
              >
                <option value="">— Crear uno nuevo —</option>
                {angles.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
              {!angleId && (
                <div className="grid grid-cols-[100px_1fr] gap-2 mt-2">
                  <input
                    value={newAngleCode} onChange={(e) => setNewAngleCode(e.target.value.toUpperCase())}
                    placeholder="CÓDIGO"
                    className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-xs font-[family-name:var(--font-mono)] text-ink focus:border-accent outline-none"
                  />
                  <input
                    value={newAngleName} onChange={(e) => setNewAngleName(e.target.value)}
                    placeholder="Ya probé de todo y nada funcionó"
                    className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-xs text-ink focus:border-accent outline-none"
                  />
                </div>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Persona">
                <select
                  value={personaId} onChange={(e) => setPersonaId(e.target.value)}
                  className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent outline-none"
                >
                  <option value="">—</option>
                  {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Formato narrativo">
                <select
                  value={format} onChange={(e) => setFormat(e.target.value)}
                  className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent outline-none"
                >
                  <option value="">—</option>
                  {NARRATIVE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Hipótesis — qué esperas que pase y por qué">
              <textarea
                value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} rows={3}
                placeholder="Creo que [persona] va a responder a [mensaje] porque [razón]. Espero hook rate > 25% y ROAS > 2."
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink-2 focus:border-accent outline-none resize-none"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Quién lo produce">
                <select
                  value={owner} onChange={(e) => setOwner(e.target.value)}
                  className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent outline-none"
                >
                  <option value="">—</option>
                  {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Variantes a producir">
                <input
                  type="number" min={1} max={12} value={assets}
                  onChange={(e) => setAssets(Math.max(1, Math.min(12, Number(e.target.value))))}
                  className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent outline-none"
                />
              </Field>
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}

            <button
              onClick={save} disabled={!name.trim() || saving}
              className="w-full py-2.5 rounded-lg gradient-blue text-on-accent text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Crear y generar nombres
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-ink-4 mb-1">{label}</label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FICHA DEL CONCEPTO — el brief para el equipo y el resultado real, juntos
// ---------------------------------------------------------------------------
function ConceptDrawer({
  concept, angles, eco, onClose, onChanged,
}: {
  concept: ConceptRow; angles: AngleRow[]; eco: Economics;
  onClose: () => void; onChanged: () => void;
}) {
  const [brief, setBrief] = useState(concept.brief ?? '');
  const [savingBrief, setSavingBrief] = useState(false);
  const angle = angles.find((a) => a.id === concept.angle_id);

  const patchConcept = async (patch: Record<string, unknown>) => {
    await fetch('/api/plan/concepts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: concept.id, ...patch }),
    });
    onChanged();
  };

  const patchAd = async (id: string, patch: Record<string, unknown>) => {
    await fetch('/api/plan/ads', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });
    onChanged();
  };

  const saveBrief = async () => {
    setSavingBrief(true);
    await patchConcept({ brief });
    setSavingBrief(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-overlay/60 " onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full overflow-y-auto bg-canvas border-l border-line p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-[11px] font-[family-name:var(--font-mono)] text-ink-4">{concept.code}</p>
            <h2 className="text-lg font-bold text-ink leading-tight">{concept.name}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {angle && (
                <span className="text-[10px] font-[family-name:var(--font-mono)] px-2 py-0.5 rounded bg-surface-2 text-ink-3">
                  {angle.code}
                </span>
              )}
              {concept.narrative_format && <span className="text-[10px] text-ink-4">{concept.narrative_format}</span>}
              {concept.owner && <span className="text-[10px] text-ink-4">· {concept.owner}</span>}
              <span className={`text-[9px] px-1.5 py-0.5 rounded border ${verdictCls(concept.verdict.id)}`}>
                {concept.verdict.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-ink-4 hover:text-ink"><X className="w-5 h-5" /></button>
        </div>

        {/* Veredicto y acción */}
        <div className={`rounded-xl border p-3 mb-4 ${verdictCls(concept.verdict.id)}`}>
          <p className="text-xs">{concept.verdict.why}</p>
          <p className="text-xs mt-1.5 flex items-start gap-1.5 opacity-90">
            <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />{concept.verdict.action}
          </p>
        </div>

        {/* Resultados */}
        {concept.metrics.spend > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 rounded-xl border border-line bg-surface p-4 mb-4">
            <Metric label="Gasto" value={money(concept.metrics.spend)} />
            <Metric label="ROAS" value={roasFmt(concept.metrics.roas)} cls={roasCls(concept.metrics.roas, eco)} />
            <Metric label="CPA" value={money(concept.metrics.cpa)} />
            <Metric label="Compras" value={String(concept.metrics.purchases)} />
            <Metric label="Hook" value={pct(concept.metrics.hookRate)} />
            <Metric label="Ret 75%" value={pct(concept.metrics.ret75)} />
          </div>
        )}

        {/* Estado de producción */}
        <div className="mb-4">
          <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1.5">Estado</p>
          <div className="flex flex-wrap gap-1">
            {CONCEPT_STATUS.map((s) => (
              <button
                key={s.id}
                onClick={() => patchConcept({ status: s.id })}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  concept.status === s.id ? s.cls : 'border-line text-ink-4 hover:text-ink-3'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hipótesis */}
        {concept.hypothesis && (
          <div className="rounded-xl border border-line bg-surface p-4 mb-4">
            <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1.5">Hipótesis</p>
            <p className="text-xs text-ink-2 leading-relaxed">{concept.hypothesis}</p>
            {concept.origin === 'ganador' && concept.origin_ad_name && (
              <p className="text-[10px] text-ink-4 mt-2">Nació de: {concept.origin_ad_name}</p>
            )}
          </div>
        )}

        {/* Anuncios del concepto */}
        <div className="rounded-xl border border-line bg-surface p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wide text-ink-4">
              Anuncios ({concept.metrics.adsWithData} de {concept.ads.length} con datos)
            </p>
            <button
              onClick={() => navigator.clipboard.writeText(concept.ads.map((a) => a.ad_name).join('\n'))}
              className="text-[10px] text-ink-4 hover:text-ink flex items-center gap-1"
            >
              <Copy className="w-3 h-3" /> Copiar nombres
            </button>
          </div>
          <div className="space-y-2">
            {concept.ads.map((a) => (
              <div key={a.id} className="rounded-lg border border-surface-2 bg-canvas p-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <CopyChip text={a.ad_name} />
                  {a.hasData ? (
                    <>
                      <span className="text-[10px] font-[family-name:var(--font-mono)] text-ink-3">{money(a.spend)}</span>
                      <span className={`text-[10px] font-[family-name:var(--font-mono)] ${roasCls(a.roas, eco)}`}>
                        {roasFmt(a.roas)}x
                      </span>
                      <span className="text-[10px] font-[family-name:var(--font-mono)] text-ink-4">
                        hook {pct(a.hook_rate)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] text-ink-4">sin datos en Meta todavía</span>
                  )}
                  <select
                    value={a.status}
                    onChange={(e) => patchAd(a.id, { status: e.target.value })}
                    className="ml-auto text-[10px] rounded border border-line bg-canvas px-1.5 py-0.5 text-ink-3 outline-none"
                  >
                    {['planeado', 'produccion', 'listo', 'subido'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <input
                  defaultValue={a.hook ?? ''}
                  onBlur={(e) => patchAd(a.id, { hook: e.target.value })}
                  placeholder="El hook literal — los primeros 2 segundos"
                  className="w-full mt-2 rounded border border-surface-2 bg-surface px-2 py-1.5 text-[11px] text-ink-2 focus:border-accent outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Brief */}
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1.5">
            Brief para el equipo
          </p>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={10}
            placeholder={'## La apuesta\nPersona · Dolor · Objeción a cerrar\n\n## Copy literal por slot\nHeadline: ""\nCTA: ""\n\n## Dirección de arte\nQué se ve · Qué NO debe aparecer\n\n## Lo que NO se toca\n'}
            className="w-full rounded-lg border border-surface-2 bg-canvas px-3 py-2 text-xs text-ink-2 focus:border-accent outline-none resize-y font-[family-name:var(--font-mono)]"
          />
          <button
            onClick={saveBrief}
            disabled={savingBrief}
            className="mt-2 px-3 py-1.5 rounded-lg border border-line text-xs text-ink-3 hover:text-ink disabled:opacity-50"
          >
            {savingBrief ? 'Guardando…' : 'Guardar brief'}
          </button>
        </div>
      </div>
    </div>
  );
}
