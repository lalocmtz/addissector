'use client';

// =============================================================================
// Workshop — the one screen. Three columns, three questions:
//
//   CORE   what is carrying revenue, and what to do about each ad
//   LIVE   the single batch in test, scored at equal impressions
//   BENCH  what is briefed and waiting
//
// It replaces Strategy and Experiments. Those asked the strategist to fill
// seven objects before anything could be made; this asks for an angle, one
// variable and a literal hook, and mints the ad name itself.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Loader2, X, Copy, Check, Trash2, TrendingUp, RefreshCw, Anchor, Archive, AlertTriangle } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { useT, useFormatters } from '@/lib/i18n';
import {
  BATCH_VARIABLES, AWARENESS_STAGES, PIECE_FORMATS, VERDICT_ACTION,
  type Verdict,
} from '@/lib/batch';
import type { Workshop, BatchView, PieceView, CoreAd } from '@/lib/batch-server';

interface Member { id: string; name: string; role: string; is_ai: boolean }
interface Angle { id: string; code: string | null; name: string; awareness_stage: string | null; personas: { name: string } | null }
interface Data extends Workshop { members: Member[]; angles: Angle[] }

type Fmt = ReturnType<typeof useFormatters>;

const PRODUCTION_ROLES = new Set(['image_editor', 'video_editor', 'ugc_creator', 'designer', 'editor']);

const VERDICT_STYLE: Record<Verdict, string> = {
  breakthrough: 'bg-ok-soft text-ok border-ok/40 font-semibold',
  kpi_winner: 'bg-accent-soft text-accent border-accent/40 font-medium',
  spend_winner: 'bg-warn-soft text-warn border-warn/40',
  loser: 'bg-surface-2 text-ink-4 border-line',
};

const input = 'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent';
const label = 'block text-[11px] uppercase tracking-wide text-ink-3 mb-1';
const card = 'rounded-xl border border-line bg-surface';

