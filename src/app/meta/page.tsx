'use client';

// =============================================================================
// Meta — the performance table. One row per Meta ad (ad_id), the canonical
// metrics (hook = 3s views / impressions, hold = ThruPlays / 3s views,
// retention over 3s viewers), the verdict against the brand economics, and the
// link to the analyzed creative. Money is always shown with the account's ISO
// currency code; thresholds live in that currency too.
// =============================================================================

import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, Loader2, X, Copy, Check, Film, AlertTriangle,
  Settings2, CheckCircle2, CircleDashed, ExternalLink, Sparkles, Info,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { useT, useFormatters } from '@/lib/i18n';
import { parseMetaExport, verdictFor, metaAiPrompt, resolveEconomics, type Economics, type Verdict } from '@/lib/meta';
import type { AdAggregate, AdDailyRow } from '@/lib/metrics';

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------
interface AdRow extends AdAggregate {
  meta_id: string | null;
  created_date: string | null;
  dossier_meta: string | null;
  dossier_video: string | null;
  creative_id: string | null;
  analyzed: boolean;
  has_dossier: boolean;
  fusion: string | null;
  fusion_at: string | null;
  asset_kind: string | null;
  asset_url: string | null;
  thumbnail_url: string | null;
}

type SortKey = keyof Pick<AdRow,
  'ad_name' | 'spend' | 'revenue' | 'roas' | 'purchases' | 'cpa' | 'cpm' | 'hook_rate' | 'hold_rate' |
  'ret25' | 'ret50' | 'ret75' | 'freq' | 'cost_atc' | 'link_clicks' | 'cpc' | 'cvr' | 'days'>;

const RANGES = [
  { id: '7', key: 'meta.range.7', days: 7 },
  { id: '14', key: 'meta.range.14', days: 14 },
  { id: '30', key: 'meta.range.30', days: 30 },
  { id: 'all', key: 'meta.range.all', days: 0 },
] as const;

type Fmt = ReturnType<typeof useFormatters>;
interface Col { key: SortKey; label: string; tip: string; higherBetter: boolean | null; fmt: (a: AdRow, f: Fmt, cur: string | null) => string }
const COLS: Col[] = [
  { key: 'spend', label: 'meta.col.spend', tip: 'meta.col.spend.tip', higherBetter: null, fmt: (a, f, c) => f.money(a.spend, c) },
  { key: 'revenue', label: 'meta.col.revenue', tip: 'meta.col.revenue.tip', higherBetter: true, fmt: (a, f, c) => (a.revenue ? f.money(a.revenue, c) : '—') },
  { key: 'roas', label: 'meta.col.roas', tip: 'meta.col.roas.tip', higherBetter: true, fmt: (a, f) => f.ratio(a.roas) },
  { key: 'purchases', label: 'meta.col.purchases', tip: 'meta.col.purchases.tip', higherBetter: true, fmt: (a, f) => (a.purchases ? f.num(a.purchases) : '—') },
  { key: 'cpa', label: 'meta.col.cpa', tip: 'meta.col.cpa.tip', higherBetter: false, fmt: (a, f, c) => f.money(a.cpa, c) },
  { key: 'hook_rate', label: 'meta.col.hook', tip: 'meta.col.hook.tip', higherBetter: true, fmt: (a, f) => f.pct(a.hook_rate, 1) },
  { key: 'hold_rate', label: 'meta.col.hold', tip: 'meta.col.hold.tip', higherBetter: true, fmt: (a, f) => f.pct(a.hold_rate, 0) },
  { key: 'ret50', label: 'meta.col.ret50', tip: 'meta.col.ret50.tip', higherBetter: true, fmt: (a, f) => f.pct(a.ret50, 0) },
  { key: 'ret75', label: 'meta.col.ret75', tip: 'meta.col.ret75.tip', higherBetter: true, fmt: (a, f) => f.pct(a.ret75, 0) },
  { key: 'cvr', label: 'meta.col.cvr', tip: 'meta.col.cvr.tip', higherBetter: true, fmt: (a, f) => f.pct(a.cvr, 2) },
  { key: 'cpm', label: 'meta.col.cpm', tip: 'meta.col.cpm.tip', higherBetter: false, fmt: (a, f, c) => f.money(a.cpm, c) },
  { key: 'cpc', label: 'meta.col.cpc', tip: 'meta.col.cpc.tip', higherBetter: false, fmt: (a, f, c) => f.money(a.cpc, c) },
  { key: 'cost_atc', label: 'meta.col.costAtc', tip: 'meta.col.costAtc.tip', higherBetter: false, fmt: (a, f, c) => f.money(a.cost_atc, c) },
  { key: 'freq', label: 'meta.col.freq', tip: 'meta.col.freq.tip', higherBetter: false, fmt: (a, f) => f.ratio(a.freq, 1) },
  { key: 'link_clicks', label: 'meta.col.clicks', tip: 'meta.col.clicks.tip', higherBetter: true, fmt: (a, f) => (a.link_clicks ? f.num(a.link_clicks) : '—') },
];

