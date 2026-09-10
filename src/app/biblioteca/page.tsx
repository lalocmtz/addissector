'use client';

// =============================================================================
// Library — every ad the account has spent on, as a visual mosaic: the creative
// itself (thumbnail, video on hover), what it cost, what it returned, and the
// tags that describe it. A card opens a drawer with the full picture. Reads
// GET /api/library?brand= (already sorted by spend); everything else — totals,
// filters, sort — is computed here from the rows.
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  Loader2, Film, Image as ImageIcon, Library, Search, X, LayoutGrid, List, Check, Copy, ExternalLink, CheckCircle2,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { useT, useFormatters } from '@/lib/i18n';
import { DEFAULT_ECONOMICS, type Economics } from '@/lib/meta';

type VerdictId = 'ganador' | 'prometedor' | 'dejar' | 'apagar' | 'sin_datos';

const VERDICT_KEY: Record<VerdictId, string> = {
  ganador: 'verdict.winner',
  prometedor: 'verdict.promising',
  dejar: 'verdict.cut',
  apagar: 'verdict.kill',
  sin_datos: 'verdict.noData',
};

const VERDICT_CLASS: Record<VerdictId, string> = {
  ganador: 'bg-ok-soft text-ok',
  prometedor: 'bg-accent-soft text-accent',
  dejar: 'bg-warn-soft text-warn',
  apagar: 'bg-danger-soft text-danger',
  sin_datos: 'bg-inset text-ink-4',
};

const VERDICT_ORDER: VerdictId[] = ['ganador', 'prometedor', 'dejar', 'apagar', 'sin_datos'];

interface LibraryAd {
  ad_id: string;
  ad_name: string;
  status: string | null;
  first_date: string | null;
  last_date: string | null;
  days: number;
  spend: number;
  revenue: number;
  purchases: number;
  roas: number | null;
  cpa: number | null;
  hook_rate: number | null;
  hold_rate: number | null;
  ret75: number | null;
  cvr: number | null;
  recent: { spend: number; roas: number | null; hook_rate: number | null } | null;
  verdict: VerdictId;
  asset_kind: string | null;
  asset_url: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  creative_id: string | null;
  creative_type: string | null;
  analyzed: boolean;
  has_dossier: boolean;
  persona_id: string | null;
  angle_id: string | null;
  concept_id: string | null;
  persona: string | null;
  angle: string | null;
  concept: string | null;
  taxonomy_source: string | null;
  taxonomy_confidence: number | null;
  experiment_id: string | null;
  dimensions: Record<string, string>;
}

interface Named { id: string; name: string; code?: string | null }

interface LibraryResponse {
  ads?: LibraryAd[];
  currency?: string | null;
  economics?: Partial<Economics> | null;
  memoryTo?: string | null;
  personas?: Named[];
  angles?: Named[];
  concepts?: Named[];
  error?: string;
}

type SortKey = 'spend' | 'roas' | 'cpa' | 'hook_rate' | 'hold_rate' | 'cvr' | 'recent';
type ViewMode = 'grid' | 'list';

const SORT_ORDER: SortKey[] = ['spend', 'roas', 'cpa', 'hook_rate', 'hold_rate', 'cvr', 'recent'];

/** Dimensions shown in the drawer, in reading order; anything else tagged follows. */
const DIMENSION_ORDER = [
  'format', 'awareness_level', 'creator', 'emotional_driver', 'narrative_structure', 'proof_type',
  'offer', 'cta', 'visual_style', 'pacing', 'duration_bucket',
];

/** Dimensions that earn a chip on the card, in priority order (max 4 after the angle code). */
const CARD_DIMENSIONS = ['awareness_level', 'proof_type', 'offer', 'emotional_driver'];

const VIEW_KEY = 'addna-library-view';

const input =
  'rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent';
const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium';
const tag = 'inline-flex items-center rounded-md border border-line bg-inset px-1.5 py-0.5 text-[10px] text-ink-2 truncate max-w-[140px]';
const num = 'font-[family-name:var(--font-mono)] tabular-nums whitespace-nowrap';
const mono = 'font-[family-name:var(--font-mono)]';