// ---------------------------------------------------------------------------
export default function WorkshopPage() {
  const { me, activeBrand, setActiveBrandId } = useMe();
  const t = useT();
  const fmt = useFormatters();

  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(30);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const brandId = activeBrand?.id ?? null;

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/workshop?brand=${brandId}&window=${windowDays}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      setData(json as Data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [brandId, windowDays]);

  useEffect(() => { void load(); }, [load]);

  const batch = useMemo(
    () => (openBatch && data ? [...data.live, ...data.bench, ...data.closed].find((b) => b.id === openBatch) ?? null : null),
    [openBatch, data],
  );

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div>
            <h1 className="text-xl font-semibold text-ink font-[family-name:var(--font-serif)]">{t('ws.title')}</h1>
            <p className="text-sm text-ink-3 mt-0.5">{t('ws.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink">
              {[7, 14, 30, 60, 90].map((n) => <option key={n} value={n}>{t('ws.window.days', { n })}</option>)}
            </select>
            <button onClick={() => void load()} className="p-2 rounded-md border border-line bg-surface text-ink-2 hover:text-ink">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {err && <div className="mb-4 px-3 py-2 rounded-lg border border-danger/40 bg-danger-soft text-danger text-sm">{err}</div>}

        {data && <PlanStrip data={data} t={t} fmt={fmt} />}

        {loading && !data ? (
          <div className="flex items-center justify-center py-24 text-ink-3"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : data ? (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
            <CoreColumn data={data} t={t} fmt={fmt} />
            <LiveColumn data={data} t={t} fmt={fmt} onOpen={setOpenBatch} onChanged={load} brandId={brandId!} />
            <BenchColumn data={data} t={t} onOpen={setOpenBatch} onNew={() => setCreating(true)} onChanged={load} />
          </div>
        ) : null}
      </main>

      {creating && data && (
        <NewBatchModal data={data} brandId={brandId!} t={t}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); setOpenBatch(id); void load(); }} />
      )}

      {batch && data && (
        <BatchDrawer batch={batch} data={data} t={t} fmt={fmt}
          onClose={() => setOpenBatch(null)} onChanged={load} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function PlanStrip({ data, t, fmt }: { data: Data; t: (k: string, v?: Record<string, string | number>) => string; fmt: Fmt }) {
  const v = data.volume;
  return (
    <div className={`${card} p-4`}>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Stat value={String(v.concepts_per_week)} label={t('ws.plan.concepts')} />
        <Stat value={String(v.pieces_per_week)} label={t('ws.plan.pieces')} />
        <Stat value={fmt.ratio(v.expected_winners_per_month, 1)} label={t('ws.plan.expected')} />
        <Stat value={String(data.winners_30d)} label={t('ws.plan.winners', { days: data.window_days })} accent />
        <p className="text-xs text-ink-4 max-w-md">{t('ws.plan.explain')}</p>
      </div>
      {data.unmapped_spend_pct >= 20 && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg border border-warn/40 bg-warn-soft text-warn text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <span>{t('ws.coverage.warn', { pct: data.unmapped_spend_pct.toFixed(0) })}</span>
        </div>
      )}
    </div>
  );
}

function Stat({ value, label: lbl, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div>
      <div className={`text-2xl font-semibold tabular-nums ${accent ? 'text-accent' : 'text-ink'}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-ink-3">{lbl}</div>
    </div>
  );
}

function VerdictChip({ v, t }: { v: Verdict | null; t: (k: string) => string }) {
  if (!v) return <span className="text-[11px] text-ink-4">{t('ws.piece.unreadable')}</span>;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] ${VERDICT_STYLE[v]}`} title={t(`ws.verdict.${v}.help`)}>
      {t(`ws.verdict.${v}`)}
    </span>
  );
}

// ---------------------------------------------------------------------------
function CoreColumn({ data, t, fmt }: { data: Data; t: (k: string) => string; fmt: Fmt }) {
  return (
    <section className={`${card} overflow-hidden`}>
      <header className="px-4 py-3 border-b border-line">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2"><Anchor className="w-4 h-4 text-ink-3" />{t('ws.core.title')}</h2>
        <p className="text-xs text-ink-3 mt-0.5">{t('ws.core.sub')}</p>
      </header>
      <div className="max-h-[70vh] overflow-y-auto divide-y divide-line">
        {data.core.length === 0 && <p className="p-4 text-sm text-ink-3">{t('ws.core.empty')}</p>}
        {data.core.map((a: CoreAd) => (
          <div key={a.ad_id} className="px-4 py-2.5 hover:bg-surface-2/50">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-ink truncate" title={a.ad_name}>{a.ad_name}</p>
                <p className="text-[11px] text-ink-4 mt-0.5">
                  {a.angle_code ?? <span className="text-warn">{t('ws.core.unmapped')}</span>}
                  {a.batch_number ? ` · T${String(a.batch_number).padStart(2, '0')}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm tabular-nums text-ink">{fmt.ratio(a.roas)}x</div>
                <div className="text-[11px] text-ink-4 tabular-nums">{fmt.money(a.spend, data.currency, { compact: true })}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <VerdictChip v={a.verdict} t={t} />
              {a.verdict && <span className="text-[11px] text-ink-3">→ {t(`ws.action.${VERDICT_ACTION[a.verdict]}`)}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function LiveColumn({ data, t, fmt, onOpen, onChanged, brandId }: {
  data: Data; t: (k: string, v?: Record<string, string | number>) => string; fmt: Fmt;
  onOpen: (id: string) => void; onChanged: () => void; brandId: string;
}) {
  const [closing, setClosing] = useState<string | null>(null);
  const [notReadable, setNotReadable] = useState<string | null>(null);

  const close = async (id: string, force: boolean) => {
    setClosing(id);
    try {
      const res = await fetch('/api/workshop/close', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, brandId, window: data.window_days, force }),
      });
      const json = await res.json();
      if (res.status === 409 && json.error === 'no_readable_pieces') { setNotReadable(id); return; }
      setNotReadable(null);
      onChanged();
    } finally { setClosing(null); }
  };

  return (
    <section className={`${card} overflow-hidden`}>
      <header className="px-4 py-3 border-b border-line">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2"><TrendingUp className="w-4 h-4 text-accent" />{t('ws.live.title')}</h2>
        <p className="text-xs text-ink-3 mt-0.5">{t('ws.live.sub')}</p>
      </header>
      <div className="max-h-[70vh] overflow-y-auto">
        {data.live.length === 0 && <p className="p-4 text-sm text-ink-3">{t('ws.live.empty')}</p>}
        {data.live.map((b) => (
          <div key={b.id} className="p-4 border-b border-line last:border-0">
            <button onClick={() => onOpen(b.id)} className="text-left w-full">
              <p className="text-sm font-medium text-ink">{b.code} · {b.name}</p>
              <p className="text-xs text-ink-3 mt-0.5">
                {b.angle_code ?? '—'} · {t(`ws.var.${b.variable}`)} · {t('ws.live.cap', { n: b.impression_cap })}
              </p>
            </button>

            <div className="mt-3 h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(b.progress * 100)}%` }} />
            </div>
            <p className="text-[11px] text-ink-4 mt-1">
              {t('ws.live.progress', { done: b.pieces.filter((p) => p.capped).length, total: b.pieces.length })}
            </p>

            <div className="mt-3 space-y-1.5">
              {b.pieces.map((p) => <PieceRow key={p.id} p={p} currency={data.currency} t={t} fmt={fmt} />)}
            </div>

            {notReadable === b.id ? (
              <div className="mt-3 px-3 py-2 rounded-lg border border-warn/40 bg-warn-soft text-warn text-xs">
                <p>{t('ws.live.notReadable')}</p>
                <button onClick={() => void close(b.id, true)} className="mt-1.5 underline">{t('ws.live.forceClose')}</button>
              </div>
            ) : (
              <button onClick={() => void close(b.id, false)} disabled={closing === b.id}
                className="mt-3 w-full py-1.5 rounded-md border border-line bg-surface-2 text-sm text-ink hover:border-accent/50 disabled:opacity-50">
                {closing === b.id ? t('ws.live.closing') : t('ws.live.close')}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function PieceRow({ p, currency, t, fmt }: { p: PieceView; currency: string | null; t: (k: string) => string; fmt: Fmt }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="truncate text-ink-2" title={p.hook ?? ''}>{p.variant}. {p.hook ?? p.ad_name}</span>
      <span className="flex items-center gap-2 shrink-0">
        <span className="tabular-nums text-ink-3">{fmt.money(p.spend, currency, { compact: true })}</span>
        <span className="tabular-nums text-ink">{fmt.ratio(p.roas)}x</span>
        <VerdictChip v={p.verdict_now} t={t} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
function BenchColumn({ data, t, onOpen, onNew, onChanged }: {
  data: Data; t: (k: string) => string; onOpen: (id: string) => void; onNew: () => void; onChanged: () => void;
}) {
  const launch = async (id: string) => {
    await fetch('/api/workshop', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'live' }),
    });
    onChanged();
  };

  return (
    <section className={`${card} overflow-hidden`}>
      <header className="px-4 py-3 border-b border-line flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">{t('ws.bench.title')}</h2>
          <p className="text-xs text-ink-3 mt-0.5">{t('ws.bench.sub')}</p>
        </div>
        <button onClick={onNew} className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-accent text-on-accent text-xs font-medium">
          <Plus className="w-3.5 h-3.5" />{t('ws.batch.new')}
        </button>
      </header>
      <div className="max-h-[70vh] overflow-y-auto divide-y divide-line">
        {data.bench.length === 0 && <p className="p-4 text-sm text-ink-3">{t('ws.bench.empty')}</p>}
        {data.bench.map((b) => (
          <div key={b.id} className="px-4 py-3">
            <button onClick={() => onOpen(b.id)} className="text-left w-full">
              <p className="text-sm text-ink">{b.code} · {b.name}</p>
              <p className="text-xs text-ink-3 mt-0.5">
                {b.angle_code ?? '—'} · {t(`ws.var.${b.variable}`)} · {b.pieces.length} {t('ws.batch.pieces').toLowerCase()}
              </p>
            </button>
            {b.pieces.length > 0 && data.live.length === 0 && (
              <button onClick={() => void launch(b.id)} className="mt-2 text-xs text-accent hover:underline">{t('ws.bench.launch')} →</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function NewBatchModal({ data, brandId, t, onClose, onCreated }: {
  data: Data; brandId: string; t: (k: string) => string; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [angleId, setAngleId] = useState('');
  const [name, setName] = useState('');
  const [variable, setVariable] = useState<string>('hook');
  const [awareness, setAwareness] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [cap, setCap] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const angle = data.angles.find((a) => a.id === angleId) ?? null;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/workshop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId, angle_id: angleId, name, variable,
          awareness: awareness || angle?.awareness_stage || null,
          hypothesis: hypothesis || null, owner_id: ownerId || null, impression_cap: cap,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      onCreated(json.batch.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg mt-16 rounded-xl border border-line bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-ink">{t('ws.batch.new')}</h3>
          <button onClick={onClose} className="text-ink-3 hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={label}>{t('ws.batch.angle')}</label>
            <select value={angleId} onChange={(e) => setAngleId(e.target.value)} className={input}>
              <option value="">—</option>
              {data.angles.map((a) => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ''}{a.name}</option>)}
            </select>
            {angle?.personas?.name && <p className="text-[11px] text-ink-4 mt-1">{t('ws.batch.persona')}: {angle.personas.name}</p>}
            {!angleId && <p className="text-[11px] text-ink-4 mt-1">{t('ws.batch.needAngle')}</p>}
          </div>

          <div>
            <label className={label}>{t('ws.batch.name')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder={t('ws.batch.name.placeholder')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>{t('ws.batch.variable')}</label>
              <select value={variable} onChange={(e) => setVariable(e.target.value)} className={input}>
                {BATCH_VARIABLES.map((v) => <option key={v} value={v}>{t(`ws.var.${v}`)}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>{t('ws.batch.awareness')}</label>
              <select value={awareness} onChange={(e) => setAwareness(e.target.value)} className={input}>
                <option value="">—</option>
                {AWARENESS_STAGES.map((a) => <option key={a} value={a}>{t(`ws.aware.${a}`)}</option>)}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-ink-4 -mt-1">{t('ws.batch.variable.help')}</p>

          <div>
            <label className={label}>{t('ws.batch.hypothesis')}</label>
            <textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} rows={2} className={input} placeholder={t('ws.batch.hypothesis.placeholder')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>{t('ws.batch.owner')}</label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={input}>
                <option value="">—</option>
                {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>{t('ws.batch.cap')}</label>
              <input type="number" value={cap} onChange={(e) => setCap(Number(e.target.value))} className={input} />
            </div>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <button onClick={() => void submit()} disabled={busy || !angleId || !name.trim()}
            className="w-full py-2 rounded-md bg-accent text-on-accent text-sm font-medium disabled:opacity-40">
            {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('ws.batch.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function BatchDrawer({ batch, data, t, fmt, onClose, onChanged }: {
  batch: BatchView; data: Data; t: (k: string, v?: Record<string, string | number>) => string; fmt: Fmt;
  onClose: () => void; onChanged: () => void;
}) {
  const [hook, setHook] = useState('');
  const [format, setFormat] = useState<string>('static');
  const [ownerId, setOwnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const editors = data.members.filter((m) => PRODUCTION_ROLES.has(m.role) || m.is_ai);

  const add = async () => {
    if (!hook.trim()) return;
    setBusy(true);
    try {
      await fetch('/api/workshop/piece', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: batch.id, hook, format, owner_id: ownerId || null }),
      });
      setHook('');
      onChanged();
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    await fetch(`/api/workshop/piece?id=${id}`, { method: 'DELETE' });
    onChanged();
  };

  const copy = async (name: string) => {
    await navigator.clipboard.writeText(name);
    setCopied(name);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-xl h-full overflow-y-auto bg-canvas border-l border-line" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 bg-canvas/95 border-b border-line px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-ink-3">{batch.angle_code ?? '—'} · {t(`ws.var.${batch.variable}`)}{batch.awareness ? ` · ${t(`ws.aware.${batch.awareness}`)}` : ''}</p>
            <h3 className="text-base font-semibold text-ink truncate">{batch.code} · {batch.name}</h3>
            {batch.persona_name && <p className="text-xs text-ink-4 mt-0.5">{t('ws.batch.persona')}: {batch.persona_name}</p>}
          </div>
          <button onClick={onClose} className="text-ink-3 hover:text-ink shrink-0"><X className="w-4 h-4" /></button>
        </header>

        <div className="p-5 space-y-5">
          {batch.hypothesis && (
            <p className="text-sm text-ink-2 border-l-2 border-accent/50 pl-3">{batch.hypothesis}</p>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs uppercase tracking-wide text-ink-3">{t('ws.batch.pieces')}</h4>
              <span className="text-xs text-ink-4">{t('ws.batch.spend')}: {fmt.money(batch.spend, data.currency)}</span>
            </div>

            {batch.pieces.length === 0 && <p className="text-sm text-ink-3">{t('ws.piece.empty')}</p>}

            <div className="space-y-2">
              {batch.pieces.map((p) => (
                <div key={p.id} className={`${card} p-3`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-ink flex-1">{p.variant}. {p.hook}</p>
                    {batch.status !== 'closed' && !p.meta_ad_id && (
                      <button onClick={() => void remove(p.id)} className="text-ink-4 hover:text-danger shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[11px] px-1.5 py-0.5 rounded border border-line bg-surface-2 text-ink-3">{t(`ws.format.${p.format ?? 'static'}`)}</span>
                    {p.owner_name && <span className="text-[11px] text-ink-3">{p.owner_name}</span>}
                    {p.meta_ad_id ? <VerdictChip v={p.verdict_now} t={t} /> : <span className="text-[11px] text-ink-4">{t('ws.piece.notMatched')}</span>}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 text-[11px] font-mono bg-surface-2 border border-line rounded px-2 py-1 text-ink-2 truncate">{p.ad_name}</code>
                    <button onClick={() => void copy(p.ad_name)} className="p-1.5 rounded border border-line text-ink-3 hover:text-ink shrink-0" title={t('ws.piece.copy')}>
                      {copied === p.ad_name ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {p.meta_ad_id && (
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-3 tabular-nums">
                      <span>{fmt.money(p.spend, data.currency, { compact: true })}</span>
                      <span>{fmt.ratio(p.roas)}x</span>
                      <span>{p.purchases ?? 0} ✓</span>
                      {p.archived_reason && (
                        <span className="flex items-center gap-1 text-ink-4"><Archive className="w-3 h-3" />{t(`ws.archive.${p.archived_reason}`)}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {batch.status !== 'closed' && (
            <div className={`${card} p-3 space-y-2`}>
              <div>
                <label className={label}>{t('ws.piece.hook')}</label>
                <input value={hook} onChange={(e) => setHook(e.target.value)} className={input} placeholder={t('ws.piece.hook.placeholder')} />
                <p className="text-[11px] text-ink-4 mt-1">{t('ws.piece.hook.help')}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>{t('ws.piece.format')}</label>
                  <select value={format} onChange={(e) => setFormat(e.target.value)} className={input}>
                    {PIECE_FORMATS.map((f) => <option key={f} value={f}>{t(`ws.format.${f}`)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>{t('ws.piece.owner')}</label>
                  <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={input}>
                    <option value="">—</option>
                    {editors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={() => void add()} disabled={busy || !hook.trim()}
                className="w-full py-1.5 rounded-md border border-line bg-surface-2 text-sm text-ink hover:border-accent/50 disabled:opacity-40">
                {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('ws.piece.add')}
              </button>
              <p className="text-[11px] text-ink-4">{t('ws.piece.name.help')}</p>
            </div>
          )}

          {batch.closed_note && <p className="text-sm text-ink-2">{batch.closed_note}</p>}
        </div>
      </div>
    </div>
  );
}
