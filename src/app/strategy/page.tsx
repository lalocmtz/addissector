'use client';

// =============================================================================
// /strategy — the spine of the account: Persona → Angle → Concept.
//
// Nothing here is an opinion. Every status is derived from the money that ran
// against the entity (see src/lib/strategy.ts); the tree only renders it.
// Three views share one payload from /api/strategy:
//   tree        the hierarchy, with rollups and derived status
//   inbox       what the classifier proposed, waiting for a person to rule
//   unassigned  the ads no entity claims, biggest spender first
// Replaces /plan.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, ChevronRight, Plus, Check, X, Pencil, Merge, Inbox, Network, Unlink, AlertCircle,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { useT } from '@/lib/i18n';
import { fmtMoney, type Economics } from '@/lib/meta';
import type { Rollup, DerivedStatus } from '@/lib/strategy';

type ReviewStatus = 'proposed' | 'accepted' | 'rejected' | 'merged';
type Kind = 'persona' | 'angle' | 'concept' | 'hook';

interface Judged {
  id: string;
  review_status: ReviewStatus;
  merged_into: string | null;
  rollup: Rollup;
  recent: Rollup;
  derived: DerivedStatus;
  ad_ids: string[];
}
interface Persona extends Judged { name: string; description: string | null; source: string | null; angles: number }
interface Angle extends Judged { code: string | null; name: string; persona_id: string | null; pain: string | null; desire: string | null; mechanism: string | null; priority: number | null; source: string | null; concepts: number }
interface Concept extends Judged { code: string | null; number: number | null; name: string; angle_id: string | null; persona_id: string | null; narrative_format: string | null; hypothesis: string | null; origin: string | null }
interface Hook { id: string; title: string | null; body: string | null; hook_type: string | null; review_status: ReviewStatus; rollup: Rollup }
interface UnassignedAd { ad_id: string; ad_name: string; spend: number; roas: number | null; hook_rate: number | null }

interface Payload {
  economics: Economics;
  currency: string | null;
  memoryTo: string;
  personas: Persona[];
  angles: Angle[];
  concepts: Concept[];
  hooks: Hook[];
  unassigned: { count: number; spend: number; top: UnassignedAd[] };
  proposals: { personas: number; angles: number; concepts: number; hooks: number };
  ads: { total: number; assigned: number };
}

const STATUS_TONE: Record<DerivedStatus, string> = {
  untested: 'bg-inset text-ink-4',
  testing: 'bg-accent-soft text-accent',
  validated: 'bg-ok-soft text-ok',
  viable: 'bg-accent-soft text-accent',
  refuted: 'bg-danger-soft text-danger',
  fatiguing: 'bg-warn-soft text-warn',
};

const input = 'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent';
const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium';
const btn = 'inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:text-ink hover:border-line-strong disabled:opacity-50';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-strong disabled:opacity-50';
const mono = 'font-[family-name:var(--font-mono)]';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
  return data as T;
}

const live = <T extends { review_status: ReviewStatus }>(rows: T[]) => rows.filter((r) => r.review_status === 'accepted' || r.review_status === 'proposed');

