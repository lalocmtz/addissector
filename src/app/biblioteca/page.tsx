'use client';

// =============================================================================
// Biblioteca — what ran on Meta in a reporting window and what it returned.
// Reads GET /api/library?brand=&window=. Two tabs: Creativos (the cards, with
// filters and a detail modal) and Desglose (cost per purchase by tag, compared
// against the account baseline). Everything after the fetch is computed here.
// Numbers are Meta's; the AI analysis lives elsewhere and is only linked.
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Loader2, Film, Image as ImageIcon, Library, Search, X, LayoutGrid, List, Check, Copy, RefreshCw, Play } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { useT, useFormatters } from '@/lib/i18n';
import { DEFAULT_ECONOMICS, type Economics, type VerdictId } from '@/lib/meta';

// ---------------------------------------------------------------------------
// Types (mirror of the API response)
// ---------------------------------------------------------------------------

type AdStatus = 'active' | 'paused' | 'adset_paused' | 'campaign_paused' | 'with_issues' | 'disapproved' | 'unknown';
type Kind = 'video' | 'image';

interface LibraryAd {
  ad_id: string;
  ad_name: string;
  campaign_name: string | null;
  adset_name: string | null;
  status: AdStatus;
  delivered: boolean;
  spend: number;
  revenue: number;
  purchases: number;
  roas: number | null;
  cpa: number | null;
  impressions: number | null;
  link_clicks: number | null;
  ctr: number | null;
  cpm: number | null;
  freq: number | null;
  hook_rate: number | null;
  hold_rate: number | null;
  cvr: number | null;
  daily: { date: string; spend: number; purchases: number }[];
  verdict: VerdictId;
  kind: Kind;
  asset_type: string | null;
  asset_url: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  creative_id: string | null;
  creative_type: string | null;
  analyzed: boolean;
  persona: string | null;
  angle: string | null;
  angle_code: string | null;
  angle_id: string | null;
  concept: string | null;
  dimensions: Record<string, string>;
}

interface Totals {
  spend: number; impressions: number; purchases: number; revenue: number; link_clicks: number;
  roas: number | null; cpa: number | null; cpm: number | null; ctr: number | null;
}

interface LibraryResponse {
  window?: { id: string; from: string; to: string };
  ads?: LibraryAd[];
  totals?: Totals;
  currency?: string | null;
  economics?: Partial<Economics> | null;
  error?: string;
}

type WindowId = 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'this_month' | 'last_month';
type Delivery = 'all' | 'delivered' | 'active';
type SortKey = 'spend' | 'cpa' | 'roas' | 'ctr' | 'hook_rate';
type Tab = 'creatives' | 'breakdown';
type T = ReturnType<typeof useT>;
type F = ReturnType<typeof useFormatters>;

const WINDOWS: WindowId[] = ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'];
const SORTS: SortKey[] = ['spend', 'cpa', 'roas', 'ctr', 'hook_rate'];
const VERDICTS: VerdictId[] = ['ganador', 'prometedor', 'dejar', 'apagar', 'sin_datos'];
const VERDICT_KEY: Record<VerdictId, string> = {
  ganador: 'verdict.winner', prometedor: 'verdict.promising', dejar: 'verdict.cut', apagar: 'verdict.kill', sin_datos: 'verdict.noData',
};
const VERDICT_CLASS: Record<VerdictId, string> = {
  ganador: 'bg-ok-soft text-ok', prometedor: 'bg-accent-soft text-accent', dejar: 'bg-warn-soft text-warn', apagar: 'bg-danger-soft text-danger', sin_datos: 'bg-inset text-ink-4',
};
/** Tags shown in the modal, in reading order (after Tipo / Formato / Ángulo / Persona / Concepto). */
const TAG_ORDER = ['awareness_level', 'proof_type', 'offer', 'cta', 'hook', 'emotional_driver', 'narrative_structure', 'visual_style', 'creator', 'pacing', 'duration_bucket'];
/** Dimension chips on a card, after the angle code (max 4 in total). */
const CARD_DIMS = ['awareness_level', 'proof_type', 'offer'];

const mono = 'font-[family-name:var(--font-mono)] tabular-nums';
const label = 'text-[10px] uppercase tracking-wide text-ink-4';
const select = 'rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-accent max-w-full';
const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide';
const overlayPill = `${pill} bg-surface/90 text-ink shadow-sm`;
const chip = 'inline-flex items-center rounded-md border border-line bg-inset px-1.5 py-0.5 text-[10px] text-ink-2 truncate max-w-[140px]';
const btn = 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-line text-ink-2 hover:text-ink hover:border-line-strong';