/** Verdict chips: state is encoded in shape (border + weight) as well as color. */
const VERDICT_STYLE: Record<Verdict['id'], string> = {
  ganador: 'bg-ok-soft text-ok border-ok/40 font-semibold',
  prometedor: 'bg-warn-soft text-warn border-warn/40',
  dejar: 'bg-warn-soft text-warn border-warn/40 border-dashed',
  apagar: 'bg-danger-soft text-danger border-danger/40 font-semibold',
  sin_datos: 'bg-surface-2 text-ink-3 border-line',
};

export default function MetaPage() {
  const router = useRouter();
  const t = useT();
  const f = useFormatters();
  const { me, activeBrand, activeBrandId, setActiveBrandId, refresh } = useMe();

  const [ads, setAds] = useState<AdRow[]>([]);
  const [currency, setCurrency] = useState<string | null>(null);
  const [currencySource, setCurrencySource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [memoryFrom, setMemoryFrom] = useState<string | null>(null);
  const [memoryTo, setMemoryTo] = useState<string | null>(null);
  const [range, setRange] = useState<string>('7');
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDesc, setSortDesc] = useState(true);
  const [onlyActive, setOnlyActive] = useState(true);
  const [selected, setSelected] = useState<AdRow | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showEco, setShowEco] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const eco: Economics = useMemo(() => resolveEconomics(activeBrand?.economics), [activeBrand]);

  const load = useCallback(async () => {
    if (!activeBrandId) return;
    setLoading(true);
    try {
      // First call: full range (also gives the memory bounds and currency)
      const probe = await fetch(`/api/meta/ads?brand=${activeBrandId}`).then((x) => x.json());
      if (probe.error) throw new Error(probe.error);
      setMemoryFrom(probe.memoryFrom ?? null);
      setMemoryTo(probe.memoryTo ?? null);
      setCurrency(probe.currency ?? null);
      setCurrencySource(probe.currencySource ?? null);

      const r = RANGES.find((x) => x.id === range);
      if (!r || r.days === 0 || !probe.memoryTo) {
        setAds(probe.ads ?? []);
        return;
      }
      // The range is measured back from the last day with data (memoryTo)
      const d = new Date(`${probe.memoryTo}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (r.days - 1));
      const from = d.toISOString().slice(0, 10);
      const res = await fetch(`/api/meta/ads?brand=${activeBrandId}&from=${from}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAds(data.ads ?? []);
    } catch {
      setAds([]);
    } finally {
      setLoading(false);
    }
  }, [activeBrandId, range]);

  useEffect(() => { load(); }, [load]);

  // -------------------------------------------------------------------------
  // CSV upload (fallback path)
  // -------------------------------------------------------------------------
  const handleFile = useCallback(async (file: File) => {
    if (!activeBrandId) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const text = await file.text();
      const parsed = parseMetaExport(text);
      if (!parsed.rows.length) {
        setUploadMsg({ ok: false, text: parsed.warnings.join(' · ') || t('meta.upload.empty') });
        return;
      }
      const res = await fetch('/api/meta/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: activeBrandId, rows: parsed.rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('meta.upload.error'));
      const warn = parsed.warnings.length ? t('meta.upload.warning', { w: parsed.warnings.join('; ') }) : '';
      setUploadMsg({ ok: true, text: t('meta.upload.done', { ads: data.ads, days: data.days, from: parsed.dateFrom, to: parsed.dateTo, warn }) });
      await load();
    } catch (err) {
      setUploadMsg({ ok: false, text: err instanceof Error ? err.message : t('meta.upload.processingError') });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [activeBrandId, load, t]);

  // -------------------------------------------------------------------------
  // Sort + filter + heat map
  // -------------------------------------------------------------------------
  const visible = useMemo(() => {
    let rows = ads;
    if (onlyActive) rows = rows.filter((a) => !a.status || a.status.toLowerCase().includes('active'));
    return [...rows].sort((a, b) => {
      const va = a[sortKey]; const vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return sortDesc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
      return sortDesc ? (vb as number) - (va as number) : (va as number) - (vb as number);
    });
  }, [ads, onlyActive, sortKey, sortDesc]);

  const heat = useMemo(() => {
    const map = new Map<SortKey, (v: number | null) => string>();
    for (const c of COLS) {
      if (c.higherBetter === null) { map.set(c.key, () => ''); continue; }
      const vals = visible.map((a) => a[c.key] as number | null).filter((v): v is number => v != null && Number.isFinite(v)).sort((x, y) => x - y);
      if (vals.length < 3) { map.set(c.key, () => ''); continue; }
      const lo = vals[Math.floor(vals.length * 0.1)];
      const hi = vals[Math.floor(vals.length * 0.9)] || lo + 1;
      map.set(c.key, (v) => {
        if (v == null) return '';
        let s = hi === lo ? 0.5 : (v - lo) / (hi - lo);
        s = Math.max(0, Math.min(1, s));
        if (!c.higherBetter) s = 1 - s;
        // danger (0) → neutral → ok (1), via the semantic tokens
        return s > 0.5
          ? `color-mix(in oklab, var(--color-ok) ${Math.round((s - 0.5) * 2 * 28)}%, transparent)`
          : `color-mix(in oklab, var(--color-danger) ${Math.round((0.5 - s) * 2 * 28)}%, transparent)`;
      });
    }
    return map;
  }, [visible]);

  const totals = useMemo(() => {
    const spend = visible.reduce((s, a) => s + a.spend, 0);
    const revenue = visible.reduce((s, a) => s + (a.revenue ?? 0), 0);
    const purchases = visible.reduce((s, a) => s + (a.purchases ?? 0), 0);
    return { spend, revenue, purchases, roas: spend > 0 ? revenue / spend : 0 };
  }, [visible]);

  const winners = useMemo(() => visible.filter((a) => verdictFor(a, eco, currency).id === 'ganador'), [visible, eco, currency]);
  const pendingWinners = winners.filter((w) => !w.analyzed);
  const metricsPending = useMemo(() => visible.some((a) => a.video_metrics_pending), [visible]);

  const sortBy = (k: SortKey) => {
    if (sortKey === k) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(true); }
  };

  return (
    <main className="flex-1 min-h-screen">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-4 sm:px-6 py-6">
        <div className="max-w-[1400px] mx-auto">
          {/* Top bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h1 className="text-xl font-semibold font-[family-name:var(--font-serif)] tracking-tight text-ink">
                {t('meta.title')} · {activeBrand?.name ?? ''}
                {currency && <span className="ml-2 text-xs font-[family-name:var(--font-mono)] text-ink-3 align-middle">{currency}</span>}
              </h1>
              <p className="text-xs text-ink-3 mt-0.5 font-[family-name:var(--font-mono)]">
                {memoryFrom && memoryTo ? t('meta.memory', { from: memoryFrom, to: memoryTo }) : t('meta.noData')}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex rounded-md border border-line overflow-hidden">
                {RANGES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRange(r.id)}
                    className={`px-3 py-1.5 text-xs transition-colors ${range === r.id ? 'bg-surface-2 text-ink font-medium' : 'text-ink-2 hover:text-ink'}`}
                  >
                    {t(r.key)}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer select-none px-2">
                <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="accent-accent" />
                {t('meta.onlyActive')}
              </label>
              <button
                onClick={() => setShowEco((v) => !v)}
                className="p-2 rounded-md border border-line text-ink-2 hover:text-ink hover:border-line-strong transition-colors"
                title={t('meta.economics', { breakeven: eco.breakeven, target: eco.target, kill: f.money(eco.kill, currency) })}
              >
                <Settings2 className="w-4 h-4" />
              </button>
              <Link href="/meta/barrido" className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-strong">
                {t('meta.autoSweep')}
              </Link>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 text-sm px-4 py-2 rounded-md border border-line text-ink-2 hover:text-ink disabled:opacity-60"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {t('meta.uploadExport')}
              </button>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          </div>

          {showEco && activeBrand && (
            <EconomicsEditor
              brandId={activeBrand.id}
              eco={eco}
              currency={currency}
              currencySource={currencySource}
              onSaved={() => { setShowEco(false); refresh(); }}
              onClose={() => setShowEco(false)}
            />
          )}

          {uploadMsg && (
            <div className={`mb-4 rounded-md border px-4 py-2.5 text-sm flex items-start gap-2 ${uploadMsg.ok ? 'border-ok/40 bg-ok-soft text-ok' : 'border-danger/40 bg-danger-soft text-danger'}`}>
              {uploadMsg.ok ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{uploadMsg.text}</span>
              <button onClick={() => setUploadMsg(null)} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {metricsPending && (
            <div className="mb-4 rounded-md border border-line bg-surface px-4 py-2.5 text-xs text-ink-2 flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-ink-3" />
              <span>{t('meta.metricsPending')}</span>
            </div>
          )}

          {/* Range summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Stat label={t('meta.stat.spend')} value={f.money(totals.spend, currency)} />
            <Stat label={t('meta.stat.revenue')} value={f.money(totals.revenue, currency)} />
            <Stat
              label={t('meta.stat.roas', { breakeven: eco.breakeven })}
              value={totals.roas.toFixed(2)}
              tone={totals.roas >= eco.target ? 'ok' : totals.roas >= eco.breakeven ? 'warn' : 'danger'}
            />
            <Stat label={t('meta.stat.purchases')} value={f.num(totals.purchases)} />
          </div>

          {/* Winners pending analysis */}
          {pendingWinners.length > 0 && (
            <div className="mb-5 rounded-md border border-warn/40 bg-warn-soft px-4 py-3">
              <p className="text-sm text-warn font-medium flex items-center gap-2">
                <CircleDashed className="w-4 h-4" />
                {pendingWinners.length === 1 ? t('meta.pendingWinners.one') : t('meta.pendingWinners.many', { n: pendingWinners.length })}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {pendingWinners.map((w) => (
                  <button key={w.ad_id} onClick={() => setSelected(w)} className="text-xs px-3 py-1.5 rounded-md border border-warn/40 text-ink hover:bg-warn/10 transition-colors">
                    {w.ad_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-md border border-dashed border-line bg-surface p-12 text-center">
              <Upload className="w-10 h-10 text-ink-4 mx-auto mb-4" />
              <p className="text-ink font-medium">{t('meta.empty.title')}</p>
              <p className="text-sm text-ink-3 mt-2 max-w-md mx-auto">{t('meta.empty.body')}</p>
            </div>
          ) : (
            <div className="rounded-md border border-line overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap tabular-nums">
                <thead>
                  <tr className="border-b border-line bg-surface text-ink-2">
                    <th className="text-left px-3 py-2 font-medium sticky left-0 bg-surface z-10 cursor-pointer" onClick={() => sortBy('ad_name')}>
                      {t('meta.col.ad', { n: visible.length })}
                    </th>
                    <th className="text-left px-2 py-2 font-medium">{t('meta.col.verdict')}</th>
                    <th className="text-center px-2 py-2 font-medium" title={t('meta.col.analysis.tip')}>{t('meta.col.analysis')}</th>
                    {COLS.map((c) => (
                      <th
                        key={c.key}
                        onClick={() => sortBy(c.key)}
                        title={t(c.tip)}
                        className={`text-right px-2.5 py-2 font-medium cursor-pointer hover:text-ink ${sortKey === c.key ? 'text-accent' : ''}`}
                      >
                        {t(c.label)}{sortKey === c.key ? (sortDesc ? ' ↓' : ' ↑') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a) => {
                    const v = verdictFor(a, eco, currency);
                    return (
                      <tr key={a.ad_id} onClick={() => setSelected(a)} className="border-b border-line/60 hover:bg-surface-2 cursor-pointer transition-colors">
                        <td className="px-3 py-1.5 sticky left-0 bg-canvas max-w-[260px]">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.status?.toLowerCase().includes('active') ? 'bg-ok' : 'bg-ink-4'}`} />
                            <span className="truncate text-ink" title={`${a.ad_name} · ${a.ad_id}`}>{a.ad_name}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <span title={v.why} className={`inline-block px-2 py-0.5 rounded border text-[10px] ${VERDICT_STYLE[v.id]}`}>{t(v.labelKey)}</span>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {v.id === 'ganador' || v.id === 'prometedor' || a.analyzed || a.has_dossier ? (
                            a.analyzed ? <CheckCircle2 className="w-4 h-4 text-ok inline" aria-label={t('meta.analyzed')} />
                              : a.has_dossier ? <CircleDashed className="w-4 h-4 text-warn inline" aria-label={t('meta.partialDossier')} />
                              : <CircleDashed className="w-4 h-4 text-warn inline" aria-label={t('meta.needsAnalysis')} />
                          ) : <span className="text-ink-4">·</span>}
                        </td>
                        {COLS.map((c) => (
                          <td
                            key={c.key}
                            className="text-right px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-ink-2"
                            style={{ background: heat.get(c.key)?.(a[c.key] as number | null) || undefined }}
                          >
                            {c.fmt(a, f, currency)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {selected && activeBrandId && (
        <AdDetail
          ad={selected}
          brandId={activeBrandId}
          eco={eco}
          currency={currency}
          onClose={() => setSelected(null)}
          onSaved={load}
          onAnalyze={(name) => router.push(`/studio?ad=${encodeURIComponent(name)}`)}
        />
      )}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'danger' }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-ink';
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`text-lg font-semibold font-[family-name:var(--font-mono)] tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand economics editor — thresholds in the account currency (read-only)
// ---------------------------------------------------------------------------
function EconomicsEditor({ brandId, eco, currency, currencySource, onSaved, onClose }: {
  brandId: string; eco: Economics; currency: string | null; currencySource: string | null; onSaved: () => void; onClose: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<Economics>({ ...eco });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/brands/${brandId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ economics: form }),
      });
      onSaved();
    } finally { setSaving(false); }
  };
  const fields: Array<[keyof Economics, string]> = [
    ['breakeven', 'meta.eco.breakeven'], ['target', 'meta.eco.target'], ['kill', 'meta.eco.kill'],
  ];
  return (
    <div className="mb-4 rounded-md border border-line bg-surface p-4 flex flex-wrap items-end gap-3">
      <div className="text-xs text-ink-2">
        {t('meta.eco.currency')}
        <div className="mt-1 h-[34px] w-32 rounded-md border border-line bg-inset px-2.5 flex items-center text-sm font-[family-name:var(--font-mono)] text-ink-3">
          {currency ?? t('meta.eco.currencyPending')}{currencySource === 'meta' && currency ? '' : ''}
        </div>
      </div>
      {fields.map(([k, label]) => (
        <label key={k} className="text-xs text-ink-2">
          {t(label)}{k === 'kill' && currency ? ` (${currency})` : ''}
          <input
            type="number"
            step="0.01"
            value={String(form[k] ?? '')}
            onChange={(e) => setForm((prev) => ({ ...prev, [k]: Number(e.target.value) }))}
            className="block mt-1 w-32 rounded-md border border-line bg-inset px-2.5 py-1.5 text-sm text-ink font-[family-name:var(--font-mono)] focus:border-accent outline-none"
          />
        </label>
      ))}
      <button onClick={save} disabled={saving} className="text-sm px-4 py-2 rounded-md bg-accent text-on-accent font-medium disabled:opacity-60">
        {saving ? t('common.saving') : t('common.save')}
      </button>
      <button onClick={onClose} className="text-sm px-3 py-2 rounded-md text-ink-2 hover:text-ink">{t('common.cancel')}</button>
      <p className="w-full text-[10px] text-ink-3">{t('meta.eco.help')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ad detail drawer
// ---------------------------------------------------------------------------
function AdDetail({ ad, brandId, eco, currency, onClose, onSaved, onAnalyze }: {
  ad: AdRow;
  brandId: string;
  eco: Economics;
  currency: string | null;
  onClose: () => void;
  onSaved: () => void;
  onAnalyze: (adName: string) => void;
}) {
  const router = useRouter();
  const t = useT();
  const f = useFormatters();
  const [daily, setDaily] = useState<AdDailyRow[]>([]);
  const [dossierMeta, setDossierMeta] = useState(ad.dossier_meta ?? '');
  const [dossierVideo, setDossierVideo] = useState(ad.dossier_video ?? '');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fusion, setFusion] = useState<string | null>(ad.fusion);
  const [fusing, setFusing] = useState(false);
  const [fusionError, setFusionError] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedFusion, setCopiedFusion] = useState(false);
  const v = verdictFor(ad, eco, currency);

  const generateFusion = async () => {
    setFusing(true);
    setFusionError(null);
    try {
      const res = await fetch('/api/fusion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, adId: ad.ad_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setFusion(data.fusion);
      onSaved();
    } catch (err) {
      setFusionError(err instanceof Error ? err.message : t('meta.detail.fusion.error'));
    } finally {
      setFusing(false);
    }
  };

  const copyAllData = async () => {
    const m = (n: number | null | undefined) => f.money(n, currency);
    const lines = [
      `AD: ${ad.ad_name} (meta ad_id ${ad.ad_id})`,
      `Verdict: ${t(v.labelKey)} — ${v.why}`,
      `Metrics (${ad.days} days, ${currency ?? '?'}): spend ${m(ad.spend)} · revenue ${m(ad.revenue)} · ROAS ${f.ratio(ad.roas)} · purchases ${f.num(ad.purchases)} · CPA ${m(ad.cpa)} · hook ${f.pct(ad.hook_rate)} · hold ${f.pct(ad.hold_rate, 0)} · ret25 ${f.pct(ad.ret25, 0)} · ret50 ${f.pct(ad.ret50, 0)} · ret75 ${f.pct(ad.ret75, 0)} · ret100 ${f.pct(ad.ret100, 0)} · CVR ${f.pct(ad.cvr, 2)} · CPM ${m(ad.cpm)} · CPC ${m(ad.cpc)} · cost/ATC ${m(ad.cost_atc)} · freq ${f.ratio(ad.freq, 1)} · clicks ${f.num(ad.link_clicks)}`,
      '',
      'DAILY SERIES:',
      ...daily.map((d) => `${d.date}: spend ${m(d.spend)}, ROAS ${f.ratio(d.roas)}, hook ${f.pct(d.hook_rate)}, freq ${f.ratio(d.freq, 1)}`),
    ];
    if (dossierMeta) lines.push('', 'META AI DOSSIER:', dossierMeta);
    if (dossierVideo) lines.push('', 'VIDEO NOTES:', dossierVideo);
    if (fusion) lines.push('', 'FUSED ANALYSIS:', fusion);
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  };

  useEffect(() => {
    fetch(`/api/meta/ads?brand=${brandId}&ad=${encodeURIComponent(ad.ad_id)}`)
      .then((r) => r.json())
      .then((d) => setDaily(d.daily ?? []))
      .catch(() => {});
  }, [ad.ad_id, brandId]);

  const saveDossier = async () => {
    if (!ad.meta_id) return;
    setSaving(true);
    try {
      await fetch(`/api/meta/ads/${ad.meta_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dossier_meta: dossierMeta, dossier_video: dossierVideo }),
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      onSaved();
    } finally { setSaving(false); }
  };

  const prompt = metaAiPrompt(ad, v, eco, currency);
  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const preview = ad.asset_kind === 'video' && ad.asset_url ? ad.asset_url : null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-ink/40" onClick={onClose}>
      <div className="w-full max-w-xl h-full overflow-y-auto bg-canvas border-l border-line p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink break-words font-[family-name:var(--font-serif)]">{ad.ad_name}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`inline-block px-2 py-0.5 rounded border text-[10px] ${VERDICT_STYLE[v.id]}`}>{t(v.labelKey)}</span>
              <span className="text-[10px] text-ink-3 font-[family-name:var(--font-mono)]">
                {t('meta.detail.daysWithData', { n: ad.days })}{ad.created_date ? t('meta.detail.created', { date: ad.created_date }) : ''} · {ad.ad_id}
              </span>
            </div>
            <p className="text-xs text-ink-2 mt-2">{v.why}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={copyAllData} title={t('meta.detail.copyAll.tip')} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-line text-ink-2 hover:text-ink hover:border-line-strong">
              {copiedAll ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
              {t('meta.detail.copyAll')}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md text-ink-2 hover:text-ink hover:bg-surface-2">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Creative preview — the asset being judged, large, plays on hover */}
        {(preview || ad.thumbnail_url) && (
          <div className="mb-4 rounded-md border border-line overflow-hidden bg-surface">
            {preview ? (
              <video
                src={preview}
                poster={ad.thumbnail_url ?? undefined}
                muted
                playsInline
                preload="metadata"
                className="w-full max-h-[360px] object-contain bg-ink"
                onMouseEnter={(e) => { void e.currentTarget.play(); }}
                onMouseLeave={(e) => { e.currentTarget.pause(); }}
                controls
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.thumbnail_url ?? ''} alt={ad.ad_name} className="w-full max-h-[360px] object-contain bg-ink" />
            )}
          </div>
        )}

        {/* Key metrics */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {([
            [t('meta.col.spend'), f.money(ad.spend, currency)],
            [t('meta.col.roas'), f.ratio(ad.roas)],
            [t('meta.col.cpa'), f.money(ad.cpa, currency)],
            [t('meta.col.hook'), f.pct(ad.hook_rate, 1)],
            [t('meta.col.hold'), f.pct(ad.hold_rate, 0)],
            [t('meta.col.ret75'), f.pct(ad.ret75, 0)],
          ] as Array<[string, string]>).map(([l, val]) => (
            <div key={l} className="rounded-md border border-line bg-surface px-3 py-2">
              <p className="text-[9px] uppercase tracking-wide text-ink-3">{l}</p>
              <p className="text-sm font-semibold font-[family-name:var(--font-mono)] tabular-nums text-ink">{val}</p>
            </div>
          ))}
        </div>

        {/* Daily series */}
        {daily.length > 1 && (
          <div className="mb-4 rounded-md border border-line p-3">
            <p className="text-[10px] uppercase tracking-wide text-ink-3 mb-2">{t('meta.detail.spendRoasByDay')}</p>
            <Sparkline daily={daily} eco={eco} currency={currency} />
          </div>
        )}

        {/* Creative analysis state */}
        <div className="mb-4 rounded-md border border-line p-4">
          <p className="text-[10px] uppercase tracking-wide text-ink-3 mb-2">{t('meta.detail.creative')}</p>
          {ad.creative_id ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-ok flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> {t('meta.detail.analyzedInLibrary')}</p>
              <button onClick={() => router.push(`/analyze?id=${ad.creative_id}`)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-line text-ink-2 hover:text-ink hover:border-line-strong">
                {t('common.viewAnalysis')} <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm text-warn flex items-center gap-2"><CircleDashed className="w-4 h-4" /> {t('meta.detail.needsExtraction')}</p>
              <button onClick={() => onAnalyze(ad.ad_name)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-on-accent font-medium">
                <Film className="w-3.5 h-3.5" /> {t('meta.detail.analyzeVideo')}
              </button>
            </div>
          )}
        </div>

        {/* Fused analysis: video × Meta */}
        <div className="mb-4 rounded-md border border-line p-4">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-[10px] uppercase tracking-wide text-ink-3 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> {t('meta.detail.fusion')}
            </p>
            <div className="flex items-center gap-2">
              {fusion && (
                <button
                  onClick={async () => { await navigator.clipboard.writeText(fusion); setCopiedFusion(true); setTimeout(() => setCopiedFusion(false), 1500); }}
                  className="flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink"
                >
                  {copiedFusion ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
                  {t('common.copy')}
                </button>
              )}
              <button onClick={generateFusion} disabled={fusing} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-on-accent font-medium disabled:opacity-60">
                {fusing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {fusing ? t('meta.detail.fusion.running') : fusion ? t('common.regenerate') : t('meta.detail.fusion.run')}
              </button>
            </div>
          </div>
          {fusionError && <p className="text-xs text-danger mb-2">{fusionError}</p>}
          {fusion ? (
            <div className="text-xs text-ink-2 whitespace-pre-wrap leading-relaxed max-h-[420px] overflow-y-auto rounded-md bg-inset p-3">{fusion}</div>
          ) : (
            <p className="text-xs text-ink-2">
              {t('meta.detail.fusion.help')}
              {!ad.creative_id && t('meta.detail.fusion.tip')}
            </p>
          )}
        </div>

        {/* Prompt for Meta AI */}
        <div className="mb-4 rounded-md border border-line p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wide text-ink-3">{t('meta.detail.metaAiPrompt')}</p>
            <button onClick={copyPrompt} className="flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink">
              {copied ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
          <p className="text-xs text-ink-2 whitespace-pre-wrap">{prompt}</p>
        </div>

        {/* Dossier */}
        <div className="rounded-md border border-line p-4">
          <p className="text-[10px] uppercase tracking-wide text-ink-3 mb-2">{t('meta.detail.dossier')}</p>
          <label className="text-xs text-ink-2">{t('meta.detail.dossier.meta')}</label>
          <textarea
            value={dossierMeta}
            onChange={(e) => setDossierMeta(e.target.value)}
            rows={4}
            className="mt-1 mb-3 w-full rounded-md border border-line bg-inset px-3 py-2 text-xs text-ink focus:border-accent outline-none resize-y"
            placeholder={t('meta.detail.dossier.meta.ph')}
          />
          <label className="text-xs text-ink-2">{t('meta.detail.dossier.video')}</label>
          <textarea
            value={dossierVideo}
            onChange={(e) => setDossierVideo(e.target.value)}
            rows={4}
            className="mt-1 mb-3 w-full rounded-md border border-line bg-inset px-3 py-2 text-xs text-ink focus:border-accent outline-none resize-y"
            placeholder={t('meta.detail.dossier.video.ph')}
          />
          <button onClick={saveDossier} disabled={saving || !ad.meta_id} className="text-sm px-4 py-2 rounded-md bg-accent text-on-accent font-medium disabled:opacity-60">
            {saving ? t('common.saving') : savedFlash ? `✓ ${t('common.saved')}` : t('meta.detail.dossier.save')}
          </button>
          <p className="text-[10px] text-ink-3 mt-2">{t('meta.detail.dossier.help')}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline: spend (bars) + ROAS (line) by day
// ---------------------------------------------------------------------------
function Sparkline({ daily, eco, currency }: { daily: AdDailyRow[]; eco: Economics; currency: string | null }) {
  const t = useT();
  const f = useFormatters();
  const W = 520, H = 110, pad = 4;
  const maxSpend = Math.max(...daily.map((d) => d.spend), 0.01);
  const roasVals = daily.map((d) => d.roas ?? (d.revenue != null && d.spend > 0 ? d.revenue / d.spend : null));
  const maxRoas = Math.max(...roasVals.filter((r): r is number => r != null), eco.target, 0.1);
  const bw = (W - pad * 2) / daily.length;
  const pts = roasVals
    .map((r, i) => (r == null ? null : `${pad + i * bw + bw / 2},${H - pad - (r / maxRoas) * (H - pad * 2)}`))
    .filter(Boolean)
    .join(' ');
  const targetY = H - pad - (eco.target / maxRoas) * (H - pad * 2);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }}>
        {daily.map((d, i) => (
          <rect
            key={d.date}
            x={pad + i * bw + 1}
            y={H - pad - (d.spend / maxSpend) * (H - pad * 2)}
            width={Math.max(1, bw - 2)}
            height={(d.spend / maxSpend) * (H - pad * 2)}
            fill="var(--color-accent)"
            opacity={0.35}
          >
            <title>{`${d.date}: ${f.money(d.spend, currency)} · ROAS ${f.ratio(roasVals[i])}`}</title>
          </rect>
        ))}
        <line x1={pad} x2={W - pad} y1={targetY} y2={targetY} stroke="var(--color-ok)" strokeDasharray="4 4" strokeWidth={1} opacity={0.6} />
        {pts && <polyline points={pts} fill="none" stroke="var(--color-ink)" strokeWidth={1.5} />}
      </svg>
      <div className="flex justify-between text-[9px] text-ink-3 px-1 font-[family-name:var(--font-mono)]">
        <span>{daily[0]?.date}</span>
        <span>— {t('meta.chart.roas')} · <span className="text-ok">- - {t('meta.chart.target', { target: eco.target })}</span> · <span className="text-accent">■ {t('meta.chart.spend')}</span></span>
        <span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
  );
}
