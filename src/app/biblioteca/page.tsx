'use client';

// =============================================================================
// Library — every ad the account has spent on, as one row each: the creative
// itself (thumbnail, video on hover), what it cost, what it returned, and where
// it sits in the tree. Reads GET /api/library?brand= (already sorted by spend).
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Film, Image as ImageIcon, Library, Search, X, ArrowUpDown } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { useT, useFormatters } from '@/lib/i18n';

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
  memoryTo?: string | null;
  personas?: Named[];
  angles?: Named[];
  concepts?: Named[];
  error?: string;
}

type SortKey = 'spend' | 'roas' | 'cpa' | 'hook_rate';

const input =
  'rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent';
const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium';
const num = 'text-right font-[family-name:var(--font-mono)] tabular-nums whitespace-nowrap';

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

export default function LibraryPage() {
  const router = useRouter();
  const t = useT();
  const f = useFormatters();
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();

  const [ads, setAds] = useState<LibraryAd[]>([]);
  const [currency, setCurrency] = useState<string | null>(null);
  const [memoryTo, setMemoryTo] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Named[]>([]);
  const [angles, setAngles] = useState<Named[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [persona, setPersona] = useState('');
  const [angle, setAngle] = useState('');
  const [format, setFormat] = useState('');
  const [analyzed, setAnalyzed] = useState('');
  const [verdict, setVerdict] = useState('');
  const [sort, setSort] = useState<SortKey>('spend');

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

  const formats = useMemo(() => {
    const set = new Set<string>();
    for (const ad of ads) set.add(formatOf(ad));
    return [...set].sort();
  }, [ads]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = ads.filter((ad) => {
      if (needle && !ad.ad_name.toLowerCase().includes(needle)) return false;
      if (persona && ad.persona_id !== persona) return false;
      if (angle && ad.angle_id !== angle) return false;
      if (format && formatOf(ad) !== format) return false;
      if (analyzed === 'yes' && !ad.analyzed) return false;
      if (analyzed === 'no' && ad.analyzed) return false;
      if (verdict && ad.verdict !== verdict) return false;
      return true;
    });
    if (sort === 'spend') return filtered;
    const dir = sort === 'cpa' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [ads, q, persona, angle, format, analyzed, verdict, sort]);

  const totals = useMemo(
    () => ({ spend: rows.reduce((s, a) => s + a.spend, 0), count: rows.length }),
    [rows],
  );

  const dirty = Boolean(q || persona || angle || format || analyzed || verdict);

  const clear = () => {
    setQ('');
    setPersona('');
    setAngle('');
    setFormat('');
    setAnalyzed('');
    setVerdict('');
  };

  const open = (ad: LibraryAd) => {
    if (!ad.creative_id) return;
    router.push(`${ad.creative_type === 'image' ? '/analyze-image' : '/analyze'}?id=${ad.creative_id}`);
  };

  const sortBtn = (key: SortKey, label: string, tip: string) => (
    <button
      onClick={() => setSort(key)}
      title={tip}
      className={`inline-flex items-center gap-1 ${sort === key ? 'text-ink font-semibold' : 'hover:text-ink-2'}`}
    >
      {label}
      <ArrowUpDown className={`w-3 h-3 ${sort === key ? 'opacity-100' : 'opacity-30'}`} />
    </button>
  );

  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-6 py-8">
        <div className="max-w-[1400px] mx-auto">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-bold font-[family-name:var(--font-mono)] tracking-tight">
                {t('library.title')}
                {activeBrand ? ` · ${activeBrand.name}` : ''}
              </h1>
              <p className="text-sm text-ink-4 mt-1">{t('library.subtitle')}</p>
            </div>
            {memoryTo && (
              <p className="text-xs text-ink-4 font-[family-name:var(--font-mono)]">
                {t('library.memoryTo', { date: f.date(memoryTo) })}
              </p>
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
                  {formats.map((x) => (
                    <option key={x} value={x}>{t(`library.format.${x}`) === `library.format.${x}` ? x : t(`library.format.${x}`)}</option>
                  ))}
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

                {dirty && (
                  <button
                    onClick={clear}
                    className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink px-2 py-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    {t('library.clear')}
                  </button>
                )}

                <p className="text-xs text-ink-4 ml-auto font-[family-name:var(--font-mono)]">
                  {t('library.showing', { n: totals.count, spend: f.money(totals.spend, currency, { compact: true }) })}
                </p>
              </div>

              {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-surface p-12 text-center text-sm text-ink-3">
                  {t('library.emptyFiltered')}
                </div>
              ) : (
                <div className="rounded-xl border border-line bg-surface overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-ink-4 border-b border-line">
                        <th className="text-left font-medium px-3 py-2">{t('library.col.creative')}</th>
                        <th className="text-left font-medium px-3 py-2">{t('meta.col.verdict')}</th>
                        <th className="text-right font-medium px-3 py-2">{sortBtn('spend', t('meta.col.spend'), t('meta.col.spend.tip'))}</th>
                        <th className="text-right font-medium px-3 py-2">{sortBtn('roas', t('meta.col.roas'), t('meta.col.roas.tip'))}</th>
                        <th className="text-right font-medium px-3 py-2">{sortBtn('cpa', t('meta.col.cpa'), t('meta.col.cpa.tip'))}</th>
                        <th className="text-right font-medium px-3 py-2">{sortBtn('hook_rate', t('meta.col.hook'), t('meta.col.hook.tip'))}</th>
                        <th className="text-left font-medium px-3 py-2">{t('library.col.taxonomy')}</th>
                        <th className="text-left font-medium px-3 py-2">{t('meta.col.analysis')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((ad) => (
                        <Row key={ad.ad_id} ad={ad} currency={currency} t={t} f={f} onOpen={() => open(ad)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {error && <p className="text-xs text-danger/80 mt-6">{error}</p>}
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// One ad. The thumbnail turns into the muted, looping video while hovered, so
// the creative can be judged without leaving the list.
// ---------------------------------------------------------------------------

function Row({
  ad,
  currency,
  t,
  f,
  onOpen,
}: {
  ad: LibraryAd;
  currency: string | null;
  t: (key: string, vars?: Record<string, string | number | null | undefined>) => string;
  f: ReturnType<typeof useFormatters>;
  onOpen: () => void;
}) {
  const [hover, setHover] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const video = isVideo(ad) && Boolean(ad.asset_url);
  const clickable = Boolean(ad.creative_id);
  const recentRoas = ad.recent?.roas ?? null;
  const drop = ad.roas != null && recentRoas != null && ad.recent!.spend > 0 && recentRoas < ad.roas * 0.7;

  return (
    <tr
      onClick={clickable ? onOpen : undefined}
      className={`border-b border-line last:border-0 hover:bg-inset/60 transition-colors ${clickable ? 'cursor-pointer' : ''}`}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-3 min-w-[240px]">
          <div
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => {
              setHover(false);
              videoRef.current?.pause();
            }}
            className="relative w-12 h-[68px] shrink-0 rounded-md overflow-hidden bg-canvas border border-line"
          >
            {ad.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.thumbnail_url} alt={ad.ad_name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-line-strong">
                {video ? <Film className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
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
            {ad.duration != null && (
              <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-overlay/70 text-[9px] text-on-accent font-[family-name:var(--font-mono)]">
                {Math.round(ad.duration)}s
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-ink truncate max-w-[280px]" title={ad.ad_name}>
              {ad.ad_name}
            </p>
            <p className="text-[11px] text-ink-4 font-[family-name:var(--font-mono)]">
              {f.date(ad.first_date)} → {f.date(ad.last_date)} · {t('common.days', { n: ad.days })}
            </p>
          </div>
        </div>
      </td>

      <td className="px-3 py-2">
        <span className={`${chip} ${VERDICT_CLASS[ad.verdict]}`}>{t(VERDICT_KEY[ad.verdict])}</span>
      </td>

      <td className={`px-3 py-2 ${num}`}>{f.money(ad.spend, currency)}</td>

      <td className={`px-3 py-2 ${num}`}>
        {f.ratio(ad.roas)}
        {drop && (
          <span className="ml-1 text-[10px] text-warn" title={t('library.recentRoas', { roas: f.ratio(recentRoas) })}>
            ↓{f.ratio(recentRoas)}
          </span>
        )}
      </td>

      <td className={`px-3 py-2 ${num}`}>{ad.cpa == null ? '—' : f.money(ad.cpa, currency)}</td>

      <td className={`px-3 py-2 ${num}`}>{f.pct(ad.hook_rate)}</td>

      <td className="px-3 py-2">
        {ad.persona || ad.angle || ad.concept ? (
          <div className="min-w-[180px]">
            <p className="text-xs text-ink-2 truncate max-w-[260px]">
              {[ad.persona, ad.angle, ad.concept].filter(Boolean).join(' › ')}
            </p>
            {ad.taxonomy_source && (
              <p className="text-[10px] text-ink-4">
                {t(`library.source.${ad.taxonomy_source}`)}
                {ad.taxonomy_confidence != null ? ` · ${f.pct(ad.taxonomy_confidence * 100, 0)}` : ''}
              </p>
            )}
          </div>
        ) : (
          <span className="text-xs text-ink-4">{t('library.unclassified')}</span>
        )}
      </td>

      <td className="px-3 py-2">
        {ad.analyzed ? (
          <span className={`${chip} bg-ok-soft text-ok`}>{t('library.analyzed.yes')}</span>
        ) : (
          <span className={`${chip} bg-inset text-ink-4`}>{t('library.analyzed.no')}</span>
        )}
      </td>
    </tr>
  );
}