export default function StrategyPage() {
  const t = useT();
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'tree' | 'inbox' | 'unassigned'>('tree');

  const load = useCallback(async () => {
    if (!activeBrandId) return;
    setLoading(true); setError(null);
    try { setData(await api<Payload>(`/api/strategy?brand=${activeBrandId}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setLoading(false); }
  }, [activeBrandId]);
  useEffect(() => { load(); }, [load]);

  const money = useCallback((n: number) => fmtMoney(n, data?.currency ?? null), [data?.currency]);
  const pending = data ? data.proposals.personas + data.proposals.angles + data.proposals.concepts + data.proposals.hooks : 0;

  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />
      <section className="px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
            <div>
              <h1 className={`text-2xl font-bold ${mono} tracking-tight`}>{t('strategy.title')}{activeBrand ? ` · ${activeBrand.name}` : ''}</h1>
              <p className="text-sm text-ink-4 mt-1">{t('strategy.subtitle')}</p>
            </div>
            {data && (
              <div className={`text-xs text-ink-4 ${mono} text-right`}>
                <div>{t('strategy.coverage', { assigned: data.ads.assigned, total: data.ads.total })}</div>
                <div>{t('strategy.memoryTo', { date: data.memoryTo })}</div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mb-6">
            {([['tree', Network, t('strategy.view.tree')], ['inbox', Inbox, `${t('strategy.view.inbox')}${pending ? ` (${pending})` : ''}`], ['unassigned', Unlink, `${t('strategy.view.unassigned')}${data?.unassigned.count ? ` (${data.unassigned.count})` : ''}`]] as const).map(([id, Icon, label]) => (
              <button key={id} onClick={() => setView(id)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border ${view === id ? 'border-accent text-accent bg-accent-soft' : 'border-line text-ink-3 hover:text-ink'}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>

          {error && <p className="text-xs text-danger mb-4 inline-flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{error}</p>}

          {loading ? (
            <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 text-accent animate-spin" /></div>
          ) : !data ? (
            <p className="text-sm text-ink-4">{t('strategy.noBrand')}</p>
          ) : view === 'tree' ? (
            <Tree data={data} money={money} brandId={activeBrandId!} onChange={load} />
          ) : view === 'inbox' ? (
            <InboxView data={data} money={money} onChange={load} />
          ) : (
            <UnassignedView data={data} money={money} brandId={activeBrandId!} onChange={load} />
          )}
        </div>
      </section>
    </main>
  );
}

// --- shared bits -------------------------------------------------------------

function StatusChip({ status }: { status: DerivedStatus }) {
  const t = useT();
  return <span className={`${chip} ${STATUS_TONE[status]}`}>{t(`status.${status}`)}</span>;
}

function Numbers({ r, money }: { r: Rollup; money: (n: number) => string }) {
  const t = useT();
  if (!r.ads) return <span className="text-[11px] text-ink-4">{t('strategy.noAds')}</span>;
  return (
    <span className={`text-[11px] text-ink-3 ${mono} whitespace-nowrap`}>
      {t('strategy.adsN', { n: r.ads })} · {money(r.spend)}
      {r.roas != null && <> · ROAS {r.roas.toFixed(2)}</>}
      {r.hook_rate != null && <> · hook {r.hook_rate.toFixed(0)}%</>}
    </span>
  );
}

// --- tree --------------------------------------------------------------------

function Tree({ data, money, brandId, onChange }: { data: Payload; money: (n: number) => string; brandId: string; onChange: () => void }) {
  const t = useT();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const personas = live(data.personas);
  const anglesOf = (personaId: string) => live(data.angles).filter((a) => a.persona_id === personaId);
  const conceptsOf = (angleId: string) => live(data.concepts).filter((c) => c.angle_id === angleId);
  const orphanAngles = live(data.angles).filter((a) => !a.persona_id);
  const orphanConcepts = live(data.concepts).filter((c) => !c.angle_id);

  const create = async (kind: Kind, parent: { persona_id?: string; angle_id?: string }) => {
    if (!name.trim()) return;
    setBusy(true);
    const url = kind === 'persona' ? '/api/plan/personas' : kind === 'angle' ? '/api/plan/angles' : '/api/plan/concepts';
    try {
      await api(url, { method: 'POST', body: JSON.stringify({ brandId, name: name.trim(), ...parent }) });
      setName(''); setAdding(null); onChange();
    } finally { setBusy(false); }
  };

  const AddRow = ({ id, kind, parent }: { id: string; kind: Kind; parent: { persona_id?: string; angle_id?: string } }) =>
    adding === id ? (
      <div className="flex items-center gap-2 py-2">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(kind, parent); if (e.key === 'Escape') setAdding(null); }} placeholder={t(`strategy.new.${kind}`)} className={`${input} max-w-sm`} />
        <button onClick={() => create(kind, parent)} disabled={busy || !name.trim()} className={btnPrimary}>{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}{t('common.save')}</button>
        <button onClick={() => setAdding(null)} className={btn}>{t('common.cancel')}</button>
      </div>
    ) : (
      <button onClick={() => { setAdding(id); setName(''); }} className="inline-flex items-center gap-1 text-[11px] text-ink-4 hover:text-accent py-1.5"><Plus className="w-3 h-3" />{t(`strategy.new.${kind}`)}</button>
    );

  return (
    <div className="space-y-3">
      {personas.map((p) => (
        <div key={p.id} className="rounded-xl border border-line bg-surface overflow-hidden">
          <button onClick={() => toggle(p.id)} className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-inset/40">
            <ChevronRight className={`w-4 h-4 text-ink-4 transition-transform ${open[p.id] ? 'rotate-90' : ''}`} />
            <span className="text-sm font-semibold text-ink">{p.name}</span>
            {p.review_status === 'proposed' && <span className={`${chip} bg-warn-soft text-warn`}>{t('review.proposed')}</span>}
            <StatusChip status={p.derived} />
            <span className="ml-auto flex items-center gap-3">
              <span className="text-[11px] text-ink-4">{t('strategy.anglesN', { n: p.angles })}</span>
              <Numbers r={p.rollup} money={money} />
            </span>
          </button>
          {open[p.id] && (
            <div className="border-t border-line px-4 pb-3 pl-10">
              {p.description && <p className="text-xs text-ink-3 py-2">{p.description}</p>}
              {anglesOf(p.id).map((a) => (
                <div key={a.id} className="border-b border-line last:border-0">
                  <button onClick={() => toggle(a.id)} className="w-full flex flex-wrap items-center gap-3 py-2.5 text-left">
                    <ChevronRight className={`w-3.5 h-3.5 text-ink-4 transition-transform ${open[a.id] ? 'rotate-90' : ''}`} />
                    {a.code && <span className={`text-[11px] text-ink-4 ${mono}`}>{a.code}</span>}
                    <span className="text-sm text-ink">{a.name}</span>
                    {a.review_status === 'proposed' && <span className={`${chip} bg-warn-soft text-warn`}>{t('review.proposed')}</span>}
                    <StatusChip status={a.derived} />
                    <span className="ml-auto flex items-center gap-3">
                      <span className="text-[11px] text-ink-4">{t('strategy.conceptsN', { n: a.concepts })}</span>
                      <Numbers r={a.rollup} money={money} />
                    </span>
                  </button>
                  {open[a.id] && (
                    <div className="pl-7 pb-2">
                      {(a.pain || a.desire || a.mechanism) && (
                        <p className="text-[11px] text-ink-4 pb-2">
                          {[a.pain && `${t('strategy.pain')}: ${a.pain}`, a.desire && `${t('strategy.desire')}: ${a.desire}`, a.mechanism && `${t('strategy.mechanism')}: ${a.mechanism}`].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {conceptsOf(a.id).map((c) => (
                        <div key={c.id} className="flex flex-wrap items-center gap-3 py-1.5 border-t border-line/60">
                          {c.code && <span className={`text-[11px] text-ink-4 ${mono}`}>{c.code}</span>}
                          <span className="text-sm text-ink-2">{c.name}</span>
                          {c.narrative_format && <span className={`${chip} bg-inset text-ink-3`}>{c.narrative_format}</span>}
                          {c.review_status === 'proposed' && <span className={`${chip} bg-warn-soft text-warn`}>{t('review.proposed')}</span>}
                          <StatusChip status={c.derived} />
                          <span className="ml-auto"><Numbers r={c.rollup} money={money} /></span>
                        </div>
                      ))}
                      <AddRow id={`c-${a.id}`} kind="concept" parent={{ angle_id: a.id, persona_id: p.id }} />
                    </div>
                  )}
                </div>
              ))}
              <AddRow id={`a-${p.id}`} kind="angle" parent={{ persona_id: p.id }} />
            </div>
          )}
        </div>
      ))}

      {(orphanAngles.length > 0 || orphanConcepts.length > 0) && (
        <div className="rounded-xl border border-dashed border-line bg-surface p-4">
          <p className="text-xs font-medium text-ink-3 mb-2">{t('strategy.orphans')}</p>
          {orphanAngles.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 py-1.5 border-t border-line/60 first:border-0">
              <span className="text-sm text-ink-2">{a.name}</span><StatusChip status={a.derived} />
              <span className="ml-auto"><Numbers r={a.rollup} money={money} /></span>
            </div>
          ))}
          {orphanConcepts.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 py-1.5 border-t border-line/60">
              <span className="text-sm text-ink-2">{c.name}</span><StatusChip status={c.derived} />
              <span className="ml-auto"><Numbers r={c.rollup} money={money} /></span>
            </div>
          ))}
        </div>
      )}

      <AddRow id="p-new" kind="persona" parent={{}} />
    </div>
  );
}

// --- inbox -------------------------------------------------------------------

interface Proposal { kind: Kind; id: string; title: string; subtitle: string | null; rollup: Rollup | null }

function InboxView({ data, money, onChange }: { data: Payload; money: (n: number) => string; onChange: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [merging, setMerging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo<Proposal[]>(() => [
    ...data.personas.filter((p) => p.review_status === 'proposed').map((p) => ({ kind: 'persona' as Kind, id: p.id, title: p.name, subtitle: p.description, rollup: p.rollup })),
    ...data.angles.filter((a) => a.review_status === 'proposed').map((a) => ({ kind: 'angle' as Kind, id: a.id, title: a.name, subtitle: [a.pain, a.desire].filter(Boolean).join(' · ') || null, rollup: a.rollup })),
    ...data.concepts.filter((c) => c.review_status === 'proposed').map((c) => ({ kind: 'concept' as Kind, id: c.id, title: c.name, subtitle: c.hypothesis, rollup: c.rollup })),
    ...data.hooks.filter((h) => h.review_status === 'proposed').map((h) => ({ kind: 'hook' as Kind, id: h.id, title: h.title ?? h.body ?? '—', subtitle: h.hook_type, rollup: h.rollup })),
  ].sort((a, b) => (b.rollup?.spend ?? 0) - (a.rollup?.spend ?? 0)), [data]);

  const targets = (kind: Kind): { id: string; label: string }[] =>
    kind === 'persona' ? data.personas.filter((p) => p.review_status === 'accepted').map((p) => ({ id: p.id, label: p.name }))
      : kind === 'angle' ? data.angles.filter((a) => a.review_status === 'accepted').map((a) => ({ id: a.id, label: a.code ? `${a.code} ${a.name}` : a.name }))
        : kind === 'concept' ? data.concepts.filter((c) => c.review_status === 'accepted').map((c) => ({ id: c.id, label: c.code ? `${c.code} ${c.name}` : c.name }))
          : data.hooks.filter((h) => h.review_status === 'accepted').map((h) => ({ id: h.id, label: h.title ?? h.body ?? h.id }));

  const rule = async (p: Proposal, action: string, extra?: Record<string, unknown>) => {
    setBusy(p.id); setError(null);
    try {
      await api('/api/strategy/review', { method: 'POST', body: JSON.stringify({ type: p.kind, id: p.id, action, ...extra }) });
      setEditing(null); setMerging(null); onChange();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  };

  if (!items.length) return <p className="text-sm text-ink-4 rounded-xl border border-dashed border-line bg-surface p-8 text-center">{t('review.empty')}</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-4 mb-3">{t('review.help')}</p>
      {error && <p className="text-xs text-danger">{error}</p>}
      {items.map((p) => (
        <div key={`${p.kind}-${p.id}`} className="rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`${chip} bg-inset text-ink-3`}>{t(`review.kind.${p.kind}`)}</span>
            {editing === p.id ? (
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className={`${input} max-w-md`} />
            ) : (
              <span className="text-sm font-medium text-ink">{p.title}</span>
            )}
            {p.rollup && <span className="ml-auto"><Numbers r={p.rollup} money={money} /></span>}
          </div>
          {p.subtitle && editing !== p.id && <p className="text-xs text-ink-3 mt-1.5">{p.subtitle}</p>}

          {merging === p.id ? (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <select defaultValue="" onChange={(e) => e.target.value && rule(p, 'merge', { targetId: e.target.value })} className={`${input} max-w-xs`}>
                <option value="">{t('review.mergeInto')}</option>
                {targets(p.kind).filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              <button onClick={() => setMerging(null)} className={btn}>{t('common.cancel')}</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 mt-3">
              {editing === p.id ? (
                <>
                  <button onClick={() => rule(p, 'edit', { patch: p.kind === 'hook' ? { title: draft } : { name: draft } })} disabled={busy === p.id || !draft.trim()} className={btnPrimary}>
                    {busy === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}{t('review.saveAccept')}
                  </button>
                  <button onClick={() => setEditing(null)} className={btn}>{t('common.cancel')}</button>
                </>
              ) : (
                <>
                  <button onClick={() => rule(p, 'accept')} disabled={busy === p.id} className={btnPrimary}><Check className="w-3 h-3" />{t('review.accept')}</button>
                  <button onClick={() => { setEditing(p.id); setDraft(p.title); }} className={btn}><Pencil className="w-3 h-3" />{t('review.edit')}</button>
                  <button onClick={() => setMerging(p.id)} className={btn}><Merge className="w-3 h-3" />{t('review.merge')}</button>
                  <button onClick={() => rule(p, 'reject')} disabled={busy === p.id} className={`${btn} hover:text-danger`}><X className="w-3 h-3" />{t('review.reject')}</button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- unassigned --------------------------------------------------------------

function UnassignedView({ data, money, brandId, onChange }: { data: Payload; money: (n: number) => string; brandId: string; onChange: () => void }) {
  const t = useT();
  const [sel, setSel] = useState<Record<string, { persona_id?: string; angle_id?: string; concept_id?: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const personas = data.personas.filter((p) => p.review_status === 'accepted');
  const angles = data.angles.filter((a) => a.review_status === 'accepted');
  const concepts = data.concepts.filter((c) => c.review_status === 'accepted');

  const assign = async (adId: string) => {
    const picked = sel[adId];
    if (!picked || (!picked.persona_id && !picked.angle_id && !picked.concept_id)) return;
    setBusy(adId); setError(null);
    try {
      await api('/api/strategy/review', { method: 'POST', body: JSON.stringify({ assign: { brandId, ad_id: adId, ...picked } }) });
      onChange();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  };

  if (!data.unassigned.count) return <p className="text-sm text-ink-4 rounded-xl border border-dashed border-line bg-surface p-8 text-center">{t('strategy.unassigned.empty')}</p>;

  return (
    <div>
      <p className="text-xs text-ink-4 mb-3">{t('strategy.unassigned.help', { n: data.unassigned.count, spend: money(data.unassigned.spend) })}</p>
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <div className="rounded-xl border border-line bg-surface divide-y divide-line">
        {data.unassigned.top.map((ad) => (
          <div key={ad.ad_id} className="p-3 flex flex-wrap items-center gap-2">
            <div className="min-w-[220px] flex-1">
              <p className="text-sm text-ink truncate" title={ad.ad_name}>{ad.ad_name}</p>
              <p className={`text-[11px] text-ink-4 ${mono}`}>
                {money(ad.spend)}
                {ad.roas != null && <> · ROAS {ad.roas.toFixed(2)}</>}
                {ad.hook_rate != null && <> · hook {ad.hook_rate.toFixed(0)}%</>}
              </p>
            </div>
            <select value={sel[ad.ad_id]?.persona_id ?? ''} onChange={(e) => setSel((s) => ({ ...s, [ad.ad_id]: { ...s[ad.ad_id], persona_id: e.target.value || undefined } }))} className={`${input} max-w-[160px]`}>
              <option value="">{t('strategy.pickPersona')}</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={sel[ad.ad_id]?.angle_id ?? ''} onChange={(e) => setSel((s) => ({ ...s, [ad.ad_id]: { ...s[ad.ad_id], angle_id: e.target.value || undefined } }))} className={`${input} max-w-[160px]`}>
              <option value="">{t('strategy.pickAngle')}</option>
              {angles.map((a) => <option key={a.id} value={a.id}>{a.code ? `${a.code} ${a.name}` : a.name}</option>)}
            </select>
            <select value={sel[ad.ad_id]?.concept_id ?? ''} onChange={(e) => setSel((s) => ({ ...s, [ad.ad_id]: { ...s[ad.ad_id], concept_id: e.target.value || undefined } }))} className={`${input} max-w-[160px]`}>
              <option value="">{t('strategy.pickConcept')}</option>
              {concepts.map((c) => <option key={c.id} value={c.id}>{c.code ? `${c.code} ${c.name}` : c.name}</option>)}
            </select>
            <button onClick={() => assign(ad.ad_id)} disabled={busy === ad.ad_id} className={btnPrimary}>
              {busy === ad.ad_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}{t('strategy.assign')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
