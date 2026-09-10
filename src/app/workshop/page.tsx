'use client';

// =============================================================================
// Producción — one list of tandas (batches).
//
// A tanda is one angle, ONE thing that changes between pieces, and 4–8 pieces.
// The platform mints a code per piece; the team uploads the piece to Meta with
// that exact code as the ad name and the numbers fill themselves in.
//
//   Crear tanda → Copiar códigos → Producir → Subir a Meta → En prueba → Veredicto
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Loader2, X, Copy, Check, Trash2, BookOpen, Download, FileText, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { useT, useFormatters } from '@/lib/i18n';
import { BATCH_VARIABLES, AWARENESS_STAGES, PIECE_FORMATS, VERDICT_ACTION, type Verdict } from '@/lib/batch';
import type { Workshop, BatchView, PieceView, BatchStage } from '@/lib/batch-server';

interface Member { id: string; name: string; role: string; is_ai: boolean }
interface Angle { id: string; code: string | null; name: string; awareness_stage: string | null; personas: { name: string } | null }
interface Data extends Workshop { members: Member[]; angles: Angle[] }

type T = (k: string, v?: Record<string, string | number>) => string;
type Fmt = ReturnType<typeof useFormatters>;

const WINDOW_DAYS = 30;
const STAGES: BatchStage[] = ['testing', 'waiting', 'producing', 'closed'];

const STAGE_STYLE: Record<BatchStage, string> = {
  testing: 'bg-ok-soft text-ok',
  waiting: 'bg-warn-soft text-warn',
  producing: 'bg-accent-soft text-accent',
  closed: 'bg-surface-2 text-ink-3',
};

const VERDICT_STYLE: Record<Verdict, string> = {
  breakthrough: 'bg-ok-soft text-ok font-semibold',
  kpi_winner: 'bg-accent-soft text-accent font-medium',
  spend_winner: 'bg-warn-soft text-warn',
  loser: 'bg-surface-2 text-ink-4',
};

const input = 'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent';
const label = 'block text-[11px] uppercase tracking-wide text-ink-3 mb-1';
const hint = 'text-[11px] text-ink-4 mt-1';
const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-line bg-surface text-xs text-ink-2 hover:text-ink disabled:opacity-50';
const btnPrimary = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-on-accent text-sm font-medium disabled:opacity-40';
const card = 'rounded-xl border border-line bg-surface';

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ }
}

function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (key: string, text: string) => {
    await copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }, []);
  return { copied, copy };
}

// Prefill desde /canvas (?new=1&name=&angle=&hook=&format=): abre la Nueva tanda ya llenada.
interface Prefill { name: string; angle: string; hook: string; format: string }
function readPrefill(): Prefill | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get('new') !== '1') return null;
  return { name: q.get('name') ?? '', angle: q.get('angle') ?? '', hook: q.get('hook') ?? '', format: q.get('format') ?? '' };
}