// ---------------------------------------------------------------------------
// localStorage-backed preferences (window, view) via useSyncExternalStore so
// the server render and the first client render agree.
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
function readPref(key: string, fallback: string): string {
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, v: string) {
  try { window.localStorage.setItem(key, v); } catch { /* private mode: still works for the session */ }
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => { listeners.delete(cb); window.removeEventListener('storage', cb); };
}
function usePref<V extends string>(key: string, fallback: V, valid: readonly V[]): [V, (v: V) => void] {
  const raw = useSyncExternalStore(subscribe, () => readPref(key, fallback), () => fallback);
  const v = (valid as readonly string[]).includes(raw) ? (raw as V) : fallback;
  return [v, (next: V) => writePref(key, next)];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roasClass(roas: number | null, eco: Economics): string {
  if (roas == null) return 'text-ink-4';
  if (roas >= eco.target) return 'text-ok';
  if (roas >= eco.breakeven) return 'text-warn';
  return 'text-danger';
}
function statusClass(s: AdStatus): string {
  return s === 'active' ? 'bg-ok-soft text-ok' : s === 'with_issues' || s === 'disapproved' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-ink-3';
}
/** Translates a value-shaped key, falling back to the raw value. */
function tOr(t: T, key: string, raw: string): string {
  const s = t(key);
  return s === key ? raw : s;
}
const assetTypeLabel = (t: T, v: string) => tOr(t, `library.assetType.${v.toLowerCase()}`, v);
/** A tagged value the way a person would say it: 'problem_aware' → 'Sabe el problema', anything unknown → 'Problem aware'. */
const dimValue = (t: T, v: string) => tOr(t, `library.val.${v.toLowerCase()}`, v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));
const tagLabel = (t: T, k: string) => tOr(t, `library.tag.${k}`, k.replace(/_/g, ' '));
const money0 = (f: F, n: number | null | undefined, cur: string | null) => (n == null ? '–' : f.money(n, cur));

