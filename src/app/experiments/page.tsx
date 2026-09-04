'use client';

// =============================================================================
// Experiments — the inbox of ideas, the board of experiments, and the detail
// of one: hypothesis, control, criteria, variants (pinned to Meta by id), the
// brief, and the verdict with its learning. One variable per experiment.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Loader2, X, Copy, Check, Sparkles, ArrowUpRight, Trash2, Link2, CircleDashed, CheckCircle2, XCircle, MinusCircle, ChevronRight, NotebookPen } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { useT, useFormatters } from '@/lib/i18n';
import { EXPERIMENT_VARIABLES, type ExperimentVariable, type SuccessCriteria, type Verdict } from '@/lib/experiments';
import type { ExperimentFull, VariantRow } from '@/lib/experiments-server';
import type { Brief } from '@/lib/agents/brief-writer';
import type { HypothesisDoc } from '@/lib/agents/hypothesis-writer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Idea { id: string; text: string; rationale: string | null; notes: string | null; source: string; status: string; variable: string | null; persona_id: string | null; angle_id: string | null; concept_id: string | null; experiment_id: string | null; created_at: string }
interface Member { id: string; name: string; role: string; is_ai: boolean }
interface Product { id: string; name: string; price: number | null; active: boolean }

/** Who can be handed a variant to produce. Everyone else stays out of that list. */
const PRODUCTION_ROLES = new Set(['image_editor', 'video_editor', 'ugc_creator', 'designer', 'editor']);
interface Named { id: string; name: string; code?: string | null }
interface AdPick { ad_id: string; ad_name: string; spend: number; roas: number | null; hook_rate: number | null }

type Fmt = ReturnType<typeof useFormatters>;
const ACTIVE = ['draft', 'planned', 'producing', 'live', 'evaluating'];

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-surface-2 text-ink-3 border-line',
  planned: 'bg-surface-2 text-ink-2 border-line',
  producing: 'bg-warn-soft text-warn border-warn/40',
  live: 'bg-accent-soft text-accent border-accent/40 font-medium',
  evaluating: 'bg-accent-soft text-accent border-accent/40 border-dashed',
  closed: 'bg-surface-2 text-ink-2 border-line-strong',
  archived: 'bg-surface-2 text-ink-4 border-line',
};
const VERDICT_STYLE: Record<Verdict, string> = {
  validated: 'bg-ok-soft text-ok border-ok/40 font-semibold',
  refuted: 'bg-danger-soft text-danger border-danger/40 font-semibold',
  inconclusive: 'bg-warn-soft text-warn border-warn/40',
};

