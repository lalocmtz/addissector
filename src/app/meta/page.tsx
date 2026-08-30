'use client';

// =============================================================================
// AdDNA — META: el motor de la plataforma.
// Sube el export del socio → memoria acumulativa por anuncio+día en Supabase →
// tabla con las columnas estrella → veredicto por anuncio → los ganadores
// piden ser analizados (vínculo directo con la Biblioteca y el Cerebro).
// =============================================================================

import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, Loader2, X, Copy, Check, Film, AlertTriangle,
  Settings2, CheckCircle2, CircleDashed, ExternalLink, Sparkles,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import {
  parseMetaExport, verdictFor, metaAiPrompt, DEFAULT_ECONOMICS,
  type Economics, type Verdict, type DailyRow,
} from '@/lib/meta';

// ---------------------------------------------------------------------------
// Tipos de la respuesta del API
// ---------------------------------------------------------------------------
interface AdRow {
  ad_name: string;
  status: string | null;
  days: number;
  spend: number;
  revenue: number;
  purchases: number;
  v3s: number;
  atc: number;
  roas: number | null;
  cpa: number | null;
  cpm: number | null;
  cpc: number | null;
  impressions: number;
  hook_rate: number | null;
  ret25: number | null;
  ret50: number | null;
  ret75: number | null;
  freq: number | null;
  cost_atc: number | null;
  link_clicks: number;
  cvr: number | null;
  last_date: string | null;
  spend_last3: number;
  roas_last3: number | null;
  meta_id: string | null;
  created_date: string | null;
  dossier_meta: string | null;
  dossier_video: string | null;
  creative_id: string | null;
  analyzed: boolean;
  has_dossier: boolean;
  fusion: string | null;
  fusion_at: string | null;
}

type SortKey = keyof Pick<AdRow,
  'ad_name' | 'spend' | 'revenue' | 'roas' | 'purchases' | 'cpa' | 'cpm' | 'hook_rate' |
  'ret25' | 'ret50' | 'ret75' | 'freq' | 'cost_atc' | 'link_clicks' | 'cpc' | 'cvr' | 'days'>;

const RANGES = [
  { id: '7', label: '7 días', days: 7 },
  { id: '14', label: '14 días', days: 14 },
  { id: '30', label: '30 días', days: 30 },
  { id: 'all', label: 'Todo', days: 0 },
] as const;

// Columnas estrella (las del export del socio) — dirección del heat map
const COLS: Array<{ key: SortKey; label: string; higherBetter: boolean | null; fmt: (a: AdRow) => string; tip: string }> = [
  { key: 'spend', label: 'Gasto', higherBetter: null, fmt: (a) => `$${a.spend >= 100 ? Math.round(a.spend).toLocaleString() : a.spend.toFixed(2)}`, tip: 'Importe gastado en el rango' },
  { key: 'revenue', label: 'Ingresos', higherBetter: true, fmt: (a) => a.revenue > 0 ? `$${Math.round(a.revenue).toLocaleString()}` : '—', tip: 'Valor de resultados (compras)' },
  { key: 'roas', label: 'ROAS', higherBetter: true, fmt: (a) => a.roas != null ? a.roas.toFixed(2) : '—', tip: 'Ingresos / gasto' },
  { key: 'purchases', label: 'Compras', higherBetter: true, fmt: (a) => a.purchases > 0 ? String(Math.round(a.purchases)) : '—', tip: 'Derivadas de gasto / costo por compra' },
  { key: 'cpa', label: 'CPA', higherBetter: false, fmt: (a) => a.cpa != null ? `$${a.cpa.toFixed(2)}` : '—', tip: 'Costo por compra' },
  { key: 'hook_rate', label: 'Hook', higherBetter: true, fmt: (a) => a.hook_rate != null ? `${a.hook_rate.toFixed(1)}%` : '—', tip: 'Reproducciones 3s / impresiones (thumbstop)' },
  { key: 'ret50', label: 'Ret 50%', higherBetter: true, fmt: (a) => a.ret50 != null ? `${a.ret50.toFixed(0)}%` : '—', tip: 'De los que vieron 3s, % que llegó a la mitad' },
  { key: 'ret75', label: 'Ret 75%', higherBetter: true, fmt: (a) => a.ret75 != null ? `${a.ret75.toFixed(0)}%` : '—', tip: 'De los que vieron 3s, % que llegó al 75% (¿aguanta el guion?)' },
  { key: 'cvr', label: 'CVR', higherBetter: true, fmt: (a) => a.cvr != null ? `${a.cvr.toFixed(2)}%` : '—', tip: 'Compras / clics en el enlace' },
  { key: 'cpm', label: 'CPM', higherBetter: false, fmt: (a) => a.cpm != null ? `$${a.cpm.toFixed(2)}` : '—', tip: 'Costo por mil impresiones' },
  { key: 'cpc', label: 'CPC', higherBetter: false, fmt: (a) => a.cpc != null ? `$${a.cpc.toFixed(2)}` : '—', tip: 'Costo por clic en el enlace' },
  { key: 'cost_atc', label: '$/ATC', higherBetter: false, fmt: (a) => a.cost_atc != null ? `$${a.cost_atc.toFixed(2)}` : '—', tip: 'Costo por artículo agregado al carrito' },
  { key: 'freq', label: 'Frec', higherBetter: false, fmt: (a) => a.freq != null ? a.freq.toFixed(1) : '—', tip: 'Frecuencia promedio (fatiga si sube)' },
  { key: 'link_clicks', label: 'Clics', higherBetter: true, fmt: (a) => a.link_clicks > 0 ? String(Math.round(a.link_clicks)) : '—', tip: 'Clics en el enlace' },
];