/** The AI analysis screen for this ad, when one exists. */
function analysisHref(ad: LibraryAd): string | null {
  if (!ad.creative_id) return null;
  return `${ad.creative_type === 'image' ? '/analyze-image' : '/analyze'}?id=${ad.creative_id}`;
}
function cardChips(ad: LibraryAd, t: T): string[] {
  const out: string[] = [];
  if (ad.angle_code) out.push(ad.angle_code);
  for (const d of CARD_DIMS) if (ad.dimensions[d]) out.push(dimValue(t, ad.dimensions[d]));
  return out.slice(0, 4);
}
function haystack(ad: LibraryAd): string {
  return [ad.ad_name, ad.campaign_name, ad.adset_name, ad.angle, ad.persona, ad.concept, ad.asset_type, ...Object.values(ad.dimensions)]
    .filter(Boolean).join(' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LibraryPage() {
  const t = useT();
  const f = useFormatters();
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();

  const [windowId, setWindowId] = usePref<WindowId>('addna-library-window', 'last_30d', WINDOWS);
  const [view, setView] = usePref<'grid' | 'list'>('addna-library-view', 'grid', ['grid', 'list']);

  // One result per (brand, window): loading is derived, so no setState in the effect body.
  const [result, setResult] = useState<{ key: string; data: LibraryResponse | null; error: string | null } | null>(null);
  const fetchKey = `${activeBrandId ?? ''}|${windowId}`;
  const data = result?.key === fetchKey ? result.data : null;
  const error = result?.key === fetchKey ? result.error : null;
  const loading = Boolean(activeBrandId) && result?.key !== fetchKey;

  const [tab, setTab] = useState<Tab>('creatives');
  const [q, setQ] = useState('');
  const [delivery, setDelivery] = useState<Delivery>('delivered');
  const [sort, setSort] = useState<SortKey>('spend');
  const [kind, setKind] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [assetType, setAssetType] = useState('');
  const [angle, setAngle] = useState('');
  const [verdict, setVerdict] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    const key = fetchKey;
    fetch(`/api/library?brand=${activeBrandId}&window=${windowId}`)
      .then((r) => r.json() as Promise<LibraryResponse>)
      .then((d) => { if (!cancelled) setResult({ key, data: d, error: d.error ?? null }); })
      .catch(() => { if (!cancelled) setResult({ key, data: null, error: t('library.error') }); });
    return () => { cancelled = true; };
  }, [activeBrandId, windowId, fetchKey, t]);

  const ads = useMemo(() => data?.ads ?? [], [data]);
  const currency = data?.currency ?? null;
  const eco = useMemo<Economics>(() => ({ ...DEFAULT_ECONOMICS, ...(data?.economics ?? {}) }), [data]);
  const totals = data?.totals ?? null;

  // The delivery segment and Tipo apply to both tabs; the rest only to Creativos.
  const base = useMemo(() => ads.filter((ad) => {
    if (delivery === 'delivered' && !ad.delivered) return false;
    if (delivery === 'active' && ad.status !== 'active') return false;
    if (kind && ad.kind !== kind) return false;
    return true;
  }), [ads, delivery, kind]);

  const options = useMemo(() => {
    const types = new Set<string>(), angles = new Map<string, string>();
    for (const ad of ads) {
      if (ad.asset_type) types.add(ad.asset_type);
      if (ad.angle_id && ad.angle) angles.set(ad.angle_id, ad.angle);
    }
    return { types: [...types].sort(), angles: [...angles.entries()].sort((a, b) => a[1].localeCompare(b[1])) };
  }, [ads]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = base.filter((ad) => {
      if (needle && !haystack(ad).includes(needle)) return false;
      if (analysis === 'yes' && !ad.analyzed) return false;
      if (analysis === 'no' && ad.analyzed) return false;
      if (assetType && ad.asset_type !== assetType) return false;
      if (angle && ad.angle_id !== angle) return false;
      if (verdict && ad.verdict !== verdict) return false;
      return true;
    });
    const dir = sort === 'cpa' ? 1 : -1; // cost: lower first; everything else: higher first
    return list.sort((a, b) => {
      const av = sort === 'cpa' && a.purchases === 0 ? null : a[sort];
      const bv = sort === 'cpa' && b.purchases === 0 ? null : b[sort];
      if (av == null && bv == null) return b.spend - a.spend;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir || b.spend - a.spend;
    });
  }, [base, q, analysis, assetType, angle, verdict, sort]);

  const notAnalyzed = rows.filter((a) => !a.analyzed).length;
  const selected = selectedId ? ads.find((a) => a.ad_id === selectedId) ?? null : null;
  const close = useCallback(() => setSelectedId(null), []);

  const stats = totals ? [
    { label: t('library.totals.spend'), value: f.money(totals.spend, currency), sub: t('library.totals.impressions', { n: f.num(totals.impressions) }) },
    { label: t('library.totals.purchases'), value: f.num(totals.purchases) },
    { label: t('library.totals.cpa'), value: money0(f, totals.cpa, currency) },
    { label: t('library.totals.roas'), value: totals.roas == null ? '–' : f.ratio(totals.roas), cls: roasClass(totals.roas, eco) },
    { label: t('library.totals.ctr'), value: totals.ctr == null ? '–' : f.pct(totals.ctr, 2) },
    { label: t('library.totals.cpm'), value: money0(f, totals.cpm, currency) },
  ] : [];

  const segBtn = (on: boolean) => `px-2.5 py-1 rounded text-xs whitespace-nowrap ${on ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`;

  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />
      <section className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight font-[family-name:var(--font-serif)]">{t('library.title')}</h1>
            <p className="text-sm text-ink-3 mt-1">{t('library.subtitle')}</p>
            {data?.window && (
              <p className={`text-xs text-ink-4 mt-1.5 ${mono}`}>
                {t('library.subline', {
                  n: ads.length, brand: activeBrand?.name ?? '', window: t(`library.window.${data.window.id}`),
                  from: f.date(data.window.from), to: f.date(data.window.to),
                })}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={label}>{t('library.window.label')}</span>
              <select value={windowId} onChange={(e) => setWindowId(e.target.value as WindowId)} className={select}>
                {WINDOWS.map((w) => <option key={w} value={w}>{t(`library.window.${w}`)}</option>)}
              </select>
            </label>
            <Link href="/meta" className={btn}><RefreshCw className="w-3.5 h-3.5" />{t('library.sync')}</Link>
          </div>
        </div>

        {!activeBrandId ? (
          <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink-3">{t('library.noBrand')}</div>
        ) : loading ? (
          <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 text-accent animate-spin" /></div>
        ) : (
          <>
            {/* Totals strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border border-line bg-surface px-3 py-2.5 min-w-0">
                  <p className={label}>{s.label}</p>
                  <p className={`text-lg font-semibold truncate ${mono} ${s.cls ?? 'text-ink'}`}>{s.value}</p>
                  {s.sub && <p className={`text-[11px] text-ink-4 truncate ${mono}`}>{s.sub}</p>}
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-line mb-4">
              {(['creatives', 'breakdown'] as Tab[]).map((k) => (
                <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-accent text-ink font-medium' : 'border-transparent text-ink-3 hover:text-ink'}`}>
                  {t(`library.tab.${k}`)}
                </button>
              ))}
            </div>

            {/* Toolbar (shared) */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {tab === 'creatives' && (
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-ink-4 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('library.search')} className={`${select} w-full pl-8 py-1.5`} />
                </div>
              )}
              <div className="inline-flex rounded-md border border-line bg-inset p-0.5">
                {(['all', 'delivered', 'active'] as Delivery[]).map((d) => (
                  <button key={d} onClick={() => setDelivery(d)} className={segBtn(delivery === d)}>{t(`library.delivery.${d}`)}</button>
                ))}
              </div>
              {tab === 'creatives' && (
                <div className="ml-auto inline-flex rounded-md border border-line bg-surface p-0.5">
                  <button onClick={() => setView('grid')} title={t('library.view.grid')} aria-pressed={view === 'grid'} className={`p-1.5 rounded ${view === 'grid' ? 'bg-surface-2 text-ink' : 'text-ink-4 hover:text-ink-2'}`}><LayoutGrid className="w-4 h-4" /></button>
                  <button onClick={() => setView('list')} title={t('library.view.list')} aria-pressed={view === 'list'} className={`p-1.5 rounded ${view === 'list' ? 'bg-surface-2 text-ink' : 'text-ink-4 hover:text-ink-2'}`}><List className="w-4 h-4" /></button>
                </div>
              )}
            </div>

            {/* Filter row */}
            <div className="flex flex-wrap items-end gap-2 mb-4">
              {tab === 'creatives' && (
                <Field label={t('library.sort')}>
                  <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={select}>
                    {SORTS.map((k) => <option key={k} value={k}>{t(`library.sort.${k}`)}</option>)}
                  </select>
                </Field>
              )}
              <Field label={t('library.filter.type')}>
                <select value={kind} onChange={(e) => setKind(e.target.value)} className={select}>
                  <option value="">{t('library.filter.all')}</option>
                  <option value="image">{t('library.kind.image')}</option>
                  <option value="video">{t('library.kind.video')}</option>
                </select>
              </Field>
              {tab === 'creatives' && (
                <>
                  <Field label={t('library.filter.analysis')}>
                    <select value={analysis} onChange={(e) => setAnalysis(e.target.value)} className={select}>
                      <option value="">{t('library.filter.all')}</option>
                      <option value="yes">{t('library.analysis.yes')}</option>
                      <option value="no">{t('library.analysis.no')}</option>
                    </select>
                  </Field>
                  <Field label={t('library.filter.format')}>
                    <select value={assetType} onChange={(e) => setAssetType(e.target.value)} className={select}>
                      <option value="">{t('library.filter.all')}</option>
                      {options.types.map((x) => <option key={x} value={x}>{assetTypeLabel(t, x)}</option>)}
                    </select>
                  </Field>
                  <Field label={t('library.filter.angle')}>
                    <select value={angle} onChange={(e) => setAngle(e.target.value)} className={select}>
                      <option value="">{t('library.filter.all')}</option>
                      {options.angles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  </Field>
                  <Field label={t('library.filter.verdict')}>
                    <select value={verdict} onChange={(e) => setVerdict(e.target.value)} className={select}>
                      <option value="">{t('library.filter.all')}</option>
                      {VERDICTS.map((v) => <option key={v} value={v}>{t(VERDICT_KEY[v])}</option>)}
                    </select>
                  </Field>
                  <p className={`text-xs text-ink-4 sm:ml-auto ${mono}`}>{t('library.showing', { x: rows.length, y: ads.length })}</p>
                </>
              )}
            </div>

            {ads.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-surface p-12 text-center">
                <Library className="w-10 h-10 text-line-strong mx-auto mb-4" />
                <p className="text-ink font-medium">{t('library.empty')}</p>
                <p className="text-sm text-ink-4 mt-2">{t('library.empty.help')}</p>
              </div>
            ) : tab === 'breakdown' ? (
              <Breakdown ads={base} baseline={totals?.cpa ?? null} currency={currency} t={t} f={f} />
            ) : (
              <>
                {notAnalyzed > 0 && (
                  <div className="mb-4 rounded-lg border border-line bg-accent-soft px-3 py-2 text-xs text-ink-2 flex flex-wrap items-center gap-x-1.5">
                    <span>{t('library.banner', { n: notAnalyzed })}</span>
                    <Link href="/meta/barrido" className="text-accent font-medium hover:underline">{t('library.banner.link')}</Link>
                  </div>
                )}
                {rows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line bg-surface p-12 text-center text-sm text-ink-3">{t('library.emptyFiltered')}</div>
                ) : view === 'grid' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                    {rows.map((ad) => <Card key={ad.ad_id} ad={ad} currency={currency} eco={eco} t={t} f={f} onOpen={() => setSelectedId(ad.ad_id)} />)}
                  </div>
                ) : (
                  <ListTable rows={rows} currency={currency} eco={eco} t={t} f={f} onOpen={setSelectedId} />
                )}
              </>
            )}
          </>
        )}

        {error && <div className="mt-6 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}
      </section>

      {selected && data?.window && (
        <Detail ad={selected} range={data.window} currency={currency} eco={eco} t={t} f={f} onClose={close} />
      )}
    </main>
  );
}