const input = 'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent';
const label = 'block text-[11px] uppercase tracking-wide text-ink-3 mb-1';
const btn = 'inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:text-ink hover:border-line-strong disabled:opacity-50 transition-colors';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-strong disabled:opacity-50';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
  return data as T;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ExperimentsPage() {
  const t = useT();
  const f = useFormatters();
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();

  const [experiments, setExperiments] = useState<ExperimentFull[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [currency, setCurrency] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Named[]>([]);
  const [angles, setAngles] = useState<Named[]>([]);
  const [concepts, setConcepts] = useState<Named[]>([]);
  const [ads, setAds] = useState<AdPick[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [closedNotice, setClosedNotice] = useState(0);
  const [tab, setTab] = useState<'active' | 'closed'>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ idea?: Idea } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeBrandId) return;
    setLoading(true);
    try {
      const [ex, id, pe, an, co, ad, pr] = await Promise.all([
        api<{ experiments: ExperimentFull[]; currency: string | null; closed: string[]; members: Member[] }>(`/api/experiments?brand=${activeBrandId}`),
        api<{ items: Idea[] }>(`/api/ideas?brand=${activeBrandId}`),
        api<{ items: Named[] }>(`/api/plan/personas?brand=${activeBrandId}`),
        api<{ items: Named[] }>(`/api/plan/angles?brand=${activeBrandId}`),
        api<{ items: Named[] }>(`/api/plan/concepts?brand=${activeBrandId}`),
        api<{ ads: AdPick[] }>(`/api/meta/ads?brand=${activeBrandId}&window=lifetime`),
        api<{ items: Product[] }>(`/api/products?brand=${activeBrandId}`).catch(() => ({ items: [] as Product[] })),
      ]);
      setExperiments(ex.experiments); setCurrency(ex.currency); setMembers(ex.members);
      if (ex.closed.length) setClosedNotice(ex.closed.length);
      setIdeas(id.items); setPersonas(pe.items); setAngles(an.items); setConcepts(co.items);
      setAds((ad.ads ?? []).map((a) => ({ ad_id: a.ad_id, ad_name: a.ad_name, spend: a.spend, roas: a.roas, hook_rate: a.hook_rate })));
      setProducts((pr.items ?? []).filter((x) => x.active !== false));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('exp.error.generic'));
    } finally {
      setLoading(false);
    }
  }, [activeBrandId, t]);
  useEffect(() => { load(); }, [load]);

  const patchExperiment = (e: ExperimentFull) => setExperiments((xs) => xs.map((x) => (x.id === e.id ? { ...x, ...e } : x)));
  const selected = experiments.find((e) => e.id === selectedId) ?? null;
  const visible = experiments.filter((e) => (tab === 'active' ? ACTIVE.includes(e.status) : ['closed', 'archived'].includes(e.status)));
  const memberName = (id: string | null) => members.find((m) => m.id === id)?.name ?? '—';

  return (
    <main className="flex-1 min-h-screen">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />
      <section className="px-4 sm:px-6 py-6">
        <div className="max-w-[1400px] mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h1 className="text-xl font-semibold font-[family-name:var(--font-serif)] tracking-tight text-ink">{t('exp.title')} · {activeBrand?.name ?? ''}</h1>
              <p className="text-xs text-ink-3 mt-0.5">{t('exp.subtitle')}</p>
            </div>
            <button onClick={() => setCreating({})} className={btnPrimary}><Plus className="w-3.5 h-3.5" />{t('exp.new')}</button>
          </div>

          {error && <div className="mb-4 rounded-md border border-danger/40 bg-danger-soft px-4 py-2 text-sm text-danger flex items-center justify-between">{error}<button onClick={() => setError(null)}><X className="w-4 h-4" /></button></div>}
          {closedNotice > 0 && (
            <div className="mb-4 rounded-md border border-ok/40 bg-ok-soft px-4 py-2 text-sm text-ok flex items-center justify-between">
              {t('exp.closedBanner', { n: closedNotice })}<button onClick={() => setClosedNotice(0)}><X className="w-4 h-4" /></button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
            <Inbox
              brandId={activeBrandId} ideas={ideas} setIdeas={setIdeas}
              onPromote={(idea) => setCreating({ idea })} onError={setError}
            />

            <div className="min-w-0">
              <div className="flex items-center gap-1 mb-3">
                {(['active', 'closed'] as const).map((k) => (
                  <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 text-xs rounded-md border ${tab === k ? 'bg-surface-2 text-ink border-line-strong font-medium' : 'text-ink-2 border-transparent hover:text-ink'}`}>
                    {t(`exp.board.${k}`)} <span className="text-ink-4 ml-1">{experiments.filter((e) => (k === 'active' ? ACTIVE.includes(e.status) : !ACTIVE.includes(e.status))).length}</span>
                  </button>
                ))}
              </div>

              {loading && !experiments.length ? (
                <div className="flex items-center gap-2 text-sm text-ink-3 py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /></div>
              ) : !visible.length ? (
                <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center text-sm text-ink-3">{t('exp.board.empty')}</div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {visible.map((e) => (
                    <ExperimentCard key={e.id} e={e} f={f} currency={currency} owner={memberName(e.owner_id)} selected={e.id === selectedId} onClick={() => setSelectedId(e.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {selected && activeBrandId && (
        <Detail
          e={selected} brandId={activeBrandId} currency={currency} members={members} personas={personas} angles={angles} concepts={concepts} ads={ads} products={products}
          onClose={() => setSelectedId(null)} onChange={patchExperiment} onReload={load} onError={setError}
        />
      )}
      {creating && activeBrandId && (
        <CreateModal
          brandId={activeBrandId} idea={creating.idea} members={members} personas={personas} angles={angles} concepts={concepts} ads={ads} products={products} currency={currency}
          onClose={() => setCreating(null)}
          onCreated={(e) => { setCreating(null); setExperiments((xs) => [e, ...xs]); setSelectedId(e.id); load(); }}
          onError={setError}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
function Inbox({ brandId, ideas, setIdeas, onPromote, onError }: { brandId: string | null; ideas: Idea[]; setIdeas: (u: (xs: Idea[]) => Idea[]) => void; onPromote: (i: Idea) => void; onError: (m: string) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inbox = ideas.filter((i) => i.status === 'inbox');

  const add = async () => {
    if (!text.trim() || !brandId) return;
    setBusy(true);
    try {
      const { item } = await api<{ item: Idea }>('/api/ideas', { method: 'POST', body: JSON.stringify({ brandId, text: text.trim(), source: 'manual' }) });
      setIdeas((xs) => [item, ...xs]); setText('');
    } catch (e) { onError(e instanceof Error ? e.message : t('exp.error.generic')); } finally { setBusy(false); }
  };
  const saveNotes = async (i: Idea, notes: string) => {
    try {
      await api('/api/ideas', { method: 'PATCH', body: JSON.stringify({ id: i.id, notes }) });
      setIdeas((xs) => xs.map((x) => (x.id === i.id ? { ...x, notes } : x)));
    } catch (e) { onError(e instanceof Error ? e.message : t('exp.error.generic')); }
  };
  const discard = async (i: Idea) => {
    try {
      await api('/api/ideas', { method: 'PATCH', body: JSON.stringify({ id: i.id, status: 'discarded' }) });
      setIdeas((xs) => xs.map((x) => (x.id === i.id ? { ...x, status: 'discarded' } : x)));
    } catch (e) { onError(e instanceof Error ? e.message : t('exp.error.generic')); }
  };

  return (
    <aside className="rounded-lg border border-line bg-surface">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">{t('exp.inbox')} <span className="text-ink-4 font-normal">{inbox.length}</span></h2>
      </div>
      <div className="p-3 border-b border-line">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={t('exp.inbox.placeholder')} className={`${input} resize-none`}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(); }} />
        <div className="flex justify-end mt-2">
          <button onClick={add} disabled={busy || !text.trim()} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}{t('exp.inbox.add')}</button>
        </div>
      </div>
      <ul className="max-h-[70vh] overflow-y-auto divide-y divide-line">
        {!inbox.length && <li className="px-4 py-6 text-xs text-ink-3 text-center">{t('exp.inbox.empty')}</li>}
        {inbox.map((i) => (
          <li key={i.id} className="px-4 py-3 group">
            <p className="text-sm text-ink leading-snug">{i.text}</p>
            {i.rationale && <p className="text-xs text-ink-3 mt-1">{i.rationale}</p>}
            <textarea defaultValue={i.notes ?? ''} rows={2} placeholder={t('exp.inbox.notes.placeholder')}
              className={`${input} resize-y mt-2 text-xs`}
              onBlur={(e) => e.target.value !== (i.notes ?? '') && saveNotes(i, e.target.value)} />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-ink-4">{t(`exp.inbox.source.${i.source}`)}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => discard(i)} className="text-[11px] text-ink-3 hover:text-danger px-1.5 py-0.5">{t('exp.inbox.discard')}</button>
                <button onClick={() => onPromote(i)} className="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent-strong px-1.5 py-0.5 font-medium">{t('exp.inbox.promote')}<ArrowUpRight className="w-3 h-3" /></button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
function ExperimentCard({ e, f, currency, owner, selected, onClick }: { e: ExperimentFull; f: Fmt; currency: string | null; owner: string; selected: boolean; onClick: () => void }) {
  const t = useT();
  const ev = e.evaluation;
  const verdict = (e.result as { verdict?: Verdict } | null)?.verdict ?? null;
  const pinned = e.variants.filter((v) => v.meta_ad_id).length;
  return (
    <button onClick={onClick} className={`text-left rounded-lg border bg-surface p-4 hover:border-line-strong transition-colors ${selected ? 'border-accent' : 'border-line'}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-[family-name:var(--font-mono)] text-ink-3">{e.code}</span>
        <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATUS_STYLE[e.status] ?? STATUS_STYLE.draft}`}>{t(`exp.status.${e.status}`)}</span>
      </div>
      <h3 className="text-sm font-medium text-ink leading-snug line-clamp-2">{e.name}</h3>
      <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[11px]">
        <span className="px-1.5 py-0.5 rounded border border-accent/40 text-accent bg-accent-soft">{t(`exp.variable.${e.variable}`)}</span>
        <span className="text-ink-3">{owner}</span>
        <span className="text-ink-4">· {e.variants.length} {t('exp.variants').toLowerCase()}{pinned ? ` · ${pinned} ↔ Meta` : ''}</span>
      </div>
      {e.status === 'closed' && verdict ? (
        <div className="mt-3 flex items-center gap-2">
          <span className={`text-[11px] px-1.5 py-0.5 rounded border ${VERDICT_STYLE[verdict]}`}>{t(`exp.verdict.${verdict}`)}</span>
          <span className="text-[11px] text-ink-3">{t(`exp.reason.${e.close_reason ?? 'manual'}`)}</span>
        </div>
      ) : ev ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-ink-3 mb-1">
            <span>{t('exp.progress', { spend: f.money(ev.spend, currency), min: f.money(e.criteria.min_spend, currency) })}</span>
            <span>{ev.best?.roas != null ? `ROAS ${f.ratio(ev.best.roas)}` : t(`exp.reason.${ev.reason}`)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-inset overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.round(ev.progress * 100)}%` }} /></div>
        </div>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------
function Detail({ e, brandId, currency, members, personas, angles, concepts, ads, products, onClose, onChange, onReload, onError }: {
  e: ExperimentFull; brandId: string; currency: string | null; members: Member[]; personas: Named[]; angles: Named[]; concepts: Named[]; ads: AdPick[]; products: Product[];
  onClose: () => void; onChange: (e: ExperimentFull) => void; onReload: () => void; onError: (m: string) => void;
}) {
  const t = useT();
  const f = useFormatters();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showClaim, setShowClaim] = useState(false);
  const ev = e.evaluation;
  const brief = e.brief as Brief | null;
  const doc = (e.hypothesis_doc ?? null) as HypothesisDoc | null;
  const verdict = (e.result as { verdict?: Verdict } | null)?.verdict ?? null;
  const fail = (x: unknown) => onError(x instanceof Error ? x.message : t('exp.error.generic'));

  const patch = async (body: Record<string, unknown>) => {
    setBusy('patch');
    try { const { experiment } = await api<{ experiment: ExperimentFull }>('/api/experiments', { method: 'PATCH', body: JSON.stringify({ id: e.id, ...body }) }); onChange({ ...e, ...experiment }); }
    catch (x) { fail(x); } finally { setBusy(null); }
  };
  const draftHypothesis = async () => {
    setBusy('hypothesis');
    try { const { experiment } = await api<{ experiment: ExperimentFull }>('/api/experiments/hypothesis', { method: 'POST', body: JSON.stringify({ id: e.id }) }); onChange({ ...e, ...experiment }); }
    catch (x) { fail(x); } finally { setBusy(null); }
  };
  const patchDoc = (part: Partial<HypothesisDoc>) => patch({ hypothesis_doc: { ...(doc ?? {}), ...part } });
  const writeBrief = async () => {
    setBusy('brief');
    try { const { experiment } = await api<{ experiment: ExperimentFull }>('/api/experiments/brief', { method: 'POST', body: JSON.stringify({ id: e.id }) }); onChange({ ...e, ...experiment }); }
    catch (x) { fail(x); } finally { setBusy(null); }
  };
  const close = async (v: Verdict) => {
    setBusy('close');
    try { await api('/api/experiments/close', { method: 'POST', body: JSON.stringify({ id: e.id, verdict: v }) }); onReload(); }
    catch (x) { fail(x); } finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy('delete');
    try { await api(`/api/experiments?id=${e.id}`, { method: 'DELETE' }); onClose(); onReload(); }
    catch (x) { fail(x); } finally { setBusy(null); }
  };
  const copy = (s: string) => { navigator.clipboard.writeText(s); setCopied(s); setTimeout(() => setCopied(null), 1200); };
  const setVariantStatus = async (v: VariantRow, status: string) => {
    try { await api('/api/experiments/variants', { method: 'PATCH', body: JSON.stringify({ id: v.id, status }) }); onReload(); } catch (x) { fail(x); }
  };
  const setVariantOwner = async (v: VariantRow, owner_id: string | null) => {
    try { await api('/api/experiments/variants', { method: 'PATCH', body: JSON.stringify({ id: v.id, owner_id }) }); onReload(); } catch (x) { fail(x); }
  };
  const makers = members.filter((m) => PRODUCTION_ROLES.has(m.role));
  const removeVariant = async (v: VariantRow) => {
    try { await api(`/api/experiments/variants?id=${v.id}`, { method: 'DELETE' }); onReload(); } catch (x) { fail(x); }
  };
  const vm = (v: VariantRow) => ev?.variants.find((x) => x.variant_id === v.id);
  const nameOf = (xs: Named[], id: string | null) => xs.find((x) => x.id === id);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-overlay/60" />
      <div onClick={(x) => x.stopPropagation()} className="relative h-full w-full max-w-[760px] bg-canvas border-l border-line overflow-y-auto shadow-xl">
        <div className="sticky top-0 z-10 bg-canvas/95 backdrop-blur border-b border-line px-5 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="font-[family-name:var(--font-mono)] text-ink-3">{e.code}</span>
              <span className={`px-1.5 py-0.5 rounded border ${STATUS_STYLE[e.status]}`}>{t(`exp.status.${e.status}`)}</span>
              <span className="px-1.5 py-0.5 rounded border border-accent/40 text-accent bg-accent-soft">{t(`exp.variable.${e.variable}`)}</span>
              {verdict && <span className={`px-1.5 py-0.5 rounded border ${VERDICT_STYLE[verdict]}`}>{t(`exp.verdict.${verdict}`)}</span>}
            </div>
            <h2 className="text-base font-semibold text-ink font-[family-name:var(--font-serif)] truncate mt-0.5">{e.name}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-surface-2"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {e.status === 'draft' && <button className={btn} disabled={!!busy} onClick={() => patch({ status: 'planned' })}>{t('exp.action.markPlanned')}</button>}
            {['draft', 'planned'].includes(e.status) && <button className={btn} disabled={!!busy} onClick={() => patch({ status: 'producing' })}>{t('exp.action.markProducing')}</button>}
            {['planned', 'producing'].includes(e.status) && <button className={btn} disabled={!!busy} onClick={() => patch({ status: 'live' })}>{t('exp.action.markLive')}</button>}
            {ACTIVE.includes(e.status) && (
              <span className="inline-flex rounded-md border border-line overflow-hidden">
                {(['validated', 'refuted', 'inconclusive'] as Verdict[]).map((v) => (
                  <button key={v} disabled={!!busy} onClick={() => close(v)} className="px-2.5 py-1.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink border-r last:border-r-0 border-line disabled:opacity-50" title={t('exp.action.closeWith', { verdict: t(`exp.verdict.${v}`) })}>
                    {t('exp.action.close')}: {t(`exp.verdict.${v}`)}
                  </button>
                ))}
              </span>
            )}
            <button className={`${btn} ml-auto text-danger hover:text-danger`} disabled={!!busy} onClick={remove}><Trash2 className="w-3.5 h-3.5" />{e.status === 'closed' ? t('exp.action.archive') : t('exp.action.delete')}</button>
          </div>

          {/* Hypothesis + entities */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('exp.field.hypothesis')} className="sm:col-span-2">
              <textarea defaultValue={e.hypothesis ?? ''} rows={2} placeholder={t('exp.field.hypothesis.placeholder')} className={`${input} resize-none`} onBlur={(x) => x.target.value !== (e.hypothesis ?? '') && patch({ hypothesis: x.target.value })} />
            </Field>
            <Field label={t('exp.field.persona')}><Select value={e.persona_id} options={personas} onChange={(v) => patch({ persona_id: v })} /></Field>
            <Field label={t('exp.field.angle')}><Select value={e.angle_id} options={angles} onChange={(v) => patch({ angle_id: v })} /></Field>
            <Field label={t('exp.field.concept')}><Select value={e.concept_id} options={concepts} onChange={(v) => patch({ concept_id: v })} /></Field>
            <Field label={t('exp.field.owner')}><Select value={e.owner_id} options={members} onChange={(v) => patch({ owner_id: v })} /></Field>
            <Field label={t('exp.field.product')}>
              <Select value={e.product_id} options={products} onChange={(v) => patch({ product_id: v })} placeholder={t('exp.field.product.none')} />
            </Field>
            <Field label={t('exp.field.control')}>
              <AdSearch ads={ads} value={e.control_ad_id} valueName={e.control_name} onChange={(id) => patch({ control_ad_id: id })} f={f} currency={currency} />
            </Field>
          </div>

          {/* Guided hypothesis — the AI drafts it, the strategist owns it */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs uppercase tracking-wide text-ink-3">{t('exp.doc')}</h3>
              <button className={btn} disabled={busy === 'hypothesis'} onClick={draftHypothesis}>
                {busy === 'hypothesis' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {busy === 'hypothesis' ? t('exp.doc.drafting') : doc ? t('exp.doc.redraft') : t('exp.doc.draft')}
              </button>
            </div>
            {!doc ? (
              <p className="text-xs text-ink-3 rounded-md border border-dashed border-line px-4 py-5 text-center">{t('exp.doc.empty')}</p>
            ) : (
              <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
                <DocField label={t('exp.doc.statement')} value={doc.statement} rows={2} onSave={(v) => patchDoc({ statement: v })} />
                <div className="grid sm:grid-cols-2 gap-3">
                  <DocField label={t('exp.doc.audience')} value={doc.audience} rows={3} onSave={(v) => patchDoc({ audience: v })} />
                  <DocField label={t('exp.doc.avatar')} value={doc.avatar} rows={3} onSave={(v) => patchDoc({ avatar: v })} />
                  <DocField label={t('exp.doc.angleRationale')} value={doc.angle_rationale} rows={3} onSave={(v) => patchDoc({ angle_rationale: v })} />
                  <DocField label={t('exp.doc.conceptRationale')} value={doc.concept_rationale} rows={3} onSave={(v) => patchDoc({ concept_rationale: v })} />
                </div>
                <DocList label={t('exp.doc.variantsToMake')} items={doc.variants_to_make} onSave={(v) => patchDoc({ variants_to_make: v })} />
                <DocList label={t('exp.doc.heldConstant')} items={doc.held_constant} onSave={(v) => patchDoc({ held_constant: v })} />
                <DocField label={t('exp.doc.killSignal')} value={doc.kill_signal} rows={2} onSave={(v) => patchDoc({ kill_signal: v })} />
                {doc.open_questions?.length > 0 && <DocList label={t('exp.doc.openQuestions')} items={doc.open_questions} onSave={(v) => patchDoc({ open_questions: v })} />}
                <p className="text-[11px] text-ink-4">{t('exp.doc.help')}</p>
              </div>
            )}
          </section>

          {/* Notebook */}
          <section>
            <h3 className="text-xs uppercase tracking-wide text-ink-3 mb-2 flex items-center gap-1.5"><NotebookPen className="w-3.5 h-3.5" />{t('exp.notes')}</h3>
            <textarea defaultValue={e.notes ?? ''} rows={4} placeholder={t('exp.notes.placeholder')} className={`${input} resize-y`}
              onBlur={(x) => x.target.value !== (e.notes ?? '') && patch({ notes: x.target.value })} />
          </section>

          {/* Criteria */}
          <section>
            <h3 className="text-xs uppercase tracking-wide text-ink-3 mb-2">{t('exp.criteria')}</h3>
            <CriteriaEditor value={e.criteria} currency={currency} onChange={(c) => patch({ success_criteria: c })} />
            <p className="text-[11px] text-ink-4 mt-1.5">{t('exp.criteria.help')}</p>
          </section>

          {/* Evaluation */}
          {ev && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-ink-2">{t(`exp.reason.${e.status === 'closed' ? (e.close_reason ?? 'manual') : ev.reason}`)} · {t('exp.daysLive', { n: ev.days_live })}</span>
                <span className="text-xs text-ink-3">{t('exp.progress', { spend: f.money(ev.spend, currency), min: f.money(e.criteria.min_spend, currency) })}</span>
              </div>
              <div className="h-1.5 rounded-full bg-inset overflow-hidden mb-3"><div className="h-full bg-accent" style={{ width: `${Math.round(ev.progress * 100)}%` }} /></div>
              <div className="flex flex-wrap gap-2 text-[11px]">
                {(['roas', 'hook', 'hold', 'cpa', 'control'] as const).map((g) => ev.gates[g] === null ? null : (
                  <span key={g} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${ev.gates[g] ? 'border-ok/40 text-ok bg-ok-soft' : 'border-danger/40 text-danger bg-danger-soft'}`}>
                    {ev.gates[g] ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}{t(`exp.gate.${g}`)}
                  </span>
                ))}
              </div>
              {ev.best && (
                <p className="text-xs text-ink-2 mt-3">
                  <span className="text-ink-3">{t('exp.result.best')}:</span> <span className="font-[family-name:var(--font-mono)]">{ev.best.ad_name}</span> · ROAS {f.ratio(ev.best.roas)} · {t('exp.gate.hook')} {f.pct(ev.best.hook_rate)} · {f.money(ev.best.spend, currency)}
                  {ev.control && <> <span className="text-ink-4">|</span> {t('exp.control')}: ROAS {f.ratio(ev.control.roas)} · {t('exp.gate.hook')} {f.pct(ev.control.hook_rate)}</>}
                </p>
              )}
            </section>
          )}

          {/* Learning */}
          {e.status === 'closed' && <LearningBlock learningId={e.learning_id} />}

          {/* Variants */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs uppercase tracking-wide text-ink-3">{t('exp.variants')}</h3>
              <div className="flex items-center gap-1.5">
                <button className={btn} onClick={() => setShowClaim((v) => !v)}><Link2 className="w-3.5 h-3.5" />{t('exp.claim')}</button>
                <button className={btn} onClick={() => setShowAdd((v) => !v)}><Plus className="w-3.5 h-3.5" />{t('exp.variants.add')}</button>
              </div>
            </div>
            {showAdd && <AddVariant experimentId={e.id} members={makers.length ? makers : members} onDone={() => { setShowAdd(false); onReload(); }} onError={onError} />}
            {showClaim && <ClaimPanel brandId={brandId} experimentId={e.id} ads={ads} concepts={concepts} f={f} currency={currency} takenIds={new Set(e.variants.map((v) => v.meta_ad_id).filter(Boolean) as string[])} onDone={() => { setShowClaim(false); onReload(); }} onError={onError} />}
            {!e.variants.length ? (
              <p className="text-xs text-ink-3 rounded-md border border-dashed border-line px-4 py-5 text-center">{t('exp.variants.empty')}</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {e.variants.map((v) => {
                  const m = vm(v);
                  return (
                    <li key={v.id} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-ink-2 w-5">{v.variant}</span>
                        <code className="text-xs font-[family-name:var(--font-mono)] text-ink truncate">{v.ad_name}</code>
                        <button onClick={() => copy(v.ad_name)} className="text-ink-3 hover:text-ink" title={t('exp.variants.copyName')}>{copied === v.ad_name ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}</button>
                        <span className="ml-auto text-[11px] text-ink-3">{members.find((m) => m.id === v.owner_id)?.name ?? t('exp.variants.noOwner')}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded border border-line text-ink-3">{t(`exp.variants.status.${v.status}`)}</span>
                        {!v.meta_ad_id && <button onClick={() => removeVariant(v)} className="text-ink-4 hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                      {(v.hook || v.format) && <p className="text-xs text-ink-2 mt-1 pl-7">{[v.format, v.hook].filter(Boolean).join(' · ')}</p>}
                      <div className="pl-7 mt-1.5 max-w-[240px]">
                        <Select value={v.owner_id} options={makers} placeholder={t('exp.variants.assign')} onChange={(id) => setVariantOwner(v, id)} />
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 pl-7 text-[11px] text-ink-3">
                        {v.meta_ad_id ? (
                          <><CheckCircle2 className="w-3 h-3 text-ok" />{t('exp.variants.pinned', { id: v.meta_ad_id })}{m && <span className="text-ink-2">· {f.money(m.spend, currency)} · ROAS {f.ratio(m.roas)} · {t('exp.gate.hook')} {f.pct(m.hook_rate)}</span>}</>
                        ) : (
                          <><CircleDashed className="w-3 h-3" />{t('exp.variants.waiting')}
                            {['planned', 'producing', 'ready'].includes(v.status) && (
                              <span className="ml-auto inline-flex gap-1">
                                {v.status === 'planned' && <button className="hover:text-ink" onClick={() => setVariantStatus(v, 'producing')}>→ {t('exp.variants.status.producing')}</button>}
                                {v.status === 'producing' && <button className="hover:text-ink" onClick={() => setVariantStatus(v, 'ready')}>→ {t('exp.variants.status.ready')}</button>}
                                {v.status === 'ready' && <button className="hover:text-ink" onClick={() => setVariantStatus(v, 'uploaded')}>→ {t('exp.variants.status.uploaded')}</button>}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Brief */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs uppercase tracking-wide text-ink-3">{t('exp.brief')}</h3>
              <button className={btnPrimary} disabled={busy === 'brief'} onClick={writeBrief}>
                {busy === 'brief' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {busy === 'brief' ? t('exp.brief.writing') : brief ? t('exp.brief.regenerate') : t('exp.brief.generate')}
              </button>
            </div>
            {brief ? <BriefView brief={brief} f={f} /> : <p className="text-xs text-ink-3 rounded-md border border-dashed border-line px-4 py-5 text-center">{t('exp.brief.empty')}</p>}
          </section>

          <p className="text-[11px] text-ink-4">
            {nameOf(personas, e.persona_id)?.name ?? '—'} <ChevronRight className="inline w-3 h-3" /> {nameOf(angles, e.angle_id)?.name ?? '—'} <ChevronRight className="inline w-3 h-3" /> {nameOf(concepts, e.concept_id)?.name ?? '—'}
          </p>
        </div>
      </div>
    </div>
  );
}

function LearningBlock({ learningId }: { learningId: string | null }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!learningId) return;
    fetch(`/api/learnings?id=${learningId}`).then((r) => r.json()).then((d) => {
      const l = (d.learnings ?? []).find((x: { id: string }) => x.id === learningId) ?? d.learning ?? null;
      setText(l?.text ?? null);
    }).catch(() => setText(null));
  }, [learningId]);
  return (
    <section className="rounded-lg border border-ok/40 bg-ok-soft p-4">
      <h3 className="text-xs uppercase tracking-wide text-ok mb-1">{t('exp.learning')}</h3>
      <p className="text-sm text-ink">{learningId ? (text ?? '…') : t('exp.learning.none')}</p>
    </section>
  );
}

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div><h4 className="text-[11px] uppercase tracking-wide text-ink-3 mb-1">{title}</h4><div className="text-sm text-ink-2 leading-relaxed">{children}</div></div>
);
const List = ({ items }: { items: string[] }) => <ul className="list-disc pl-4 space-y-0.5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

function BriefView({ brief, f }: { brief: Brief; f: Fmt }) {
  const t = useT();
  return (
    <div className="rounded-lg border border-line bg-surface p-4 space-y-4">
      <Block title={t('exp.brief.objective')}>{brief.objective}</Block>
      <Block title={t('exp.field.hypothesis')}>{brief.hypothesis}</Block>
      <div className="grid sm:grid-cols-2 gap-4">
        <Block title={t('exp.brief.whatChanges')}>{brief.what_changes}</Block>
        <Block title={t('exp.brief.whatStays')}><List items={brief.what_stays} /></Block>
      </div>
      <Block title={t('exp.brief.audience')}>{brief.audience}</Block>
      {brief.control_summary && <Block title={t('exp.brief.control')}>{brief.control_summary}</Block>}
      {brief.evidence.length > 0 && <Block title={t('exp.brief.evidence')}><List items={brief.evidence} /></Block>}
      <Block title={t('exp.brief.variants')}>
        <div className="space-y-3">
          {brief.variants.map((v) => (
            <div key={v.variant} className="rounded-md border border-line p-3">
              <div className="flex items-center gap-2 mb-1"><span className="text-[11px] font-semibold text-ink-2">{v.variant}</span><span className="text-sm font-medium text-ink">{v.title}</span>{v.duration_seconds != null && <span className="ml-auto text-[11px] text-ink-3">{v.duration_seconds}s</span>}</div>
              <p className="text-sm text-ink mb-1.5"><span className="text-ink-3">Hook:</span> {v.hook}</p>
              <ol className="list-decimal pl-4 space-y-0.5 text-xs text-ink-2">{v.script_outline.map((s, i) => <li key={i}>{s}</li>)}</ol>
              <p className="text-xs text-ink-3 mt-1.5">{v.visual_notes}</p>
            </div>
          ))}
        </div>
      </Block>
      {brief.production_notes.length > 0 && <Block title={t('exp.brief.production')}><List items={brief.production_notes} /></Block>}
      <Block title={t('exp.brief.criteria')}>{brief.success_criteria_text}</Block>
      {brief.risks.length > 0 && <Block title={t('exp.brief.risks')}><List items={brief.risks} /></Block>}
      <p className="text-[11px] text-ink-4">{t('exp.brief.generatedAt', { date: f.date(brief.generated_at), model: brief.model })}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
function Field({ label: l, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><span className={label}>{l}</span>{children}</div>;
}

/** One editable field of the hypothesis draft. Saves on blur, like the rest. */
function DocField({ label: l, value, rows, onSave }: { label: string; value: string; rows: number; onSave: (v: string) => void }) {
  return (
    <div>
      <span className={label}>{l}</span>
      <textarea key={value} defaultValue={value ?? ''} rows={rows} className={`${input} resize-y`}
        onBlur={(e) => e.target.value !== (value ?? '') && onSave(e.target.value)} />
    </div>
  );
}

/** A list field of the draft: one line per item, blank lines dropped. */
function DocList({ label: l, items, onSave }: { label: string; items: string[]; onSave: (v: string[]) => void }) {
  const text = (items ?? []).join('\n');
  return (
    <div>
      <span className={label}>{l}</span>
      <textarea key={text} defaultValue={text} rows={Math.max(2, Math.min(8, (items ?? []).length + 1))} className={`${input} resize-y font-[family-name:var(--font-mono)] text-xs`}
        onBlur={(e) => { const next = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); if (JSON.stringify(next) !== JSON.stringify(items ?? [])) onSave(next); }} />
    </div>
  );
}

function Select({ value, options, onChange, placeholder }: { value: string | null; options: Array<{ id: string; name: string; code?: string | null }>; onChange: (v: string | null) => void; placeholder?: string }) {
  const t = useT();
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={input}>
      <option value="">{placeholder ?? t('common.none')}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.code ? `${o.code} · ` : ''}{o.name}</option>)}
    </select>
  );
}

function AdSearch({ ads, value, valueName, onChange, f, currency, exclude }: { ads: AdPick[]; value: string | null; valueName?: string | null; onChange: (id: string | null) => void; f: Fmt; currency: string | null; exclude?: Set<string> }) {
  const t = useT();
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return ads.filter((a) => !exclude?.has(a.ad_id) && (a.ad_name.toLowerCase().includes(s) || a.ad_id.includes(s))).slice(0, 8);
  }, [q, ads, exclude]);
  const current = value ? ads.find((a) => a.ad_id === value) : null;
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs">
        <code className="font-[family-name:var(--font-mono)] text-ink truncate">{current?.ad_name ?? valueName ?? value}</code>
        {current && <span className="text-ink-3 whitespace-nowrap">{f.money(current.spend, currency)} · ROAS {f.ratio(current.roas)}</span>}
        <button onClick={() => onChange(null)} className="ml-auto text-ink-3 hover:text-ink"><X className="w-3.5 h-3.5" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('exp.field.control.search')} className={input} />
      {!q && <p className="text-[11px] text-ink-4 mt-1">{t('exp.field.control.none')}</p>}
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-md border border-line bg-surface shadow-lg max-h-64 overflow-y-auto">
          {hits.map((a) => (
            <li key={a.ad_id}><button onClick={() => { onChange(a.ad_id); setQ(''); }} className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-surface-2 flex items-center gap-2">
              <code className="font-[family-name:var(--font-mono)] text-ink truncate">{a.ad_name}</code>
              <span className="ml-auto text-ink-3 whitespace-nowrap">{f.money(a.spend, currency)} · {f.ratio(a.roas)} · {f.pct(a.hook_rate)}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CriteriaEditor({ value, currency, onChange }: { value: SuccessCriteria; currency: string | null; onChange: (c: SuccessCriteria) => void }) {
  const t = useT();
  const [c, setC] = useState<SuccessCriteria>(value);
  useEffect(() => setC(value), [value]);
  const commit = () => { if (JSON.stringify(c) !== JSON.stringify(value)) onChange(c); };
  const fields: Array<{ k: keyof SuccessCriteria; label: string; pctField?: boolean }> = [
    { k: 'min_spend', label: t('exp.criteria.minSpend') },
    { k: 'roas_min', label: t('exp.criteria.roasMin') },
    { k: 'hook_rate_min', label: t('exp.criteria.hookMin') },
    { k: 'hold_rate_min', label: t('exp.criteria.holdMin') },
    { k: 'cpa_max', label: t('exp.criteria.cpaMax') },
    { k: 'beat_control_by', label: t('exp.criteria.beatControl'), pctField: true },
    { k: 'window_days', label: t('exp.criteria.window') },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {fields.map(({ k, label: l, pctField }) => (
        <div key={k}>
          <span className={label}>{l}{k === 'min_spend' || k === 'cpa_max' ? ` (${currency ?? '¤'})` : ''}</span>
          <input type="number" step="any" value={c[k] == null ? '' : pctField ? Math.round((c[k] as number) * 100) : (c[k] as number)}
            onChange={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); setC({ ...c, [k]: v == null ? null : pctField ? v / 100 : v }); }}
            onBlur={commit} className={input} />
        </div>
      ))}
    </div>
  );
}

function AddVariant({ experimentId, members, onDone, onError }: { experimentId: string; members: Member[]; onDone: () => void; onError: (m: string) => void }) {
  const t = useT();
  const [hook, setHook] = useState(''); const [format, setFormat] = useState(''); const [notes, setNotes] = useState(''); const [owner, setOwner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api('/api/experiments/variants', { method: 'POST', body: JSON.stringify({ experimentId, hook, format, visual_notes: notes, owner_id: owner }) }); onDone(); }
    catch (x) { onError(x instanceof Error ? x.message : t('exp.error.generic')); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg border border-line bg-surface p-3 mb-3 grid sm:grid-cols-2 gap-2">
      <Field label={t('exp.variants.format')}><input value={format} onChange={(e) => setFormat(e.target.value)} className={input} /></Field>
      <Field label={t('exp.field.owner')}><Select value={owner} options={members} onChange={setOwner} /></Field>
      <Field label={t('exp.variants.hook')} className="sm:col-span-2"><input value={hook} onChange={(e) => setHook(e.target.value)} className={input} /></Field>
      <Field label={t('exp.variants.notes')} className="sm:col-span-2"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={input} /></Field>
      <div className="sm:col-span-2 flex justify-end"><button onClick={submit} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}{t('exp.variants.add')}</button></div>
    </div>
  );
}

function ClaimPanel({ brandId, experimentId, ads, concepts, f, currency, takenIds, onDone, onError }: { brandId: string; experimentId: string; ads: AdPick[]; concepts: Named[]; f: Fmt; currency: string | null; takenIds: Set<string>; onDone: () => void; onError: (m: string) => void }) {
  const t = useT();
  const [adId, setAdId] = useState<string | null>(null);
  const [mode, setMode] = useState<'variant' | 'control'>('variant');
  const [conceptId, setConceptId] = useState<string | null>(null);
  const [newConcept, setNewConcept] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!adId) return;
    setBusy(true);
    try {
      await api('/api/experiments/claim', { method: 'POST', body: JSON.stringify({ brandId, ad_id: adId, experimentId, asControl: mode === 'control', conceptId, newConcept: newConcept.trim() ? { name: newConcept.trim() } : null }) });
      onDone();
    } catch (x) { onError(x instanceof Error ? x.message : t('exp.error.generic')); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg border border-line bg-surface p-3 mb-3 space-y-2">
      <p className="text-[11px] text-ink-3">{t('exp.claim.help')}</p>
      <AdSearch ads={ads} value={adId} onChange={setAdId} f={f} currency={currency} exclude={takenIds} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-md border border-line overflow-hidden">
          {(['variant', 'control'] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={`px-2.5 py-1 text-xs ${mode === m ? 'bg-surface-2 text-ink font-medium' : 'text-ink-2'}`}>{t(m === 'variant' ? 'exp.claim.asVariant' : 'exp.claim.asControl')}</button>)}
        </span>
        <div className="flex-1 min-w-[200px]"><Select value={conceptId} options={concepts} onChange={setConceptId} placeholder={t('exp.claim.concept')} /></div>
        {!conceptId && <input value={newConcept} onChange={(e) => setNewConcept(e.target.value)} placeholder={t('exp.claim.newConcept')} className={`${input} flex-1 min-w-[160px]`} />}
        <button onClick={submit} disabled={busy || !adId} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}{t('exp.claim')}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / promote modal
// ---------------------------------------------------------------------------
function CreateModal({ brandId, idea, members, personas, angles, concepts, ads, products, currency, onClose, onCreated, onError }: {
  brandId: string; idea?: Idea; members: Member[]; personas: Named[]; angles: Named[]; concepts: Named[]; ads: AdPick[]; products: Product[]; currency: string | null;
  onClose: () => void; onCreated: (e: ExperimentFull) => void; onError: (m: string) => void;
}) {
  const t = useT();
  const f = useFormatters();
  const [name, setName] = useState(idea?.text ?? '');
  const [variable, setVariable] = useState<ExperimentVariable | ''>((idea?.variable as ExperimentVariable) ?? '');
  const [hypothesis, setHypothesis] = useState(idea?.rationale ?? '');
  const [personaId, setPersonaId] = useState<string | null>(idea?.persona_id ?? null);
  const [angleId, setAngleId] = useState<string | null>(idea?.angle_id ?? null);
  const [conceptId, setConceptId] = useState<string | null>(idea?.concept_id ?? null);
  const [ownerId, setOwnerId] = useState<string | null>(members.find((m) => m.role === 'strategist')?.id ?? null);
  const [controlId, setControlId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(products.length === 1 ? products[0].id : null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const submit = async () => {
    setTouched(true);
    if (!variable || !name.trim()) return;
    setBusy(true);
    try {
      const body = { brandId, name, variable, hypothesis, persona_id: personaId, angle_id: angleId, concept_id: conceptId, owner_id: ownerId, control_ad_id: controlId, product_id: productId };
      const { experiment } = idea
        ? await api<{ experiment: ExperimentFull }>('/api/ideas/promote', { method: 'POST', body: JSON.stringify({ id: idea.id, ...body }) })
        : await api<{ experiment: ExperimentFull }>('/api/experiments', { method: 'POST', body: JSON.stringify(body) });
      onCreated(experiment);
    } catch (x) { onError(x instanceof Error ? x.message : t('exp.error.generic')); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-overlay/60" />
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-xl rounded-xl border border-line bg-canvas shadow-xl">
        <div className="px-5 py-3 border-b border-line flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{idea ? t('exp.inbox.promote') : t('exp.new')}</h2>
          <button onClick={onClose} className="p-1 text-ink-3 hover:text-ink"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid sm:grid-cols-2 gap-3">
          <Field label={t('exp.field.name')} className="sm:col-span-2"><input value={name} onChange={(e) => setName(e.target.value)} className={input} autoFocus /></Field>
          <Field label={t('exp.variable')} className="sm:col-span-2">
            <div className="flex flex-wrap gap-1.5">
              {EXPERIMENT_VARIABLES.map((v) => (
                <button key={v} onClick={() => setVariable(v)} className={`px-2.5 py-1 rounded-md border text-xs ${variable === v ? 'border-accent bg-accent-soft text-accent font-medium' : 'border-line text-ink-2 hover:border-line-strong'}`}>{t(`exp.variable.${v}`)}</button>
              ))}
            </div>
            {touched && !variable && <p className="text-[11px] text-danger mt-1.5 flex items-center gap-1"><MinusCircle className="w-3 h-3" />{t('exp.variable.required')}</p>}
          </Field>
          <Field label={t('exp.field.hypothesis')} className="sm:col-span-2"><textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} rows={2} placeholder={t('exp.field.hypothesis.placeholder')} className={`${input} resize-none`} /></Field>
          <Field label={t('exp.field.persona')}><Select value={personaId} options={personas} onChange={setPersonaId} /></Field>
          <Field label={t('exp.field.angle')}><Select value={angleId} options={angles} onChange={setAngleId} /></Field>
          <Field label={t('exp.field.concept')}><Select value={conceptId} options={concepts} onChange={setConceptId} /></Field>
          <Field label={t('exp.field.owner')}><Select value={ownerId} options={members} onChange={setOwnerId} /></Field>
          <Field label={t('exp.field.product')}><Select value={productId} options={products} onChange={setProductId} placeholder={t('exp.field.product.none')} /></Field>
          <Field label={t('exp.field.control')}><AdSearch ads={ads} value={controlId} onChange={setControlId} f={f} currency={currency} /></Field>
        </div>
        <div className="px-5 py-3 border-t border-line flex items-center justify-end gap-2">
          <button onClick={onClose} className={btn}>{t('common.cancel')}</button>
          <button onClick={submit} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}{busy ? t('exp.creating') : t('exp.create')}</button>
        </div>
      </div>
    </div>
  );
}