// ---------------------------------------------------------------------------
export default function WorkshopPage() {
  const { me, activeBrand, setActiveBrandId } = useMe();
  const t = useT();
  const fmt = useFormatters();

  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefill] = useState<Prefill | null>(readPrefill);
  const [creating, setCreating] = useState(() => prefill != null);

  // Limpia la query para que un refresh no vuelva a abrir el modal.
  useEffect(() => {
    if (prefill) window.history.replaceState(null, '', '/workshop');
  }, [prefill]);
  const [err, setErr] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);

  const brandId = activeBrand?.id ?? null;

  const load = useCallback(async () => {
    if (!brandId) return;
    try {
      const res = await fetch(`/api/workshop?brand=${brandId}&window=${WINDOW_DAYS}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      setData(json as Data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  // Kick the fetch off a microtask so no state is set synchronously inside the effect.
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const groups = useMemo(() => {
    const all = data ? [...data.live, ...data.bench, ...data.closed] : [];
    return STAGES.map((stage) => ({ stage, batches: all.filter((b) => b.stage === stage) }));
  }, [data]);
  const total = groups.reduce((n, g) => n + g.batches.length, 0);

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink font-[family-name:var(--font-serif)]">{t('ws.title')}</h1>
            <p className="text-sm text-ink-3 mt-0.5">{t('ws.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setGuide((g) => !g)}
              className={`${btn} ${guide ? 'border-accent bg-accent-soft text-accent' : ''}`}>
              <BookOpen className="w-4 h-4" />{t('ws.guide.button')}
            </button>
            {brandId && (
              <a href={`/api/export/brain?brand=${brandId}&window=60`} className={btn} title={t('ws.export.help')}>
                <Download className="w-4 h-4" />{t('ws.export.button')}
              </a>
            )}
            <button onClick={() => setCreating(true)} disabled={!data} className={btnPrimary}>
              <Plus className="w-4 h-4" />{t('ws.batch.new')}
            </button>
          </div>
        </div>

        {err && <div className="mb-4 px-3 py-2 rounded-lg border border-danger/40 bg-danger-soft text-danger text-sm">{err}</div>}
        {guide && <GuidePanel t={t} />}

        {loading && !data ? (
          <div className="flex items-center justify-center py-24 text-ink-3"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : data && total === 0 ? (
          <EmptyState t={t} onNew={() => setCreating(true)} />
        ) : data ? (
          <div className="space-y-6">
            {groups.map(({ stage, batches }) => (
              <StageGroup key={stage} stage={stage} batches={batches} data={data} t={t} fmt={fmt} onChanged={load} brandId={brandId!} />
            ))}
          </div>
        ) : null}
      </main>

      {creating && data && brandId && (
        <NewBatchModal data={data} brandId={brandId} t={t} prefill={prefill} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load(); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
const STEPS = [1, 2, 3, 4] as const;
const TERMS = ['angle', 'variable', 'hook', 'batch', 'code'] as const;

function GuidePanel({ t }: { t: T }) {
  return (
    <div className={`${card} p-4 mb-5`}>
      <h2 className="text-sm font-semibold text-ink">{t('ws.guide.title')}</h2>
      <ol className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 text-xs text-ink-2">
        {STEPS.map((n) => (
          <li key={n} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wide text-ink-4">{t('ws.guide.step')} {n}</span>
            <p className="mt-0.5">{t(`ws.guide.step${n}`)}</p>
          </li>
        ))}
      </ol>
      <dl className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2">
        {TERMS.map((k) => (
          <div key={k}>
            <dt className="text-xs font-semibold text-ink">{t(`ws.guide.${k}`)}</dt>
            <dd className="text-xs text-ink-3 mt-0.5 leading-relaxed break-words">{t(`ws.guide.${k}.def`)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EmptyState({ t, onNew }: { t: T; onNew: () => void }) {
  return (
    <div className={`${card} p-6 text-center`}>
      <p className="text-sm font-medium text-ink">{t('ws.empty.title')}</p>
      <ol className="mt-3 mx-auto max-w-md text-left text-xs text-ink-2 space-y-1.5 list-decimal pl-5">
        {STEPS.map((n) => <li key={n}>{t(`ws.guide.step${n}`)}</li>)}
      </ol>
      <button onClick={onNew} className={`${btnPrimary} mt-4`}><Plus className="w-4 h-4" />{t('ws.batch.new')}</button>
    </div>
  );
}

function StageGroup({ stage, batches, data, t, fmt, onChanged, brandId }: {
  stage: BatchStage; batches: BatchView[]; data: Data; t: T; fmt: Fmt; onChanged: () => void; brandId: string;
}) {
  const [open, setOpen] = useState(stage !== 'closed');
  return (
    <section>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 mb-2 text-left">
        {open ? <ChevronDown className="w-4 h-4 text-ink-4" /> : <ChevronRight className="w-4 h-4 text-ink-4" />}
        <h2 className="text-sm font-semibold text-ink">{t(`ws.stage.${stage}`)}</h2>
        <span className="text-xs text-ink-4 font-[family-name:var(--font-mono)] tabular-nums">{batches.length}</span>
      </button>
      {open && batches.length === 0 && <p className="text-xs text-ink-4 pl-6">{t(`ws.stage.${stage}.empty`)}</p>}
      {open && (
        <div className="space-y-3">
          {batches.map((b) => <BatchCard key={b.id} b={b} data={data} t={t} fmt={fmt} onChanged={onChanged} brandId={brandId} />)}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
function StagePill({ stage, t }: { stage: BatchStage; t: T }) {
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${STAGE_STYLE[stage]}`}>{t(`ws.stage.${stage}`)}</span>;
}

function VerdictChip({ v, t }: { v: Verdict | null; t: T }) {
  if (!v) return <span className="text-[11px] text-ink-4 whitespace-nowrap">{t('ws.verdict.none')}</span>;
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[11px] whitespace-nowrap ${VERDICT_STYLE[v]}`} title={t(`ws.verdict.${v}.help`)}>
      {t(`ws.action.${VERDICT_ACTION[v]}`)}
    </span>
  );
}

function pieceStatusKey(p: PieceView): string {
  if (p.meta_ad_id) return p.status === 'evaluated' || p.status === 'killed' ? `ws.piece.status.${p.status}` : 'ws.piece.status.live';
  if (p.status === 'ready' || p.status === 'uploaded') return 'ws.piece.status.uploaded';
  if (p.status === 'killed') return 'ws.piece.status.killed';
  return 'ws.piece.status.planned';
}

function BatchCard({ b, data, t, fmt, onChanged, brandId }: {
  b: BatchView; data: Data; t: T; fmt: Fmt; onChanged: () => void; brandId: string;
}) {
  const { copied, copy } = useCopied();
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matched = b.pieces.filter((p) => p.meta_ad_id).length;
  const codes = b.pieces.map((p) => p.ad_name).join('\n');
  const editable = b.stage !== 'closed';

  const run = async (key: string, fn: () => Promise<Response | void>) => {
    setBusy(key); setError(null);
    try {
      const res = await fn();
      if (res && !res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Failed'); }
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  };

  const copyBrief = async () => {
    setBusy('brief');
    try {
      const res = await fetch(`/api/workshop/brief?batch=${b.id}&format=json`);
      const json = await res.json();
      if (res.ok && json.markdown) await copy('brief', json.markdown);
    } finally { setBusy(null); }
  };

  const markUploaded = () => run('ready', () => fetch('/api/workshop', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.id, status: 'ready' }),
  }));
  const removePiece = (id: string) => run(`rm-${id}`, () => fetch(`/api/workshop/piece?id=${id}`, { method: 'DELETE' }));

  return (
    <article className={`${card} p-4 min-w-0`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-[family-name:var(--font-mono)] text-ink-3">{b.code}{b.angle_code ? ` · ${b.angle_code}` : ''}</span>
            <StagePill stage={b.stage} t={t} />
          </div>
          <h3 className="text-base font-semibold text-ink break-words">{b.name}</h3>
          <p className="text-xs text-ink-3 mt-0.5 break-words">
            {t('ws.card.angle')} {b.angle_name ?? b.angle_code ?? '—'} · {t('ws.card.changes')} {t(`ws.var.${b.variable}`)}
            {b.awareness ? ` · ${t('ws.card.awareness')} ${t(`ws.aware.${b.awareness}`)}` : ''}
            {' · '}{t('ws.card.pieces', { n: b.pieces.length })} · {t('ws.card.spend')} <span className="font-[family-name:var(--font-mono)] tabular-nums">{fmt.money(b.spend, data.currency)}</span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-ink-2 font-[family-name:var(--font-mono)] tabular-nums">{t('ws.card.progress', { done: matched, total: b.pieces.length })}</p>
          <div className="mt-1 h-1.5 w-32 rounded-full bg-surface-2 overflow-hidden ml-auto">
            <div className="h-full bg-ok transition-all" style={{ width: `${b.pieces.length ? Math.round((matched / b.pieces.length) * 100) : 0}%` }} />
          </div>
        </div>
      </div>

      {b.pieces.length === 0 ? (
        <p className="text-sm text-ink-3 mt-3">{t('ws.piece.empty')}</p>
      ) : (
        <div className="mt-3 overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs min-w-[760px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-ink-4 border-b border-line">
                <th className="text-left font-medium py-1.5 pr-2">{t('ws.col.code')}</th>
                <th className="text-left font-medium py-1.5 pr-2">{t('ws.col.format')}</th>
                <th className="text-left font-medium py-1.5 pr-2">{t('ws.col.hook')}</th>
                <th className="text-left font-medium py-1.5 pr-2">{t('ws.col.status')}</th>
                <th className="text-right font-medium py-1.5 pr-2">{t('ws.col.spend')}</th>
                <th className="text-right font-medium py-1.5 pr-2">{t('ws.col.purchases')}</th>
                <th className="text-right font-medium py-1.5 pr-2">{t('ws.col.cpa')}</th>
                <th className="text-right font-medium py-1.5 pr-2">{t('ws.col.roas')}</th>
                <th className="text-left font-medium py-1.5 pr-2">{t('ws.col.verdict')}</th>
                {editable && <th className="py-1.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {b.pieces.map((p) => (
                <tr key={p.id} className="align-middle">
                  <td className="py-1.5 pr-2">
                    <span className="inline-flex items-center gap-1">
                      <code className="font-[family-name:var(--font-mono)] text-[11px] text-ink whitespace-nowrap" title={p.ad_name}>{p.ad_name}</code>
                      <button onClick={() => void copy(p.id, p.ad_name)} className="p-1 rounded text-ink-4 hover:text-ink shrink-0" title={t('ws.piece.copy')}>
                        {copied === p.id ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-ink-2 whitespace-nowrap">{t(`ws.format.${p.format ?? 'static'}`)}</td>
                  <td className="py-1.5 pr-2 text-ink-2 max-w-[220px]"><span className="block truncate" title={p.hook ?? ''}>{p.hook ?? '—'}</span></td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <span className={p.meta_ad_id ? 'text-ok' : 'text-ink-3'} title={p.meta_ad_id ? undefined : t('ws.piece.waiting')}>{t(pieceStatusKey(p))}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right font-[family-name:var(--font-mono)] tabular-nums text-ink">{fmt.money(p.spend, data.currency)}</td>
                  <td className="py-1.5 pr-2 text-right font-[family-name:var(--font-mono)] tabular-nums text-ink">{p.meta_ad_id ? fmt.num(p.purchases ?? 0) : '—'}</td>
                  <td className="py-1.5 pr-2 text-right font-[family-name:var(--font-mono)] tabular-nums text-ink">{fmt.money(p.cpa, data.currency)}</td>
                  <td className="py-1.5 pr-2 text-right font-[family-name:var(--font-mono)] tabular-nums text-ink">{p.roas == null ? '—' : `${fmt.ratio(p.roas)}x`}</td>
                  <td className="py-1.5 pr-2"><VerdictChip v={p.verdict ?? p.verdict_now} t={t} /></td>
                  {editable && (
                    <td className="py-1.5 text-right">
                      {!p.meta_ad_id && (
                        <button onClick={() => void removePiece(p.id)} disabled={busy === `rm-${p.id}`} className="p-1 rounded text-ink-4 hover:text-danger" title={t('ws.piece.remove')}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {b.closed_note && <p className="text-xs text-ink-2 mt-3 border-l-2 border-line pl-3 break-words">{b.closed_note}</p>}
      {error && <p className="text-xs text-danger mt-3">{error}</p>}

      <div className="flex items-center gap-2 flex-wrap mt-3">
        {b.pieces.length > 0 && (
          <button onClick={() => void copy('all', codes)} className={btn}>
            {copied === 'all' ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}{t('ws.card.copyCodes')}
          </button>
        )}
        <a href={`/api/workshop/brief?batch=${b.id}`} target="_blank" rel="noreferrer" className={btn}><FileText className="w-3.5 h-3.5" />{t('ws.brief.open')}</a>
        <button onClick={() => void copyBrief()} disabled={busy === 'brief'} className={btn}>
          {copied === 'brief' ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}{t('ws.brief.copy')}
        </button>
        {editable && (
          <button onClick={() => { setAdding((a) => !a); setClosing(false); }} className={btn}><Plus className="w-3.5 h-3.5" />{t('ws.piece.add')}</button>
        )}
        {b.stage === 'producing' && b.pieces.length > 0 && (
          <button onClick={() => void markUploaded()} disabled={busy === 'ready'} className={btn} title={t('ws.card.markUploaded.help')}>
            <Check className="w-3.5 h-3.5" />{t('ws.card.markUploaded')}
          </button>
        )}
        {editable && (
          <button onClick={() => { setClosing((c) => !c); setAdding(false); }} className={`${btn} ml-auto`}>{t('ws.close.button')}</button>
        )}
      </div>

      {adding && <AddPieceForm batchId={b.id} t={t} onDone={() => { setAdding(false); onChanged(); }} />}
      {closing && <CloseForm b={b} brandId={brandId} t={t} onDone={() => { setClosing(false); onChanged(); }} onCancel={() => setClosing(false)} />}
    </article>
  );
}

// ---------------------------------------------------------------------------
function AddPieceForm({ batchId, t, onDone }: { batchId: string; t: T; onDone: () => void }) {
  const [format, setFormat] = useState<string>('static');
  const [hook, setHook] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/workshop/piece', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, hook, format }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-2 items-end">
        <div>
          <label className={label}>{t('ws.piece.format')}</label>
          <select value={format} onChange={(e) => setFormat(e.target.value)} className={input}>
            {PIECE_FORMATS.map((f) => <option key={f} value={f}>{t(`ws.format.${f}`)}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className={label}>{t('ws.piece.hook')}</label>
          <input value={hook} onChange={(e) => setHook(e.target.value)} className={input} placeholder={t('ws.piece.hook.placeholder')} />
        </div>
        <button onClick={() => void submit()} disabled={busy || !hook.trim()} className={btnPrimary}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('ws.piece.add')}
        </button>
      </div>
      <p className={hint}>{t('ws.piece.code.help')}</p>
      {error && <p className="text-xs text-danger mt-1">{error}</p>}
    </div>
  );
}

function CloseForm({ b, brandId, t, onDone, onCancel }: { b: BatchView; brandId: string; t: T; onDone: () => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notReadable, setNotReadable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (force: boolean) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/workshop/close', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: b.id, brandId, window: WINDOW_DAYS, force, text: text || undefined, note: note || undefined }),
      });
      const json = await res.json();
      if (res.status === 409 && json.error === 'no_readable_pieces') { setNotReadable(true); return; }
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3 space-y-2">
      <p className="text-xs text-ink-2">{t('ws.close.help')}</p>
      <div>
        <label className={label}>{t('ws.close.learning')}</label>
        <input value={text} onChange={(e) => setText(e.target.value)} className={input} placeholder={t('ws.close.learning.placeholder')} />
      </div>
      <div>
        <label className={label}>{t('ws.close.note')}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={input} placeholder={t('ws.close.note.placeholder')} />
      </div>
      {notReadable && (
        <div className="px-3 py-2 rounded-lg border border-warn/40 bg-warn-soft text-warn text-xs">
          <p>{t('ws.close.notReadable')}</p>
          <button onClick={() => void submit(true)} disabled={busy} className="mt-1 underline">{t('ws.close.force')}</button>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={() => void submit(false)} disabled={busy} className={btnPrimary}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('ws.close.confirm')}
        </button>
        <button onClick={onCancel} className={btn}>{t('ws.cancel')}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
interface Draft { format: string; hook: string }
const emptyRows = (): Draft[] => Array.from({ length: 4 }, () => ({ format: 'static', hook: '' }));

function matchAngle(angles: Angle[], text: string): string {
  const q = text.trim().toLowerCase();
  if (!q) return angles[0]?.id ?? '';
  const hit = angles.find((a) => a.name.toLowerCase().includes(q) || (a.code ?? '').toLowerCase().includes(q) || q.includes(a.name.toLowerCase()));
  return hit?.id ?? angles[0]?.id ?? '';
}

function NewBatchModal({ data, brandId, t, prefill, onClose, onDone }: {
  data: Data; brandId: string; t: T; prefill?: Prefill | null; onClose: () => void; onDone: () => void;
}) {
  const [angleId, setAngleId] = useState(() => matchAngle(data.angles, prefill?.angle ?? ''));
  const [variable, setVariable] = useState<string>('hook');
  const [name, setName] = useState(prefill?.name ?? '');
  const [nameTouched, setNameTouched] = useState(Boolean(prefill?.name));
  const [awareness, setAwareness] = useState('');
  const [rows, setRows] = useState<Draft[]>(() => {
    const rs = emptyRows();
    if (prefill) {
      const f = prefill.format.trim().toLowerCase();
      const format = PIECE_FORMATS.find((pf) => pf === f || t(`ws.format.${pf}`).toLowerCase() === f) ?? 'static';
      rs[0] = { format, hook: prefill.hook };
    }
    return rs;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string[] | null>(null);
  const { copied, copy } = useCopied();

  const angle = data.angles.find((a) => a.id === angleId) ?? null;
  const suggested = angle ? `${angle.name} · ${t(`ws.var.${variable}`)}` : '';
  const finalName = nameTouched ? name : suggested;
  const finalAwareness = awareness || angle?.awareness_stage || '';
  const validRows = rows.filter((r) => r.hook.trim());

  const setRow = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/workshop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, angle_id: angleId, name: finalName.trim(), variable, awareness: finalAwareness || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      const batchId = json.batch.id as string;
      const codes: string[] = [];
      for (const r of validRows) {
        const pr = await fetch('/api/workshop/piece', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId, hook: r.hook.trim(), format: r.format }),
        });
        const pj = await pr.json();
        if (!pr.ok) throw new Error(pj.error ?? 'Failed');
        codes.push(pj.piece.ad_name as string);
      }
      setMinted(codes);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-overlay/60 flex items-start justify-center p-4 overflow-y-auto" onClick={minted ? undefined : onClose}>
      <div className="w-full max-w-2xl my-8 rounded-xl border border-line bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-ink">{minted ? t('ws.new.done.title') : t('ws.batch.new')}</h3>
          <button onClick={minted ? onDone : onClose} className="text-ink-3 hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        {minted ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-ink-2">{t('ws.new.done.help')}</p>
            <pre className="rounded-lg border border-line bg-surface-2 p-3 text-[11px] font-[family-name:var(--font-mono)] text-ink-2 overflow-x-auto whitespace-pre">{minted.join('\n') || t('ws.piece.empty')}</pre>
            <div className="flex items-center gap-2 flex-wrap">
              {minted.length > 0 && (
                <button onClick={() => void copy('all', minted.join('\n'))} className={btn}>
                  {copied === 'all' ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}{t('ws.new.done.copyAll')}
                </button>
              )}
              <button onClick={onDone} className={`${btnPrimary} ml-auto`}>{t('ws.new.done.ok')}</button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            <p className="text-xs text-ink-3">{t('ws.new.intro')}</p>

            <div>
              <label className={label}>{t('ws.new.angle')}</label>
              <select value={angleId} onChange={(e) => setAngleId(e.target.value)} className={input}>
                {data.angles.length === 0 && <option value="">—</option>}
                {data.angles.map((a) => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ''}{a.name}</option>)}
              </select>
              <p className={hint}>
                {t('ws.new.angle.help')}
                {data.angles.length === 0 && <> <a href="/cerebro" className="text-accent underline inline-flex items-center gap-0.5">{t('ws.new.angle.link')}<ExternalLink className="w-3 h-3" /></a></>}
                {angle?.personas?.name && <> · {t('ws.batch.persona')}: {angle.personas.name}</>}
              </p>
            </div>

            <div>
              <label className={label}>{t('ws.new.variable')}</label>
              <select value={variable} onChange={(e) => setVariable(e.target.value)} className={input}>
                {BATCH_VARIABLES.map((v) => <option key={v} value={v}>{t(`ws.var.${v}.long`)}</option>)}
              </select>
              <p className={hint}>{t('ws.new.variable.help')}</p>
            </div>

            <div>
              <label className={label}>{t('ws.new.name')}</label>
              <input value={finalName} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} className={input} placeholder={t('ws.new.name.placeholder')} />
              <p className={hint}>{t('ws.new.name.help')}</p>
            </div>

            <div>
              <label className={label}>{t('ws.new.awareness')}</label>
              <select value={finalAwareness} onChange={(e) => setAwareness(e.target.value)} className={input}>
                <option value="">—</option>
                {AWARENESS_STAGES.map((a) => <option key={a} value={a}>{t(`ws.aware.${a}`)}</option>)}
              </select>
              <p className={hint}>{t('ws.new.awareness.help')}</p>
            </div>

            <div>
              <label className={label}>{t('ws.new.pieces')}</label>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-[130px_1fr_auto] gap-2 items-center">
                    <select value={r.format} onChange={(e) => setRow(i, { format: e.target.value })} className={input}>
                      {PIECE_FORMATS.map((f) => <option key={f} value={f}>{t(`ws.format.${f}`)}</option>)}
                    </select>
                    <input value={r.hook} onChange={(e) => setRow(i, { hook: e.target.value })} className={`${input} min-w-0`} placeholder={t('ws.piece.hook.placeholder')} />
                    <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={rows.length <= 1} className="p-1.5 rounded text-ink-4 hover:text-danger disabled:opacity-30" title={t('ws.piece.remove')}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                <button onClick={() => setRows((rs) => [...rs, { format: 'static', hook: '' }])} disabled={rows.length >= 8} className={btn}>
                  <Plus className="w-3.5 h-3.5" />{t('ws.new.addRow')}
                </button>
                <p className="text-[11px] text-ink-4">{t('ws.piece.code.help')}</p>
              </div>
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}

            <button onClick={() => void submit()} disabled={busy || !angleId || !finalName.trim()} className={`${btnPrimary} w-full justify-center py-2`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('ws.new.submit')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