function Field({ label: l, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className={label}>{l}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Media — thumbnail; a video plays muted on hover. No word for the kind here:
// the badge below the media says it (never "Imagen" for a video).
// ---------------------------------------------------------------------------

function Media({ ad, className }: { ad: LibraryAd; className: string }) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);
  const playable = ad.kind === 'video' && Boolean(ad.asset_url);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); ref.current?.pause(); }} className={`relative overflow-hidden bg-inset ${className}`}>
      {ad.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-line-strong">
          {ad.kind === 'video' ? <Film className="w-7 h-7" /> : <ImageIcon className="w-7 h-7" />}
        </div>
      )}
      {playable && hover && (
        <video ref={ref} src={ad.asset_url ?? undefined} muted loop playsInline autoPlay className="absolute inset-0 w-full h-full object-cover" />
      )}
    </div>
  );
}

function StatusPill({ status, t }: { status: AdStatus; t: T }) {
  return <span className={`${pill} ${statusClass(status)}`}>{t(`library.status.${status}`)}</span>;
}

function KindBadge({ kind, t }: { kind: Kind; t: T }) {
  return (
    <span className={`${overlayPill} normal-case tracking-normal font-medium`}>
      {kind === 'video' ? <Play className="w-2.5 h-2.5 fill-current" /> : <ImageIcon className="w-2.5 h-2.5" />}
      {t(`library.kind.${kind}`)}
    </span>
  );
}