const VERDICT_STYLE: Record<Verdict['id'], string> = {
  ganador: 'bg-[#22c55e]/15 text-[#4ade80] border-[#22c55e]/30',
  prometedor: 'bg-[#eab308]/15 text-[#facc15] border-[#eab308]/30',
  dejar: 'bg-[#f97316]/15 text-[#fb923c] border-[#f97316]/30',
  apagar: 'bg-[#ef4444]/15 text-[#f87171] border-[#ef4444]/30',
  sin_datos: 'bg-[#334155]/30 text-[#94a3b8] border-[#334155]',
};

export default function MetaPage() {
  const router = useRouter();
  const { me, activeBrand, activeBrandId, setActiveBrandId, refresh } = useMe();

  const [ads, setAds] = useState<AdRow[]>([]);
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

  const eco: Economics = useMemo(
    () => ({ ...DEFAULT_ECONOMICS, ...((activeBrand?.economics as Economics) ?? {}) }),
    [activeBrand]
  );

  const load = useCallback(async () => {
    if (!activeBrandId) return;
    setLoading(true);
    try {
      // Primera llamada: todo el rango (también nos da los límites de la memoria)
      const probe = await fetch(`/api/meta/ads?brand=${activeBrandId}`).then((x) => x.json());
      if (probe.error) throw new Error(probe.error);
      setMemoryFrom(probe.memoryFrom ?? null);
      setMemoryTo(probe.memoryTo ?? null);

      const r = RANGES.find((x) => x.id === range);
      if (!r || r.days === 0 || !probe.memoryTo) {
        setAds(probe.ads ?? []);
        return;
      }
      // El rango se calcula contra el último día con datos (memoryTo)
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
  // Subida del CSV
  // -------------------------------------------------------------------------
  const handleFile = useCallback(async (file: File) => {
    if (!activeBrandId) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const text = await file.text();
      const parsed = parseMetaExport(text);
      if (!parsed.rows.length) {
        setUploadMsg({ ok: false, text: parsed.warnings.join(' · ') || 'No se encontraron filas.' });
        return;
      }
      const res = await fetch('/api/meta/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: activeBrandId, rows: parsed.rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error subiendo');
      const warn = parsed.warnings.length ? ` · Aviso: ${parsed.warnings.join('; ')}` : '';
      setUploadMsg({
        ok: true,
        text: `Memoria actualizada: ${data.ads} anuncios, ${data.days} días (${parsed.dateFrom} → ${parsed.dateTo})${warn}`,
      });
      await load();
    } catch (err) {
      setUploadMsg({ ok: false, text: err instanceof Error ? err.message : 'Error procesando el archivo' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [activeBrandId, load]);

  // -------------------------------------------------------------------------
  // Orden + filtro + heat map
  // -------------------------------------------------------------------------
  const visible = useMemo(() => {
    let rows = ads;
    if (onlyActive) rows = rows.filter((a) => !a.status || a.status.toLowerCase().includes('active'));
    const sorted = [...rows].sort((a, b) => {
      const va = a[sortKey]; const vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return sortDesc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
      return sortDesc ? (vb as number) - (va as number) : (va as number) - (vb as number);
    });
    return sorted;
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
        let t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
        t = Math.max(0, Math.min(1, t));
        if (!c.higherBetter) t = 1 - t;
        // rojo (0) → neutro → verde (1)
        const hue = 8 + t * 130;
        return `hsla(${hue}, 70%, 45%, ${0.14 + t * 0.10})`;
      });
    }
    return map;
  }, [visible]);

  const totals = useMemo(() => {
    const spend = visible.reduce((s, a) => s + a.spend, 0);
    const revenue = visible.reduce((s, a) => s + a.revenue, 0);
    const purchases = visible.reduce((s, a) => s + a.purchases, 0);
    return { spend, revenue, purchases, roas: spend > 0 ? revenue / spend : 0 };
  }, [visible]);

  const winners = useMemo(
    () => visible.filter((a) => verdictFor(a, eco).id === 'ganador'),
    [visible, eco]
  );
  const pendingWinners = winners.filter((w) => !w.analyzed);

  const sortBy = (k: SortKey) => {
    if (sortKey === k) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(true); }
  };

  return (
    <main className="flex-1 min-h-screen">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-4 sm:px-6 py-6">
        <div className="max-w-[1400px] mx-auto">
          {/* Barra superior: título + upload + rango */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h1 className="text-xl font-bold font-[family-name:var(--font-mono)] tracking-tight">
                Meta · {activeBrand?.name ?? ''}
              </h1>
              <p className="text-xs text-[#64748b] mt-0.5">
                {memoryFrom && memoryTo
                  ? `Memoria: ${memoryFrom} → ${memoryTo}`
                  : 'Sin datos todavía — sube tu primer export'}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex rounded-lg border border-[#1e1e2e] overflow-hidden">
                {RANGES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRange(r.id)}
                    className={`px-3 py-1.5 text-xs transition-colors ${
                      range === r.id ? 'bg-[#1e1e2e] text-[#f1f5f9]' : 'text-[#94a3b8] hover:text-[#f1f5f9]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-[#94a3b8] cursor-pointer select-none px-2">
                <input
                  type="checkbox"
                  checked={onlyActive}
                  onChange={(e) => setOnlyActive(e.target.checked)}
                  className="accent-[#3b82f6]"
                />
                Solo activos
              </label>
              <button
                onClick={() => setShowEco((v) => !v)}
                className="p-2 rounded-lg border border-[#1e1e2e] text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[#3b82f6]/50 transition-colors"
                title={`Economía: breakeven ${eco.breakeven} · meta ${eco.target} · kill $${eco.kill}`}
              >
                <Settings2 className="w-4 h-4" />
              </button>
              <Link
                href="/meta/barrido"
                className="inline-flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]"
              >
                Barrido automático
              </Link>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg gradient-blue text-white font-medium disabled:opacity-60"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Subir export
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
          </div>

          {showEco && activeBrand && (
            <EconomicsEditor
              brandId={activeBrand.id}
              eco={eco}
              onSaved={() => { setShowEco(false); refresh(); }}
              onClose={() => setShowEco(false)}
            />
          )}

          {uploadMsg && (
            <div className={`mb-4 rounded-lg border px-4 py-2.5 text-sm flex items-start gap-2 ${
              uploadMsg.ok ? 'border-[#22c55e]/30 bg-[#22c55e]/10 text-[#4ade80]' : 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#f87171]'
            }`}>
              {uploadMsg.ok ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{uploadMsg.text}</span>
              <button onClick={() => setUploadMsg(null)} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* Resumen del rango */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Stat label="Gasto" value={`$${Math.round(totals.spend).toLocaleString()}`} />
            <Stat label="Ingresos" value={`$${Math.round(totals.revenue).toLocaleString()}`} />
            <Stat
              label={`ROAS (breakeven ${eco.breakeven})`}
              value={totals.roas.toFixed(2)}
              accent={totals.roas >= eco.target ? '#4ade80' : totals.roas >= eco.breakeven ? '#facc15' : '#f87171'}
            />
            <Stat label="Compras" value={String(Math.round(totals.purchases))} />
          </div>

          {/* Ganadores pendientes de análisis */}
          {pendingWinners.length > 0 && (
            <div className="mb-5 rounded-xl border border-[#eab308]/30 bg-[#eab308]/5 px-4 py-3">
              <p className="text-sm text-[#facc15] font-medium flex items-center gap-2">
                <CircleDashed className="w-4 h-4" />
                {pendingWinners.length === 1
                  ? `1 ganador sin analizar — descarga el video y extráele todo`
                  : `${pendingWinners.length} ganadores sin analizar — descarga los videos y extráeles todo`}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {pendingWinners.map((w) => (
                  <button
                    key={w.ad_name}
                    onClick={() => setSelected(w)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-[#eab308]/30 text-[#fde68a] hover:bg-[#eab308]/10 transition-colors"
                  >
                    {w.ad_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tabla */}
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-8 h-8 text-[#3b82f6] animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#1e1e2e] bg-[#0d0d14] p-12 text-center">
              <Upload className="w-10 h-10 text-[#334155] mx-auto mb-4" />
              <p className="text-[#f1f5f9] font-medium">Sube el export de Meta para empezar</p>
              <p className="text-sm text-[#64748b] mt-2 max-w-md mx-auto">
                Nivel anuncio · desglose por día · CSV. La memoria es acumulativa: cada export
                extiende la historia sin duplicar.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-[#1e1e2e] overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#1e1e2e] bg-[#0d0d14] text-[#94a3b8]">
                    <th className="text-left px-3 py-2.5 font-medium sticky left-0 bg-[#0d0d14] z-10 cursor-pointer" onClick={() => sortBy('ad_name')}>
                      Anuncio ({visible.length})
                    </th>
                    <th className="text-left px-2 py-2.5 font-medium">Veredicto</th>
                    <th className="text-center px-2 py-2.5 font-medium" title="¿Ya extrajiste toda la información de este creativo?">Análisis</th>
                    {COLS.map((c) => (
                      <th
                        key={c.key}
                        onClick={() => sortBy(c.key)}
                        title={c.tip}
                        className={`text-right px-2.5 py-2.5 font-medium cursor-pointer hover:text-[#f1f5f9] ${sortKey === c.key ? 'text-[#3b82f6]' : ''}`}
                      >
                        {c.label}{sortKey === c.key ? (sortDesc ? ' ↓' : ' ↑') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a) => {
                    const v = verdictFor(a, eco);
                    return (
                      <tr
                        key={a.ad_name}
                        onClick={() => setSelected(a)}
                        className="border-b border-[#15151f] hover:bg-[#111118] cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2 sticky left-0 bg-[#0a0a0f] max-w-[260px]">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.status?.toLowerCase().includes('active') ? 'bg-[#22c55e]' : 'bg-[#475569]'}`} />
                            <span className="truncate text-[#e2e8f0]" title={a.ad_name}>{a.ad_name}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <span title={v.why} className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-medium ${VERDICT_STYLE[v.id]}`}>
                            {v.label}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          {v.id === 'ganador' || v.id === 'prometedor' || a.analyzed || a.has_dossier ? (
                            a.analyzed ? (
                              <CheckCircle2 className="w-4 h-4 text-[#4ade80] inline" aria-label="Analizado" />
                            ) : a.has_dossier ? (
                              <CircleDashed className="w-4 h-4 text-[#facc15] inline" aria-label="Expediente parcial" />
                            ) : (
                              <CircleDashed className="w-4 h-4 text-[#f59e0b] inline" aria-label="Falta analizar" />
                            )
                          ) : (
                            <span className="text-[#334155]">·</span>
                          )}
                        </td>
                        {COLS.map((c) => (
                          <td
                            key={c.key}
                            className="text-right px-2.5 py-2 font-[family-name:var(--font-mono)] text-[#cbd5e1]"
                            style={{ background: heat.get(c.key)?.(a[c.key] as number | null) || undefined }}
                          >
                            {c.fmt(a)}
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
          onClose={() => setSelected(null)}
          onSaved={load}
          onAnalyze={(name) => router.push(`/studio?ad=${encodeURIComponent(name)}`)}
        />
      )}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-[#64748b]">{label}</p>
      <p className="text-lg font-bold font-[family-name:var(--font-mono)]" style={{ color: accent ?? '#f1f5f9' }}>
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor de economía de la marca
// ---------------------------------------------------------------------------
function EconomicsEditor({ brandId, eco, onSaved, onClose }: {
  brandId: string; eco: Economics; onSaved: () => void; onClose: () => void;
}) {
  const [form, setForm] = useState({ ...eco });
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
  return (
    <div className="mb-4 rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4 flex flex-wrap items-end gap-3">
      {([
        ['currency', 'Moneda', 'text'],
        ['breakeven', 'Breakeven ROAS', 'number'],
        ['target', 'Meta ROAS (ganador)', 'number'],
        ['kill', 'Kill spend (sin compras)', 'number'],
      ] as const).map(([k, label, type]) => (
        <label key={k} className="text-xs text-[#94a3b8]">
          {label}
          <input
            type={type}
            step="0.01"
            value={String(form[k] ?? '')}
            onChange={(e) => setForm((f) => ({ ...f, [k]: type === 'number' ? Number(e.target.value) : e.target.value }))}
            className="block mt-1 w-32 rounded-lg border border-[#1e1e2e] bg-[#111118] px-2.5 py-1.5 text-sm text-[#f1f5f9] focus:border-[#3b82f6] outline-none"
          />
        </label>
      ))}
      <button onClick={save} disabled={saving} className="text-sm px-4 py-2 rounded-lg gradient-blue text-white font-medium disabled:opacity-60">
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
      <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg text-[#94a3b8] hover:text-[#f1f5f9]">Cancelar</button>
      <p className="w-full text-[10px] text-[#64748b]">
        Ganador = ROAS ≥ meta con gasto real · Apagar = kill spend gastado sin compras · Sin datos = gasto &lt; 50% del kill.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel de detalle del anuncio (drawer)
// ---------------------------------------------------------------------------
function AdDetail({ ad, brandId, eco, onClose, onSaved, onAnalyze }: {
  ad: AdRow;
  brandId: string;
  eco: Economics;
  onClose: () => void;
  onSaved: () => void;
  onAnalyze: (adName: string) => void;
}) {
  const router = useRouter();
  const [daily, setDaily] = useState<DailyRow[]>([]);
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
  const v = verdictFor(ad, eco);

  const generateFusion = async () => {
    setFusing(true);
    setFusionError(null);
    try {
      const res = await fetch('/api/fusion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, adName: ad.ad_name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setFusion(data.fusion);
      onSaved();
    } catch (err) {
      setFusionError(err instanceof Error ? err.message : 'Error generando el análisis');
    } finally {
      setFusing(false);
    }
  };

  // Copiar TODOS los datos del anuncio (para pegar en otra guía/IA)
  const copyAllData = async () => {
    const lines = [
      `ANUNCIO: ${ad.ad_name}`,
      `Veredicto: ${v.label} — ${v.why}`,
      `Métricas (${ad.days} días): gasto $${ad.spend.toFixed(0)} · ingresos $${ad.revenue.toFixed(0)} · ROAS ${ad.roas?.toFixed(2) ?? 'N/D'} · compras ${Math.round(ad.purchases)} · CPA $${ad.cpa?.toFixed(2) ?? 'N/D'} · hook ${ad.hook_rate?.toFixed(1) ?? 'N/D'}% · ret25 ${ad.ret25?.toFixed(0) ?? 'N/D'}% · ret50 ${ad.ret50?.toFixed(0) ?? 'N/D'}% · ret75 ${ad.ret75?.toFixed(0) ?? 'N/D'}% · CVR ${ad.cvr?.toFixed(2) ?? 'N/D'}% · CPM $${ad.cpm?.toFixed(2) ?? 'N/D'} · CPC $${ad.cpc?.toFixed(2) ?? 'N/D'} · $/ATC $${ad.cost_atc?.toFixed(2) ?? 'N/D'} · frec ${ad.freq?.toFixed(1) ?? 'N/D'} · clics ${ad.link_clicks}`,
      '',
      'SERIE DIARIA:',
      ...daily.map((d) => `${d.date}: gasto $${d.spend.toFixed(2)}, ROAS ${d.roas?.toFixed(2) ?? '—'}, hook ${d.hook_rate?.toFixed(1) ?? '—'}%, frec ${d.freq?.toFixed(1) ?? '—'}`),
    ];
    if (dossierMeta) lines.push('', 'EXPEDIENTE META IA:', dossierMeta);
    if (dossierVideo) lines.push('', 'NOTAS DEL VIDEO:', dossierVideo);
    if (fusion) lines.push('', 'ANÁLISIS FUSIONADO:', fusion);
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  };

  useEffect(() => {
    fetch(`/api/meta/ads?brand=${brandId}&ad=${encodeURIComponent(ad.ad_name)}`)
      .then((r) => r.json())
      .then((d) => setDaily(d.daily ?? []))
      .catch(() => {});
  }, [ad.ad_name, brandId]);

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

  const prompt = metaAiPrompt(ad, v, eco);
  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl h-full overflow-y-auto bg-[#0d0d14] border-l border-[#1e1e2e] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#f1f5f9] break-words">{ad.ad_name}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-medium ${VERDICT_STYLE[v.id]}`}>{v.label}</span>
              <span className="text-[10px] text-[#64748b]">{ad.days} días con datos{ad.created_date ? ` · creado ${ad.created_date}` : ''}</span>
            </div>
            <p className="text-xs text-[#94a3b8] mt-2">{v.why}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={copyAllData}
              title="Copiar todos los datos (métricas + serie + expedientes + análisis) para pegar en otra IA"
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-[#1e1e2e] text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[#3b82f6]/50"
            >
              {copiedAll ? <Check className="w-3.5 h-3.5 text-[#4ade80]" /> : <Copy className="w-3.5 h-3.5" />}
              Datos
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#1e1e2e]">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Métricas clave */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            ['Gasto', `$${Math.round(ad.spend).toLocaleString()}`],
            ['ROAS', ad.roas?.toFixed(2) ?? '—'],
            ['CPA', ad.cpa != null ? `$${ad.cpa.toFixed(2)}` : '—'],
            ['Hook', ad.hook_rate != null ? `${ad.hook_rate.toFixed(1)}%` : '—'],
            ['Ret 75%', ad.ret75 != null ? `${ad.ret75.toFixed(0)}%` : '—'],
            ['CVR', ad.cvr != null ? `${ad.cvr.toFixed(2)}%` : '—'],
          ].map(([l, val]) => (
            <div key={l} className="rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2">
              <p className="text-[9px] uppercase tracking-wide text-[#64748b]">{l}</p>
              <p className="text-sm font-bold font-[family-name:var(--font-mono)] text-[#f1f5f9]">{val}</p>
            </div>
          ))}
        </div>

        {/* Serie diaria */}
        {daily.length > 1 && (
          <div className="mb-4 rounded-xl border border-[#1e1e2e] p-3">
            <p className="text-[10px] uppercase tracking-wide text-[#64748b] mb-2">Gasto y ROAS por día</p>
            <Sparkline daily={daily} eco={eco} />
          </div>
        )}

        {/* Estado del análisis del creativo */}
        <div className="mb-4 rounded-xl border border-[#1e1e2e] p-4">
          <p className="text-[10px] uppercase tracking-wide text-[#64748b] mb-2">Creativo</p>
          {ad.creative_id ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-[#4ade80] flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Analizado en la Biblioteca</p>
              <button
                onClick={() => router.push(`/analyze?id=${ad.creative_id}`)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#1e1e2e] text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[#3b82f6]/50"
              >
                Ver análisis <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm text-[#f59e0b] flex items-center gap-2"><CircleDashed className="w-4 h-4" /> Falta extraer la información de este video</p>
              <button
                onClick={() => onAnalyze(ad.ad_name)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg gradient-blue text-white font-medium"
              >
                <Film className="w-3.5 h-3.5" /> Analizar video
              </button>
            </div>
          )}
        </div>

        {/* Análisis fusionado: video + Meta (la mesa redonda) */}
        <div className="mb-4 rounded-xl border border-[#8b5cf6]/25 bg-[#8b5cf6]/5 p-4">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-[10px] uppercase tracking-wide text-[#c4b5fd] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Análisis fusionado · video × Meta
            </p>
            <div className="flex items-center gap-2">
              {fusion && (
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(fusion);
                    setCopiedFusion(true);
                    setTimeout(() => setCopiedFusion(false), 1500);
                  }}
                  className="flex items-center gap-1.5 text-xs text-[#94a3b8] hover:text-[#f1f5f9]"
                >
                  {copiedFusion ? <Check className="w-3.5 h-3.5 text-[#4ade80]" /> : <Copy className="w-3.5 h-3.5" />}
                  Copiar
                </button>
              )}
              <button
                onClick={generateFusion}
                disabled={fusing}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#8b5cf6] text-white font-medium disabled:opacity-60"
              >
                {fusing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {fusing ? 'Desmenuzando… (~1 min)' : fusion ? 'Regenerar' : 'Desmenuzar este anuncio'}
              </button>
            </div>
          </div>
          {fusionError && <p className="text-xs text-[#f87171] mb-2">{fusionError}</p>}
          {fusion ? (
            <div className="text-xs text-[#d1d5e8] whitespace-pre-wrap leading-relaxed max-h-[420px] overflow-y-auto rounded-lg bg-[#0a0a0f]/60 p-3">
              {fusion}
            </div>
          ) : (
            <p className="text-xs text-[#94a3b8]">
              Un psicólogo, un creative strategist y un analista desmenuzan este creativo: línea de
              tiempo segundo a segundo, guion, dolores, psicología, dónde se pierde la atención (con
              la retención real) y cómo mejorarlo.
              {!ad.creative_id && ' Consejo: analiza primero el video en la Biblioteca para que la fusión tenga el guion y las tomas.'}
            </p>
          )}
        </div>

        {/* Prompt para la IA de Meta */}
        <div className="mb-4 rounded-xl border border-[#1e1e2e] p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Prompt para la IA de Meta</p>
            <button onClick={copyPrompt} className="flex items-center gap-1.5 text-xs text-[#94a3b8] hover:text-[#f1f5f9]">
              {copied ? <Check className="w-3.5 h-3.5 text-[#4ade80]" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="text-xs text-[#94a3b8] whitespace-pre-wrap">{prompt}</p>
        </div>

        {/* Expediente */}
        <div className="rounded-xl border border-[#1e1e2e] p-4">
          <p className="text-[10px] uppercase tracking-wide text-[#64748b] mb-2">Expediente del creativo</p>
          <label className="text-xs text-[#94a3b8]">Respuesta de la IA de Meta (pégala aquí)</label>
          <textarea
            value={dossierMeta}
            onChange={(e) => setDossierMeta(e.target.value)}
            rows={4}
            className="mt-1 mb-3 w-full rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-xs text-[#e2e8f0] focus:border-[#3b82f6] outline-none resize-y"
            placeholder="Curva de retención, desgloses, comparativa vs cuenta…"
          />
          <label className="text-xs text-[#94a3b8]">Notas del video / guion / psicología</label>
          <textarea
            value={dossierVideo}
            onChange={(e) => setDossierVideo(e.target.value)}
            rows={4}
            className="mt-1 mb-3 w-full rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2 text-xs text-[#e2e8f0] focus:border-[#3b82f6] outline-none resize-y"
            placeholder="Qué dice, por qué funciona, qué emociones toca…"
          />
          <button
            onClick={saveDossier}
            disabled={saving || !ad.meta_id}
            className="text-sm px-4 py-2 rounded-lg gradient-blue text-white font-medium disabled:opacity-60"
          >
            {saving ? 'Guardando…' : savedFlash ? '✓ Guardado' : 'Guardar expediente'}
          </button>
          <p className="text-[10px] text-[#64748b] mt-2">
            Todo lo que guardes aquí alimenta al Cerebro: la IA lo cita cuando le pidas guiones nuevos.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline de gasto (barras) + ROAS (línea) por día
// ---------------------------------------------------------------------------
function Sparkline({ daily, eco }: { daily: DailyRow[]; eco: Economics }) {
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
            fill="#1d4ed8"
            opacity={0.45}
          >
            <title>{`${d.date}: $${d.spend.toFixed(2)} · ROAS ${roasVals[i]?.toFixed(2) ?? '—'}`}</title>
          </rect>
        ))}
        <line x1={pad} x2={W - pad} y1={targetY} y2={targetY} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1} opacity={0.5} />
        {pts && <polyline points={pts} fill="none" stroke="#facc15" strokeWidth={2} />}
      </svg>
      <div className="flex justify-between text-[9px] text-[#64748b] px-1">
        <span>{daily[0]?.date}</span>
        <span className="text-[#facc15]">— ROAS · <span className="text-[#4ade80]">- - meta {eco.target}</span> · <span className="text-[#3b82f6]">■ gasto</span></span>
        <span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
  );
}