// ---------------------------------------------------------------------------
// View mode lives in localStorage; read through an external store so the
// server render (always grid) and the first client render agree.
// ---------------------------------------------------------------------------

const viewListeners = new Set<() => void>();

function readView(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function writeView(v: ViewMode) {
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    // Storage may be unavailable (private mode); the toggle still works for the session.
  }
  viewListeners.forEach((l) => l());
}

function subscribeView(cb: () => void) {
  viewListeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    viewListeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Video kind for an ad, tolerant of the several shapes Meta and the library use. */
function isVideo(ad: LibraryAd): boolean {
  const k = `${ad.asset_kind ?? ''}${ad.creative_type ?? ''}`.toLowerCase();
  return k.includes('video') || Boolean(ad.duration);
}

/** The format we filter by: the tagged dimension when there is one, else the media kind. */
function formatOf(ad: LibraryAd): string {
  return ad.dimensions?.format ?? (isVideo(ad) ? 'video' : 'image');
}

function labelOf(x: Named): string {
  return x.code ? `${x.code} ${x.name}` : x.name;
}

/** ROAS against the brand's economics: above target, above break-even, or below. */
function roasClass(roas: number | null, eco: Economics): string {
  if (roas == null) return 'text-ink-4';
  if (roas >= eco.target) return 'text-ok';
  if (roas >= eco.breakeven) return 'text-warn';
  return 'text-danger';
}

function statusClass(status: string | null): string {
  const s = (status ?? '').toUpperCase();
  if (s === 'ACTIVE') return 'bg-ok-soft text-ok';
  if (s === 'PAUSED') return 'bg-warn-soft text-warn';
  return 'bg-inset text-ink-3';
}

function analysisHref(ad: LibraryAd): string | null {
  if (!ad.creative_id) return null;
  return `${ad.creative_type === 'image' ? '/analyze-image' : '/analyze'}?id=${ad.creative_id}`;
}

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;
type F = ReturnType<typeof useFormatters>;

/** Translates a dictionary-shaped key, falling back to the raw value when it has no entry. */
function tOr(t: T, key: string, raw: string): string {
  const s = t(key);
  return s === key ? raw : s;
}

function statusLabel(t: T, status: string | null): string {
  if (!status) return '—';
  return tOr(t, `library.status.${status.toUpperCase()}`, status);
}

function dimLabel(t: T, dim: string): string {
  return tOr(t, `library.dim.${dim}`, dim.replace(/_/g, ' '));
}

function formatLabel(t: T, fmt: string): string {
  return tOr(t, `library.format.${fmt}`, fmt);
}

/** Spend-weighted mean of a per-ad rate, ignoring ads without the rate. */
function weighted(rows: LibraryAd[], pick: (a: LibraryAd) => number | null): number | null {
  let w = 0, acc = 0;
  for (const a of rows) {
    const v = pick(a);
    if (v == null || a.spend <= 0) continue;
    w += a.spend;
    acc += v * a.spend;
  }
  return w > 0 ? acc / w : null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LibraryPage() {
  const t = useT();
  const f = useFormatters();
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();

  const [ads, setAds] = useState<LibraryAd[]>([]);
  const [currency, setCurrency] = useState<string | null>(null);
  const [economics, setEconomics] = useState<Economics>(DEFAULT_ECONOMICS);
  const [memoryTo, setMemoryTo] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Named[]>([]);
  const [angles, setAngles] = useState<Named[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('spend');
  const [type, setType] = useState('');
  const [analyzed, setAnalyzed] = useState('');
  const [verdict, setVerdict] = useState('');
  const [persona, setPersona] = useState('');
  const [angle, setAngle] = useState('');
  const [format, setFormat] = useState('');
  const [awareness, setAwareness] = useState('');
  const [proof, setProof] = useState('');
  const [onlySpend, setOnlySpend] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const view = useSyncExternalStore(subscribeView, readView, () => 'grid' as ViewMode);

  const load = useCallback(async () => {
    if (!activeBrandId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/library?brand=${activeBrandId}`);
      const data: LibraryResponse = await res.json();
      if (data.error) setError(data.error);
      setAds(Array.isArray(data.ads) ? data.ads : []);
      setCurrency(data.currency ?? null);
      setEconomics({ ...DEFAULT_ECONOMICS, ...(data.economics ?? {}) });
      setMemoryTo(data.memoryTo ?? null);
      setPersonas(Array.isArray(data.personas) ? data.personas : []);
      setAngles(Array.isArray(data.angles) ? data.angles : []);
    } catch {
      setError(t('library.error'));
    } finally {
      setLoading(false);
    }
  }, [activeBrandId, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Option lists come from what is actually tagged, so a filter never offers an empty result.
  const options = useMemo(() => {
    const formats = new Set<string>(), awarenessSet = new Set<string>(), proofSet = new Set<string>();
    for (const ad of ads) {
      formats.add(formatOf(ad));
      if (ad.dimensions?.awareness_level) awarenessSet.add(ad.dimensions.awareness_level);
      if (ad.dimensions?.proof_type) proofSet.add(ad.dimensions.proof_type);
    }
    return { formats: [...formats].sort(), awareness: [...awarenessSet].sort(), proof: [...proofSet].sort() };
  }, [ads]);

  const angleCode = useMemo(() => new Map(angles.map((a) => [a.id, a.code ?? null])), [angles]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = ads.filter((ad) => {
      if (onlySpend && !(ad.spend > 0)) return false;
      if (needle && !ad.ad_name.toLowerCase().includes(needle)) return false;
      if (type === 'video' && !isVideo(ad)) return false;
      if (type === 'image' && isVideo(ad)) return false;
      if (analyzed === 'yes' && !ad.analyzed) return false;
      if (analyzed === 'no' && ad.analyzed) return false;
      if (verdict && ad.verdict !== verdict) return false;
      if (persona && ad.persona_id !== persona) return false;
      if (angle && ad.angle_id !== angle) return false;
      if (format && formatOf(ad) !== format) return false;
      if (awareness && ad.dimensions?.awareness_level !== awareness) return false;
      if (proof && ad.dimensions?.proof_type !== proof) return false;
      return true;
    });
    if (sort === 'spend') return filtered;
    const dir = sort === 'cpa' ? 1 : -1;
    const pick = (a: LibraryAd): number | null => (sort === 'recent' ? a.recent?.spend ?? null : a[sort]);
    return [...filtered].sort((a, b) => {
      const av = pick(a), bv = pick(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [ads, q, sort, type, analyzed, verdict, persona, angle, format, awareness, proof, onlySpend]);

  const totals = useMemo(() => {
    const spend = rows.reduce((s, a) => s + a.spend, 0);
    const revenue = rows.reduce((s, a) => s + a.revenue, 0);
    const purchases = rows.reduce((s, a) => s + a.purchases, 0);
    return {
      spend,
      purchases,
      cpa: purchases > 0 ? spend / purchases : null,
      roas: spend > 0 ? revenue / spend : null,
      hook: weighted(rows, (a) => a.hook_rate),
      hold: weighted(rows, (a) => a.hold_rate),
      count: rows.length,
    };
  }, [rows]);

  const dirty = Boolean(q || type || analyzed || verdict || persona || angle || format || awareness || proof || !onlySpend);

  const clear = () => {
    setQ('');
    setType('');
    setAnalyzed('');
    setVerdict('');
    setPersona('');
    setAngle('');
    setFormat('');
    setAwareness('');
    setProof('');
    setOnlySpend(true);
  };

  const selected = useMemo(() => (selectedId ? ads.find((a) => a.ad_id === selectedId) ?? null : null), [ads, selectedId]);
  const close = useCallback(() => setSelectedId(null), []);

  const stats: { label: string; value: string; cls?: string }[] = [
    { label: t('meta.col.spend'), value: f.money(totals.spend, currency, { compact: true }) },
    { label: t('meta.col.purchases'), value: f.num(totals.purchases) },
    { label: t('meta.col.cpa'), value: totals.cpa == null ? '—' : f.money(totals.cpa, currency) },
    { label: t('meta.col.roas'), value: f.ratio(totals.roas), cls: roasClass(totals.roas, economics) },
    { label: t('meta.col.hook'), value: f.pct(totals.hook) },
    { label: t('meta.col.hold'), value: f.pct(totals.hold) },
    { label: t('library.totals.creatives'), value: f.num(totals.count) },
  ];

  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-6 py-8">
        <div className="max-w-[1400px] mx-auto">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
            <div>
              <h1 className={`text-2xl font-bold tracking-tight ${mono}`}>
                {t('library.title')}
                {activeBrand ? ` · ${activeBrand.name}` : ''}
              </h1>
              <p className="text-sm text-ink-4 mt-1">{t('library.subtitle')}</p>
            </div>
            {memoryTo && (
              <p className={`text-xs text-ink-4 ${mono}`}>{t('library.memoryTo', { date: f.date(memoryTo) })}</p>
            )}
          </div>

          {!activeBrandId ? (
            <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-ink-3">
              {t('library.noBrand')}
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
            </div>
          ) : ads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface p-12 text-center">
              <Library className="w-10 h-10 text-line-strong mx-auto mb-4" />
              <p className="text-ink font-medium">{t('library.empty')}</p>
              <p className="text-sm text-ink-4 mt-2">{t('library.empty.help')}</p>
            </div>
          ) : (
            <>
              {/* Totals of what is on screen — the filters decide the denominator */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-5">
                {stats.map((s) => (
                  <div key={s.label} className="rounded-lg border border-line bg-surface px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-ink-4">{s.label}</p>
                    <p className={`text-lg font-semibold ${num} ${s.cls ?? 'text-ink'}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-ink-4 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={t('library.search')}
                    className={`${input} pl-8 w-56`}
                  />
                </div>

                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={input}>
                  {SORT_ORDER.map((k) => (
                    <option key={k} value={k}>{t(`library.sort.${k}`)}</option>
                  ))}
                </select>

                <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
                  <option value="">{t('library.filter.type')}</option>
                  <option value="video">{t('library.format.video')}</option>
                  <option value="image">{t('library.format.image')}</option>
                </select>

                <select value={analyzed} onChange={(e) => setAnalyzed(e.target.value)} className={input}>
                  <option value="">{t('library.filter.analyzed')}</option>
                  <option value="yes">{t('library.analyzed.yes')}</option>
                  <option value="no">{t('library.analyzed.no')}</option>
                </select>

                <select value={verdict} onChange={(e) => setVerdict(e.target.value)} className={input}>
                  <option value="">{t('library.filter.verdict')}</option>
                  {VERDICT_ORDER.map((v) => (
                    <option key={v} value={v}>{t(VERDICT_KEY[v])}</option>
                  ))}
                </select>

                <select value={persona} onChange={(e) => setPersona(e.target.value)} className={input}>
                  <option value="">{t('library.filter.persona')}</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>{labelOf(p)}</option>
                  ))}
                </select>

                <select value={angle} onChange={(e) => setAngle(e.target.value)} className={input}>
                  <option value="">{t('library.filter.angle')}</option>
                  {angles.map((a) => (
                    <option key={a.id} value={a.id}>{labelOf(a)}</option>
                  ))}
                </select>

                <select value={format} onChange={(e) => setFormat(e.target.value)} className={input}>
                  <option value="">{t('library.filter.format')}</option>
                  {options.formats.map((x) => (
                    <option key={x} value={x}>{formatLabel(t, x)}</option>
                  ))}
                </select>

                {options.awareness.length > 0 && (
                  <select value={awareness} onChange={(e) => setAwareness(e.target.value)} className={input}>
                    <option value="">{t('library.filter.awareness')}</option>
                    {options.awareness.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                )}

                {options.proof.length > 0 && (
                  <select value={proof} onChange={(e) => setProof(e.target.value)} className={input}>
                    <option value="">{t('library.filter.proof')}</option>
                    {options.proof.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                )}

                <label className="inline-flex items-center gap-1.5 text-xs text-ink-2 px-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={onlySpend}
                    onChange={(e) => setOnlySpend(e.target.checked)}
                    className="accent-accent"
                  />
                  {t('library.onlySpend')}
                </label>

                {dirty && (
                  <button
                    onClick={clear}
                    className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink px-2 py-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    {t('library.clear')}
                  </button>
                )}

                <div className="ml-auto flex items-center gap-3">
                  <p className={`text-xs text-ink-4 ${mono}`}>
                    {t('library.showing', { n: totals.count, spend: f.money(totals.spend, currency, { compact: true }) })}
                  </p>
                  <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
                    <button
                      onClick={() => writeView('grid')}
                      title={t('library.view.grid')}
                      aria-pressed={view === 'grid'}
                      className={`p-1.5 rounded ${view === 'grid' ? 'bg-surface-2 text-ink' : 'text-ink-4 hover:text-ink-2'}`}
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => writeView('list')}
                      title={t('library.view.list')}
                      aria-pressed={view === 'list'}
                      className={`p-1.5 rounded ${view === 'list' ? 'bg-surface-2 text-ink' : 'text-ink-4 hover:text-ink-2'}`}
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-surface p-12 text-center text-sm text-ink-3">
                  {t('library.emptyFiltered')}
                </div>
              ) : view === 'grid' ? (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                  {rows.map((ad) => (
                    <Card
                      key={ad.ad_id}
                      ad={ad}
                      currency={currency}
                      eco={economics}
                      angleCode={ad.angle_id ? angleCode.get(ad.angle_id) ?? null : null}
                      t={t}
                      f={f}
                      onOpen={() => setSelectedId(ad.ad_id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-line bg-surface overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-ink-4 border-b border-line">
                        <th className="text-left font-medium px-3 py-2">{t('library.col.creative')}</th>
                        <th className="text-right font-medium px-3 py-2">{t('meta.col.spend')}</th>
                        <th className="text-right font-medium px-3 py-2">{t('meta.col.purchases')}</th>
                        <th className="text-right font-medium px-3 py-2">{t('meta.col.cpa')}</th>
                        <th className="text-right font-medium px-3 py-2">{t('meta.col.roas')}</th>
                        <th className="text-right font-medium px-3 py-2">{t('meta.col.hook')}</th>
                        <th className="text-right font-medium px-3 py-2">{t('meta.col.hold')}</th>
                        <th className="text-right font-medium px-3 py-2">{t('meta.col.cvr')}</th>
                        <th className="text-left font-medium px-3 py-2">{t('meta.col.verdict')}</th>
                        <th className="text-left font-medium px-3 py-2">{t('library.col.tags')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((ad) => (
                        <Row
                          key={ad.ad_id}
                          ad={ad}
                          currency={currency}
                          eco={economics}
                          angleCode={ad.angle_id ? angleCode.get(ad.angle_id) ?? null : null}
                          t={t}
                          f={f}
                          onOpen={() => setSelectedId(ad.ad_id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="mt-6 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>
          )}
        </div>
      </section>

      {selected && (
        <Drawer ad={selected} currency={currency} eco={economics} t={t} f={f} onClose={close} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Media box — thumbnail that becomes the muted, looping video while hovered,
// so the creative can be judged without opening anything.
// ---------------------------------------------------------------------------

function Media({ ad, className }: { ad: LibraryAd; className: string }) {
  const [hover, setHover] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const video = isVideo(ad) && Boolean(ad.asset_url);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        videoRef.current?.pause();
      }}
      className={`relative overflow-hidden bg-canvas ${className}`}
    >
      {ad.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.thumbnail_url} alt={ad.ad_name} loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-line-strong">
          {isVideo(ad) ? <Film className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}
        </div>
      )}
      {video && hover && (
        <video
          ref={videoRef}
          src={ad.asset_url ?? undefined}
          muted
          loop
          playsInline
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
    </div>
  );
}

/** The tag chips a card and a row share: angle code first, then the telling dimensions. */
function cardTags(ad: LibraryAd, angleCode: string | null): string[] {
  const out: string[] = [];
  const code = angleCode ?? (ad.angle ? ad.angle.split(' ')[0] : null);
  if (code) out.push(code);
  for (const d of CARD_DIMENSIONS) {
    const v = ad.dimensions?.[d];
    if (v) out.push(v);
  }
  return out.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Card — one tile of the mosaic.
// ---------------------------------------------------------------------------

interface ItemProps {
  ad: LibraryAd;
  currency: string | null;
  eco: Economics;
  angleCode: string | null;
  t: T;
  f: F;
  onOpen: () => void;
}

function Card({ ad, currency, eco, angleCode, t, f, onOpen }: ItemProps) {
  const tags = cardTags(ad, angleCode);
  const metrics: { label: string; value: string; cls?: string }[] = [
    { label: t('meta.col.spend'), value: f.money(ad.spend, currency) },
    { label: t('meta.col.purchases'), value: f.num(ad.purchases) },
    { label: t('meta.col.cpa'), value: ad.cpa == null ? '—' : f.money(ad.cpa, currency) },
    { label: t('meta.col.roas'), value: f.ratio(ad.roas), cls: roasClass(ad.roas, eco) },
    { label: t('meta.col.hook'), value: f.pct(ad.hook_rate) },
    { label: t('meta.col.hold'), value: f.pct(ad.hold_rate) },
  ];

  return (
    <button
      onClick={onOpen}
      className="text-left rounded-xl border border-line bg-surface overflow-hidden hover:border-line-strong hover:shadow-sm transition-all focus:outline-none focus:border-accent"
    >
      <div className="relative">
        <Media ad={ad} className="aspect-[4/5] w-full" />
        {ad.status && (
          <span className={`${chip} absolute top-2 left-2 ${statusClass(ad.status)}`}>{statusLabel(t, ad.status)}</span>
        )}
        <span className={`${chip} absolute top-2 right-2 bg-overlay/70 text-on-accent`}>
          {formatLabel(t, formatOf(ad))}
        </span>
        {ad.duration != null && (
          <span className={`absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-overlay/70 text-[10px] text-on-accent ${mono}`}>
            {Math.round(ad.duration)}s
          </span>
        )}
      </div>

      <div className="p-3">
        <div className="flex items-start gap-2">
          <p className="text-sm font-medium text-ink leading-snug line-clamp-2 flex-1" title={ad.ad_name}>{ad.ad_name}</p>
          {ad.analyzed && (
            <CheckCircle2 className="w-4 h-4 text-ok shrink-0" aria-label={t('library.analyzed.yes')} />
          )}
        </div>

        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
          {metrics.map((m) => (
            <div key={m.label} className="flex items-baseline justify-between gap-2 text-xs">
              <dt className="text-ink-4">{m.label}</dt>
              <dd className={`${num} ${m.cls ?? 'text-ink'}`}>{m.value}</dd>
            </div>
          ))}
        </dl>

        {(tags.length > 0 || ad.verdict !== 'sin_datos') && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            {ad.verdict !== 'sin_datos' && (
              <span className={`${chip} ${VERDICT_CLASS[ad.verdict]}`}>{t(VERDICT_KEY[ad.verdict])}</span>
            )}
            {tags.map((x, i) => (
              <span key={`${i}-${x}`} className={tag} title={x}>{x}</span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Row — the same ad as one compact line in the list view.
// ---------------------------------------------------------------------------

function Row({ ad, currency, eco, angleCode, t, f, onOpen }: ItemProps) {
  const tags = cardTags(ad, angleCode);
  const cell = `px-3 py-2 text-right ${num}`;

  return (
    <tr onClick={onOpen} className="border-b border-line last:border-0 hover:bg-inset/60 transition-colors cursor-pointer">
      <td className="px-3 py-2">
        <div className="flex items-center gap-3 min-w-[240px]">
          <Media ad={ad} className="w-12 h-[60px] shrink-0 rounded-md border border-line" />
          <div className="min-w-0">
            <p className="font-medium text-ink truncate max-w-[280px]" title={ad.ad_name}>{ad.ad_name}</p>
            <p className={`text-[11px] text-ink-4 ${mono}`}>
              {statusLabel(t, ad.status)} · {f.date(ad.first_date)} → {f.date(ad.last_date)} · {t('common.days', { n: ad.days })}
              {ad.analyzed && <CheckCircle2 className="inline w-3 h-3 text-ok ml-1 align-[-2px]" aria-label={t('library.analyzed.yes')} />}
            </p>
          </div>
        </div>
      </td>
      <td className={cell}>{f.money(ad.spend, currency)}</td>
      <td className={cell}>{f.num(ad.purchases)}</td>
      <td className={cell}>{ad.cpa == null ? '—' : f.money(ad.cpa, currency)}</td>
      <td className={`${cell} ${roasClass(ad.roas, eco)}`}>{f.ratio(ad.roas)}</td>
      <td className={cell}>{f.pct(ad.hook_rate)}</td>
      <td className={cell}>{f.pct(ad.hold_rate)}</td>
      <td className={cell}>{f.pct(ad.cvr)}</td>
      <td className="px-3 py-2">
        <span className={`${chip} ${VERDICT_CLASS[ad.verdict]}`}>{t(VERDICT_KEY[ad.verdict])}</span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1 min-w-[160px]">
          {tags.length === 0 ? (
            <span className="text-xs text-ink-4">{t('library.unclassified')}</span>
          ) : (
            tags.map((x, i) => <span key={`${i}-${x}`} className={tag} title={x}>{x}</span>)
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Drawer — the whole picture of one ad, on the right, over a translucent veil.
// ---------------------------------------------------------------------------

function Drawer({
  ad, currency, eco, t, f, onClose,
}: { ad: LibraryAd; currency: string | null; eco: Economics; t: T; f: F; onClose: () => void }) {
  const [copied, setCopied] = useState<'name' | 'id' | null>(null);
  const video = isVideo(ad) && Boolean(ad.asset_url);
  const href = analysisHref(ad);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async (what: 'name' | 'id') => {
    try {
      await navigator.clipboard.writeText(what === 'name' ? ad.ad_name : ad.ad_id);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard can be denied; the button simply does nothing visible.
    }
  };

  const metrics: { label: string; value: string; cls?: string }[] = [
    { label: t('meta.col.spend'), value: f.money(ad.spend, currency) },
    { label: t('meta.col.revenue'), value: f.money(ad.revenue, currency) },
    { label: t('meta.col.purchases'), value: f.num(ad.purchases) },
    { label: t('meta.col.cpa'), value: ad.cpa == null ? '—' : f.money(ad.cpa, currency) },
    { label: t('meta.col.roas'), value: f.ratio(ad.roas), cls: roasClass(ad.roas, eco) },
    { label: t('meta.col.hook'), value: f.pct(ad.hook_rate) },
    { label: t('meta.col.hold'), value: f.pct(ad.hold_rate) },
    { label: t('meta.col.ret75'), value: f.pct(ad.ret75) },
    { label: t('meta.col.cvr'), value: f.pct(ad.cvr) },
  ];

  const recent: { label: string; value: string; cls?: string }[] = [
    { label: t('meta.col.spend'), value: f.money(ad.recent?.spend ?? null, currency) },
    { label: t('meta.col.roas'), value: f.ratio(ad.recent?.roas ?? null), cls: ad.recent ? roasClass(ad.recent.roas, eco) : undefined },
    { label: t('meta.col.hook'), value: f.pct(ad.recent?.hook_rate ?? null) },
  ];

  const taxonomy: { label: string; value: string }[] = [
    { label: t('library.detail.persona'), value: ad.persona ?? '—' },
    { label: t('library.detail.angle'), value: ad.angle ?? '—' },
    { label: t('library.detail.concept'), value: ad.concept ?? '—' },
    {
      label: t('library.detail.source'),
      value: ad.taxonomy_source
        ? `${tOr(t, `library.source.${ad.taxonomy_source}`, ad.taxonomy_source)}${ad.taxonomy_confidence != null ? ` · ${f.pct(ad.taxonomy_confidence * 100, 0)}` : ''}`
        : '—',
    },
  ];

  const dims = ad.dimensions ?? {};
  const dimKeys = [
    ...DIMENSION_ORDER.filter((k) => dims[k]),
    ...Object.keys(dims).filter((k) => k !== 'hook' && !DIMENSION_ORDER.includes(k) && dims[k]).sort(),
  ];

  const btn = 'inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-line text-ink-2 hover:text-ink hover:border-line-strong';

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-overlay/60" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ad.ad_name}
        className="relative w-full max-w-2xl h-full overflow-y-auto bg-canvas border-l border-line"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 bg-canvas/95 backdrop-blur border-b border-line">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink break-words">{ad.ad_name}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {ad.status && <span className={`${chip} ${statusClass(ad.status)}`}>{statusLabel(t, ad.status)}</span>}
              {ad.verdict !== 'sin_datos' && (
                <span className={`${chip} ${VERDICT_CLASS[ad.verdict]}`}>{t(VERDICT_KEY[ad.verdict])}</span>
              )}
              {ad.analyzed && (
                <span className={`${chip} bg-ok-soft text-ok`}><Check className="w-3 h-3" />{t('library.analyzed.yes')}</span>
              )}
              <span className={`text-[10px] text-ink-3 ${mono}`}>
                {f.date(ad.first_date)} → {f.date(ad.last_date)} · {t('common.days', { n: ad.days })} · {ad.ad_id}
              </span>
            </div>
          </div>
          <button onClick={onClose} title={t('common.close')} className="p-1.5 rounded-md text-ink-2 hover:text-ink hover:bg-surface-2 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Preview */}
          <div className="rounded-lg border border-line overflow-hidden bg-overlay">
            {video ? (
              <video
                src={ad.asset_url ?? undefined}
                poster={ad.thumbnail_url ?? undefined}
                controls
                playsInline
                preload="metadata"
                className="w-full max-h-[440px] object-contain"
              />
            ) : ad.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.thumbnail_url} alt={ad.ad_name} className="w-full max-h-[440px] object-contain" />
            ) : (
              <div className="h-48 flex items-center justify-center text-ink-4">
                {isVideo(ad) ? <Film className="w-8 h-8" /> : <ImageIcon className="w-8 h-8" />}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {href ? (
              <Link href={href} className={`${btn} bg-accent-soft text-accent border-transparent hover:text-accent`}>
                <ExternalLink className="w-3.5 h-3.5" />
                {t('library.detail.openAnalysis')}
              </Link>
            ) : (
              <button disabled title={t('library.analyzed.no')} className={`${btn} opacity-50 cursor-not-allowed`}>
                <ExternalLink className="w-3.5 h-3.5" />
                {t('library.detail.openAnalysis')}
                <span className="text-[10px] text-ink-4">· {t('library.detail.notAnalyzed')}</span>
              </button>
            )}
            <button onClick={() => copy('name')} className={btn}>
              {copied === 'name' ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
              {t('library.detail.copyName')}
            </button>
            <button onClick={() => copy('id')} className={btn}>
              {copied === 'id' ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
              {t('library.detail.copyId')}
            </button>
          </div>

          {/* Metrics */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-ink-4 mb-2">{t('library.detail.metrics')}</h3>
            <div className="grid grid-cols-3 gap-2">
              {metrics.map((m) => (
                <div key={m.label} className="rounded-lg border border-line bg-surface px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-ink-4">{m.label}</p>
                  <p className={`text-sm font-semibold ${num} ${m.cls ?? 'text-ink'}`}>{m.value}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-ink-4 mt-3 mb-1.5">{t('library.detail.recent')}</p>
            <div className="grid grid-cols-3 gap-2">
              {recent.map((m) => (
                <div key={m.label} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-ink-4">{m.label}</p>
                  <p className={`text-sm font-semibold ${num} ${m.cls ?? 'text-ink'}`}>{m.value}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Taxonomy */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-ink-4 mb-2">{t('library.detail.taxonomy')}</h3>
            <dl className="rounded-lg border border-line bg-surface divide-y divide-line">
              {taxonomy.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-xs">
                  <dt className="text-ink-4 shrink-0">{row.label}</dt>
                  <dd className="text-ink-2 text-right break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Dimensions */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-ink-4 mb-2">{t('library.detail.dimensions')}</h3>
            {dims.hook && (
              <blockquote className="mb-2 rounded-lg border-l-2 border-accent bg-accent-soft/60 px-3 py-2 text-sm text-ink-2 italic">
                “{dims.hook}”
              </blockquote>
            )}
            {dimKeys.length === 0 ? (
              <p className="text-xs text-ink-4">{t('library.detail.noDimensions')}</p>
            ) : (
              <dl className="rounded-lg border border-line bg-surface divide-y divide-line">
                {dimKeys.map((k) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-xs">
                    <dt className="text-ink-4 shrink-0 capitalize">{dimLabel(t, k)}</dt>
                    <dd className="text-ink-2 text-right break-words">{dims[k]}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