function VerdictPill({ v, t }: { v: VerdictId; t: T }) {
  return <span className={`${pill} ${VERDICT_CLASS[v]}`}>{t(VERDICT_KEY[v])}</span>;
}

// ---------------------------------------------------------------------------
// Card + list row
// ---------------------------------------------------------------------------

interface ItemProps { ad: LibraryAd; currency: string | null; eco: Economics; t: T; f: F; onOpen: () => void }

/** The four numbers a card shows. "–" when there is nothing to divide by. */
function adMetrics(ad: LibraryAd, currency: string | null, eco: Economics, t: T, f: F) {
  const has = ad.purchases > 0;
  return [
    { label: t('library.m.spend'), value: f.money(ad.spend, currency) },
    { label: t('library.m.purchases'), value: f.num(ad.purchases) },
    { label: t('library.m.cpa'), value: has ? money0(f, ad.cpa, currency) : '–' },
    { label: t('library.m.roas'), value: has && ad.roas != null ? f.ratio(ad.roas) : '–', cls: has ? roasClass(ad.roas, eco) : 'text-ink-4' },
  ];
}

function Card({ ad, currency, eco, t, f, onOpen }: ItemProps) {
  const chips = cardChips(ad, t);
  return (
    <article
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="cursor-pointer rounded-xl border border-line bg-surface overflow-hidden hover:border-line-strong hover:shadow-sm transition-all focus:outline-none focus:border-accent min-w-0"
    >
      <div className="relative">
        <Media ad={ad} className="aspect-[4/5] w-full" />
        <div className="absolute top-2 left-2"><StatusPill status={ad.status} t={t} /></div>
        {ad.asset_type && <span className={`${overlayPill} absolute top-2 right-2 max-w-[45%] truncate`}>{assetTypeLabel(t, ad.asset_type)}</span>}
        <div className="absolute bottom-2 left-2"><KindBadge kind={ad.kind} t={t} /></div>
        {ad.duration != null && ad.kind === 'video' && (
          <span className={`${overlayPill} absolute bottom-2 right-2 normal-case ${mono}`}>{Math.round(ad.duration)}s</span>
        )}
      </div>
      <div className="p-3 min-w-0">
        <p className="text-sm font-semibold text-ink leading-snug line-clamp-2 break-words" title={ad.ad_name}>{ad.ad_name}</p>
        <p className="text-[11px] text-ink-4 truncate mt-0.5" title={ad.campaign_name ?? ''}>{ad.campaign_name ?? '–'}</p>
        <dl className="mt-2.5 space-y-1">
          {adMetrics(ad, currency, eco, t, f).map((m) => (
            <div key={m.label} className="flex items-baseline justify-between gap-2 text-xs">
              <dt className="text-ink-4 truncate">{m.label}</dt>
              <dd className={`${mono} ${m.cls ?? 'text-ink'}`}>{m.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          <span className={`${pill} ${ad.analyzed ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`} title={ad.analyzed ? t('library.analyzed.yes') : t('library.analyzed.no')}>
            {ad.analyzed ? '✓ ' : '! '}{ad.analyzed ? t('library.analyzed.yes') : t('library.analyzed.no')}
          </span>
          <VerdictPill v={ad.verdict} t={t} />
          {chips.map((x, i) => <span key={`${i}-${x}`} className={chip} title={x}>{x}</span>)}
        </div>
      </div>
    </article>
  );
}

function ListTable({ rows, currency, eco, t, f, onOpen }: { rows: LibraryAd[]; currency: string | null; eco: Economics; t: T; f: F; onOpen: (id: string) => void }) {
  const th = 'font-medium px-3 py-2 whitespace-nowrap';
  const td = `px-3 py-2 text-right whitespace-nowrap ${mono}`;
  return (
    <div className="rounded-xl border border-line bg-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={`${label} border-b border-line`}>
            <th className={`${th} text-left`}>{t('library.col.creative')}</th>
            <th className={`${th} text-left`}>{t('library.col.status')}</th>
            <th className={`${th} text-right`}>{t('library.m.spend')}</th>
            <th className={`${th} text-right`}>{t('library.m.purchases')}</th>
            <th className={`${th} text-right`}>{t('library.m.cpa')}</th>
            <th className={`${th} text-right`}>{t('library.m.roas')}</th>
            <th className={`${th} text-right`}>{t('library.m.ctr')}</th>
            <th className={`${th} text-right`}>{t('library.m.hook')}</th>
            <th className={`${th} text-left`}>{t('library.col.tags')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((ad) => {
            const m = adMetrics(ad, currency, eco, t, f);
            return (
              <tr key={ad.ad_id} onClick={() => onOpen(ad.ad_id)} className="border-b border-line last:border-0 hover:bg-inset/60 cursor-pointer">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3 min-w-[240px]">
                    <Media ad={ad} className="w-10 h-[50px] shrink-0 rounded-md border border-line" />
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate max-w-[280px]" title={ad.ad_name}>{ad.ad_name}</p>
                      <p className="text-[11px] text-ink-4 truncate max-w-[280px]">
                        {t(`library.kind.${ad.kind}`)}{ad.asset_type ? ` · ${assetTypeLabel(t, ad.asset_type)}` : ''}{ad.campaign_name ? ` · ${ad.campaign_name}` : ''}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2"><StatusPill status={ad.status} t={t} /></td>
                <td className={td}>{m[0].value}</td>
                <td className={td}>{m[1].value}</td>
                <td className={td}>{m[2].value}</td>
                <td className={`${td} ${m[3].cls}`}>{m[3].value}</td>
                <td className={td}>{ad.ctr == null ? '–' : f.pct(ad.ctr, 2)}</td>
                <td className={td}>{ad.hook_rate == null ? '–' : f.pct(ad.hook_rate)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1 min-w-[160px]">
                    <VerdictPill v={ad.verdict} t={t} />
                    {cardChips(ad, t).map((x, i) => <span key={`${i}-${x}`} className={chip} title={x}>{x}</span>)}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail modal — media · tags + daily spend · Meta metrics.
// ---------------------------------------------------------------------------

function Detail({ ad, range, currency, eco, t, f, onClose }: { ad: LibraryAd; range: { from: string; to: string }; currency: string | null; eco: Economics; t: T; f: F; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const href = analysisHref(ad);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(ad.ad_id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard denied */ }
  };

  const tags: { label: string; value: string }[] = [
    { label: t('library.tag.kind'), value: t(`library.kind.${ad.kind}`) },
    ...(ad.asset_type ? [{ label: t('library.tag.format'), value: assetTypeLabel(t, ad.asset_type) }] : []),
    ...(ad.angle ? [{ label: t('library.tag.angle'), value: ad.angle }] : []),
    ...(ad.persona ? [{ label: t('library.tag.persona'), value: ad.persona }] : []),
    ...(ad.concept ? [{ label: t('library.tag.concept'), value: ad.concept }] : []),
    ...TAG_ORDER.filter((k) => ad.dimensions[k]).map((k) => ({ label: tagLabel(t, k), value: dimValue(t, ad.dimensions[k]) })),
  ];

  const has = ad.purchases > 0;
  const metrics: { label: string; value: string; cls?: string }[] = [
    { label: t('library.m.spend'), value: f.money(ad.spend, currency) },
    { label: t('library.m.purchases'), value: f.num(ad.purchases) },
    { label: t('library.m.cpa'), value: has ? money0(f, ad.cpa, currency) : '–' },
    { label: t('library.m.roas'), value: has && ad.roas != null ? f.ratio(ad.roas) : '–', cls: has ? roasClass(ad.roas, eco) : undefined },
    { label: t('library.m.revenue'), value: f.money(ad.revenue, currency) },
    { label: t('library.m.impressions'), value: ad.impressions == null ? '–' : f.num(ad.impressions) },
    { label: t('library.m.clicks'), value: ad.link_clicks == null ? '–' : f.num(ad.link_clicks) },
    { label: t('library.m.ctr'), value: ad.ctr == null ? '–' : f.pct(ad.ctr, 2) },
    { label: t('library.m.cpm'), value: money0(f, ad.cpm, currency) },
    { label: t('library.m.freq'), value: ad.freq == null ? '–' : f.ratio(ad.freq, 2) },
    { label: t('library.m.hook'), value: ad.hook_rate == null ? '–' : f.pct(ad.hook_rate) },
    { label: t('library.m.hold'), value: ad.hold_rate == null ? '–' : f.pct(ad.hold_rate) },
    { label: t('library.m.cvr'), value: ad.cvr == null ? '–' : f.pct(ad.cvr) },
  ];

  const meaning = t(`library.meaning.${ad.verdict}`, {
    target: f.ratio(eco.target), breakeven: f.ratio(eco.breakeven), kill: f.money(eco.kill, currency),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-2 sm:p-6" role="dialog" aria-modal="true" aria-label={ad.ad_name}>
      <div className="absolute inset-0 bg-overlay/60" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-full overflow-y-auto rounded-xl border border-line bg-canvas shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 bg-canvas/95 backdrop-blur border-b border-line">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <StatusPill status={ad.status} t={t} />
              <span className={`text-[11px] text-ink-3 ${mono}`}>{f.date(range.from)} – {f.date(range.to)}</span>
            </div>
            <h2 className="text-base font-semibold text-ink break-words leading-snug">{ad.ad_name}</h2>
            <p className="text-xs text-ink-4 truncate">{[ad.campaign_name, ad.adset_name].filter(Boolean).join(' · ') || '–'}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button onClick={copy} className={btn}>
                {copied ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? t('library.detail.copied') : t('library.detail.copyId')}
              </button>
              {href ? (
                <Link href={href} className={`${btn} bg-accent-soft text-accent border-transparent hover:text-accent`}>{t('library.detail.viewAnalysis')}</Link>
              ) : (
                <Link href="/meta/barrido" className={btn}>{t('library.detail.analyze')}</Link>
              )}
            </div>
          </div>
          <button onClick={onClose} title={t('common.close')} className="p-1.5 rounded-md text-ink-2 hover:text-ink hover:bg-surface-2 shrink-0"><X className="w-4 h-4" /></button>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-4 px-4 sm:px-5 py-4">
          <div className="rounded-lg border border-line overflow-hidden bg-inset self-start">
            {ad.kind === 'video' && ad.asset_url ? (
              <video src={ad.asset_url} poster={ad.thumbnail_url ?? undefined} controls playsInline preload="metadata" className="w-full max-h-[480px] object-contain bg-overlay" />
            ) : ad.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.thumbnail_url} alt="" className="w-full max-h-[480px] object-contain" />
            ) : (
              <div className="aspect-[4/5] flex items-center justify-center text-line-strong">
                {ad.kind === 'video' ? <Film className="w-8 h-8" /> : <ImageIcon className="w-8 h-8" />}
              </div>
            )}
          </div>

          <div className="space-y-4 min-w-0">
            <section className="rounded-xl border border-line bg-surface p-4">
              <h3 className={`${label} mb-2`}>{t('library.detail.tags')}</h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                {tags.map((x) => (
                  <div key={x.label} className="min-w-0">
                    <dt className="text-[10px] text-ink-4">{x.label}</dt>
                    <dd className="text-xs text-ink break-words">{x.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center gap-2">
                <VerdictPill v={ad.verdict} t={t} />
                <span className="text-xs text-ink-3">{meaning}</span>
              </div>
            </section>
            <section className="rounded-xl border border-line bg-surface p-4">
              <h3 className={`${label} mb-2`}>{t('library.detail.dailySpend')}</h3>
              <SpendChart daily={ad.daily} currency={currency} f={f} />
            </section>
          </div>

          <section className="rounded-xl border border-line bg-surface p-4 min-w-0">
            <h3 className={`${label} mb-2`}>{t('library.detail.metrics')}</h3>
            <dl className="divide-y divide-line">
              {metrics.map((m) => (
                <div key={m.label} className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
                  <dt className="text-ink-4 truncate">{m.label}</dt>
                  <dd className={`${mono} ${m.cls ?? 'text-ink'}`}>{m.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Bar chart in plain divs: one bar per day of the window, height proportional to spend. */
function SpendChart({ daily, currency, f }: { daily: LibraryAd['daily']; currency: string | null; f: F }) {
  const max = Math.max(0, ...daily.map((d) => d.spend));
  if (daily.length === 0 || max === 0) return <p className="text-xs text-ink-4">–</p>;
  const step = Math.max(1, Math.ceil(daily.length / 6));
  return (
    <div className="min-w-0">
      <div className="flex items-end gap-px h-24">
        {daily.map((d) => (
          <div key={d.date} className="flex-1 min-w-0 h-full flex items-end" title={`${f.date(d.date)} · ${f.money(d.spend, currency)} · ${f.num(d.purchases)}`}>
            <div className="w-full rounded-sm bg-accent" style={{ height: `${Math.max(2, (d.spend / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        {daily.filter((_, i) => i % step === 0 || i === daily.length - 1).map((d) => (
          <span key={d.date} className={`text-[10px] text-ink-4 ${mono}`}>{f.date(d.date)}</span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desglose — cost per purchase by tag, against the account baseline.
// Rows ranked by CPA ascending; rows without purchases go last.
// ---------------------------------------------------------------------------

interface BreakRow { value: string; n: number; spend: number; purchases: number; impressions: number; clicks: number }

function groupBy(ads: LibraryAd[], pick: (a: LibraryAd) => string | null): BreakRow[] {
  const by = new Map<string, BreakRow>();
  for (const a of ads) {
    const v = pick(a);
    if (!v) continue;
    const r = by.get(v) ?? { value: v, n: 0, spend: 0, purchases: 0, impressions: 0, clicks: 0 };
    r.n++; r.spend += a.spend; r.purchases += a.purchases; r.impressions += a.impressions ?? 0; r.clicks += a.link_clicks ?? 0;
    by.set(v, r);
  }
  const cpa = (r: BreakRow) => (r.purchases > 0 ? r.spend / r.purchases : Infinity);
  return [...by.values()].sort((a, b) => cpa(a) - cpa(b) || b.spend - a.spend);
}

function Breakdown({ ads, baseline, currency, t, f }: { ads: LibraryAd[]; baseline: number | null; currency: string | null; t: T; f: F }) {
  const dims: { key: string; pick: (a: LibraryAd) => string | null; render?: (v: string) => string }[] = [
    { key: 'angle', pick: (a) => a.angle },
    { key: 'kind', pick: (a) => a.kind, render: (v) => t(`library.kind.${v}`) },
    { key: 'asset_type', pick: (a) => a.asset_type, render: (v) => assetTypeLabel(t, v) },
    { key: 'awareness_level', pick: (a) => a.dimensions.awareness_level ?? null, render: (v) => dimValue(t, v) },
    { key: 'proof_type', pick: (a) => a.dimensions.proof_type ?? null, render: (v) => dimValue(t, v) },
    { key: 'offer', pick: (a) => a.dimensions.offer ?? null, render: (v) => dimValue(t, v) },
    { key: 'verdict', pick: (a) => a.verdict, render: (v) => t(VERDICT_KEY[v as VerdictId]) },
  ];
  const all = dims.map((d) => ({ ...d, rows: groupBy(ads, d.pick) }));
  const cards = all.filter((d) => d.rows.length > 0);
  const untagged = all.filter((d) => d.rows.length === 0).map((d) => t(`library.breakdown.dim.${d.key}`));

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3">{t('library.breakdown.intro', { cpa: money0(f, baseline, currency) })}</p>
      {cards.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {cards.map((d) => (
            <div key={d.key} className="rounded-xl border border-line bg-surface p-4 min-w-0">
              <h3 className="text-sm font-semibold text-ink mb-2">{t(`library.breakdown.dim.${d.key}`)}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className={`${label} border-b border-line`}>
                      <th className="text-left font-medium py-1.5 pr-2">{t('library.breakdown.col.value')}</th>
                      <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">{t('library.breakdown.col.purchases')}</th>
                      <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">{t('library.breakdown.col.cpa')}</th>
                      <th className="text-right font-medium py-1.5 pl-2 whitespace-nowrap">{t('library.breakdown.col.vs')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => {
                      const cpa = r.purchases > 0 ? r.spend / r.purchases : null;
                      const ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null;
                      const diff = cpa != null && baseline ? ((baseline - cpa) / baseline) * 100 : null;
                      return (
                        <tr key={r.value} className="border-b border-line last:border-0 align-top">
                          <td className="py-2 pr-2 min-w-[160px]">
                            <p className="text-ink font-medium break-words">
                              {d.render ? d.render(r.value) : r.value}
                              {r.purchases < 5 && <span className={`${pill} ml-1.5 bg-warn-soft text-warn`}>{t('library.breakdown.small')}</span>}
                            </p>
                            <p className={`text-[11px] text-ink-4 ${mono}`}>
                              {t('library.breakdown.sub', { n: r.n, spend: f.money(r.spend, currency), ctr: ctr == null ? '–' : f.pct(ctr, 2) })}
                            </p>
                          </td>
                          <td className={`py-2 px-2 text-right ${mono}`}>{f.num(r.purchases)}</td>
                          <td className={`py-2 px-2 text-right ${mono}`}>{money0(f, cpa, currency)}</td>
                          <td className={`py-2 pl-2 text-right whitespace-nowrap ${mono} ${diff == null ? 'text-ink-4' : diff >= 0 ? 'text-ok' : 'text-danger'}`}>
                            {diff == null ? t('library.breakdown.noRef') : diff >= 0 ? t('library.breakdown.better', { pct: Math.round(diff) }) : t('library.breakdown.worse', { pct: Math.round(-diff) })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
      {untagged.length > 0 && (
        <p className="text-xs text-ink-4">{t('library.breakdown.none')}: {untagged.join(' · ')}</p>
      )}
    </div>
  );
}
