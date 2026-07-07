'use client';

// =============================================================================
// AdDNA — Conjuntos: dashboard de creative strategist.
// Maqueta cada batch (ángulo, embudo, conciencia, formato, público, guion),
// sube el reporte de Meta y detecta automáticamente los anuncios ganadores.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, Plus, Trash2, Trophy, Upload, LayoutGrid, ChevronLeft, Check,
  Sparkles, Download, Wand2,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import {
  STAGES, FORMATS, AWARENESS, ANGLES, scaffoldBatch, adName, seqOfName, type Stage,
} from '@/lib/ad-angles';
import { scoreSet, winnerId, type Verdict } from '@/lib/ad-scoring';

interface AdSet {
  id: string;
  name: string;
  pain: string | null;
  notes: string | null;
  created_at: string;
}
interface Ad {
  id: string;
  name: string;
  funnel_stage: string;
  pain: string | null;
  hypothesis: string | null;
  script: string | null;
  is_winner: boolean;
  metrics: Record<string, string> | null;
  format: string | null;
  audience: string | null;
  awareness_stage: string | null;
  angle: string | null;
}

const KEY_METRICS: Array<{ match: RegExp; label: string }> = [
  { match: /hook rate|reproducciones de 3|3-second video/i, label: 'Hook' },
  { match: /ctr.*(all|todo)|ctr \(/i, label: 'CTR' },
  { match: /roas/i, label: 'ROAS' },
  { match: /(amount spent|importe gastado)/i, label: 'Gasto' },
  { match: /(cost per purchase|costo por compra|cpa)/i, label: 'CPA' },
  { match: /(purchases|compras)$/i, label: 'Compras' },
];
function metricChips(metrics: Record<string, string> | null) {
  if (!metrics) return [];
  const chips: Array<{ label: string; value: string }> = [];
  for (const km of KEY_METRICS) {
    const key = Object.keys(metrics).find((k) => km.match.test(k));
    if (key && metrics[key]) chips.push({ label: km.label, value: metrics[key] });
  }
  return chips;
}

const VERDICT_STYLE: Record<Verdict, { label: string; cls: string }> = {
  ganador: { label: '🏆 Ganador', cls: 'bg-[#f59e0b]/15 text-[#fbbf24] border-[#f59e0b]/40' },
  promedio: { label: 'Promedio', cls: 'bg-[#1e1e2e] text-[#94a3b8] border-[#2e2e42]' },
  pausar: { label: 'Pausar', cls: 'bg-[#f43f5e]/10 text-[#fb7185] border-[#f43f5e]/30' },
  'sin-datos': { label: 'Sin datos', cls: 'bg-[#0a0a0f] text-[#475569] border-[#1e1e2e]' },
};

export default function ConjuntosPage() {
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();
  const [adsets, setAdsets] = useState<AdSet[]>([]);
  const [selected, setSelected] = useState<AdSet | null>(null);
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const brandCsvRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadList = useCallback(() => {
    setLoading(true);
    fetch(`/api/adsets${activeBrandId ? `?brand=${activeBrandId}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.adsets && setAdsets(d.adsets))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeBrandId]);

  useEffect(() => { loadList(); }, [loadList]);

  const openSet = async (s: AdSet) => {
    setSelected(s);
    setCsvMsg(null);
    const res = await fetch(`/api/adsets/${s.id}`);
    if (res.ok) {
      const d = await res.json();
      setSelected(d.adset);
      setAds(d.ads);
    }
  };

  // Nuevo conjunto: pide el nombre del batch y auto-arma el ecosistema.
  const createSet = async () => {
    const batch = (typeof window !== 'undefined'
      ? window.prompt('Nombre del batch (ej. B02):', `B${String(adsets.length + 1).padStart(2, '0')}`)
      : '')?.trim();
    if (!batch) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/adsets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: batch, brandId: activeBrandId }),
      });
      if (!res.ok) throw new Error('No se pudo crear el conjunto');
      const { adset } = await res.json();
      // Auto-scaffold: 6 anuncios base (TOF/MOF/BOF) con ángulos y nomenclatura.
      const scaffold = scaffoldBatch(batch);
      const bulk = await fetch(`/api/adsets/${adset.id}/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ads: scaffold }),
      });
      const bd = bulk.ok ? await bulk.json() : { ads: [] };
      setAdsets((p) => [adset, ...p]);
      setSelected(adset);
      setAds(bd.ads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando el conjunto');
    } finally {
      setSaving(false);
    }
  };

  const patchSet = (patch: Partial<AdSet>) => {
    if (!selected) return;
    const next = { ...selected, ...patch };
    setSelected(next);
    setAdsets((p) => p.map((s) => (s.id === next.id ? next : s)));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/adsets/${next.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).catch(() => {});
    }, 700);
  };

  const patchAd = (adId: string, patch: Partial<Ad>) => {
    setAds((p) => p.map((a) => (a.id === adId ? { ...a, ...patch } : a)));
    if (!selected) return;
    fetch(`/api/adsets/${selected.id}/ads`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adId, ...patch }),
    }).catch(() => {});
  };

  // Cambia un campo de la maqueta y regenera la nomenclatura automáticamente,
  // conservando el consecutivo del anuncio. El nombre sigue editable a mano.
  const changeMaqueta = (ad: Ad, patch: Partial<Ad>) => {
    if (!selected) return;
    const merged = { ...ad, ...patch };
    const seq = seqOfName(ad.name, ads.findIndex((x) => x.id === ad.id) + 1);
    const name = adName(
      selected.name, seq, (merged.funnel_stage as Stage) ?? 'tofu',
      merged.angle ?? undefined, merged.format ?? undefined,
    );
    patchAd(ad.id, { ...patch, name });
  };

  const addAd = async () => {
    if (!selected) return;
    const res = await fetch(`/api/adsets/${selected.id}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: adName(selected.name, ads.length + 1, 'tofu'), funnel_stage: 'tofu' }),
    });
    if (res.ok) {
      const d = await res.json();
      setAds((p) => [...p, d.ad]);
    }
  };

  const removeAd = async (adId: string) => {
    if (!selected) return;
    setAds((p) => p.filter((a) => a.id !== adId));
    await fetch(`/api/adsets/${selected.id}/ads?ad=${adId}`, { method: 'DELETE' });
  };

  const removeSet = async () => {
    if (!selected || !confirm(`¿Borrar el conjunto "${selected.name}" y sus anuncios?`)) return;
    await fetch(`/api/adsets/${selected.id}`, { method: 'DELETE' });
    setAdsets((p) => p.filter((s) => s.id !== selected.id));
    setSelected(null);
  };

  // Sube el reporte a ESTE conjunto.
  const uploadCsv = async (file: File) => {
    if (!selected) return;
    setCsvMsg('Procesando reporte…');
    setError(null);
    try {
      const csv = await file.text();
      const res = await fetch(`/api/adsets/${selected.id}/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Error');
      setCsvMsg(`✓ ${d.matched} anuncio(s) actualizados.` + (d.unmatched?.length ? ` Sin match: ${d.unmatched.join(', ')}` : ''));
      await openSet(selected);
    } catch (err) {
      setCsvMsg(null);
      setError(err instanceof Error ? err.message : 'Error con el reporte');
    } finally {
      if (csvRef.current) csvRef.current.value = '';
    }
  };

  // Sube el reporte a TODA la marca (desde la lista) y refresca.
  const uploadBrandCsv = async (file: File) => {
    setCsvMsg('Procesando reporte de la marca…');
    setError(null);
    try {
      const csv = await file.text();
      const res = await fetch('/api/adsets/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, brandId: activeBrandId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Error');
      setCsvMsg(`✓ ${d.matched} de ${d.totalAds} anuncio(s) de la marca actualizados. Abre cada conjunto para ver ganadores.`);
      loadList();
    } catch (err) {
      setCsvMsg(null);
      setError(err instanceof Error ? err.message : 'Error con el reporte');
    } finally {
      if (brandCsvRef.current) brandCsvRef.current.value = '';
    }
  };

  // Detecta y marca el ganador del conjunto automáticamente.
  const autoWinner = async () => {
    if (!selected) return;
    const wid = winnerId(ads.map((a) => ({ id: a.id, metrics: a.metrics })));
    if (!wid) {
      setCsvMsg('Aún no hay un ganador claro (sube métricas o hace falta más gasto).');
      return;
    }
    setAds((p) => p.map((a) => ({ ...a, is_winner: a.id === wid })));
    for (const a of ads) {
      const shouldWin = a.id === wid;
      if (a.is_winner !== shouldWin) {
        fetch(`/api/adsets/${selected.id}/ads`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adId: a.id, is_winner: shouldWin }),
        }).catch(() => {});
      }
    }
    setCsvMsg('🏆 Ganador marcado automáticamente según ROAS, CPA, Hook y CTR.');
  };

  // Exporta el conjunto como CSV (plan + resultados).
  const exportCsv = () => {
    if (!selected) return;
    const scores = scoreSet(ads.map((a) => ({ id: a.id, metrics: a.metrics })));
    const head = ['Anuncio', 'Embudo', 'Angulo', 'Formato', 'Publico', 'Conciencia', 'ROAS', 'CPA', 'Hook%', 'CTR%', 'Gasto', 'Veredicto', 'Ganador'];
    const rows = ads.map((a) => {
      const s = scores.get(a.id);
      const e = s?.extracted ?? {};
      return [
        a.name, a.funnel_stage, a.angle ?? '', a.format ?? '', a.audience ?? '',
        a.awareness_stage ?? '', e.roas ?? '', e.cpa ?? '', e.hookRate ?? '', e.ctr ?? '',
        e.spend ?? '', s?.verdict ?? '', a.is_winner ? 'SI' : '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [head.join(','), ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected.name.replace(/[^\w-]+/g, '_')}_dashboard.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const scores = selected ? scoreSet(ads.map((a) => ({ id: a.id, metrics: a.metrics }))) : null;
  const hasAnyMetrics = ads.some((a) => a.metrics && Object.keys(a.metrics).length > 0);

  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-5">
          {!selected ? (
            <>
              <details className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4 open:pb-4">
                <summary className="cursor-pointer text-sm font-semibold text-[#f1f5f9] select-none">
                  📊 Cómo leer tus anuncios de Meta en 3 pasos
                </summary>
                <div className="mt-3 space-y-2 text-sm text-[#94a3b8]">
                  <p><span className="text-[#f1f5f9] font-medium">Paso 1 — Prepara tu export.</span> En tu Administrador de Anuncios, en <em>Columnas → Personalizar columnas</em>, agrega antes de exportar: Hook Rate <span title="Qué % sigue viendo tu video tras los primeros 3 segundos.">(retención 3s / ThruPlay)</span>, reproducciones de video (25/50/75/95/100%), impresiones, clics (todos) y CTR <span title="Qué % de quienes ven tu anuncio le dan clic.">ⓘ</span>, CPA <span title="Cuánto te cuesta un resultado. Más bajo = mejor.">(costo por resultado)</span>, ROAS <span title="Cuántos pesos regresas por cada peso invertido.">ⓘ</span> y gasto.</p>
                  <p><span className="text-[#f1f5f9] font-medium">Paso 2 — Exporta y sube.</span> Descárgalo como CSV y súbelo aquí. Funciona en español o inglés.</p>
                  <p><span className="text-[#f1f5f9] font-medium">Paso 3 — Recibe tu lectura.</span> Las métricas se rellenan por nombre de anuncio y AdDNA detecta tus ganadores.</p>
                </div>
              </details>

              {/* Upload prominente a nivel marca */}
              <div className="rounded-2xl border border-[#3b82f6]/30 bg-gradient-to-br from-[#0f1830] to-[#111118] p-5">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="w-10 h-10 rounded-xl gradient-blue flex items-center justify-center shrink-0">
                    <Upload className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-[220px]">
                    <p className="font-semibold text-[#f1f5f9]">Sube el reporte de Meta de tu marca</p>
                    <p className="text-xs text-[#94a3b8] mt-0.5">Un solo CSV rellena las métricas de todos tus conjuntos por nombre de anuncio.</p>
                  </div>
                  <button
                    onClick={() => brandCsvRef.current?.click()}
                    className="text-sm px-4 py-2.5 rounded-xl gradient-blue text-white font-medium shrink-0"
                  >
                    Subir reporte de Meta
                  </button>
                  <input
                    ref={brandCsvRef} type="file" accept=".csv,text/csv" className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadBrandCsv(e.target.files[0])}
                  />
                </div>
                {csvMsg && <p className="text-xs text-[#4ade80] mt-3">{csvMsg}</p>}
              </div>

              <div className="flex items-end justify-between">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    <LayoutGrid className="w-6 h-6 text-[#3b82f6]" />
                    Conjuntos de anuncios
                  </h1>
                  <p className="text-sm text-[#64748b] mt-1">
                    Cada conjunto es un batch. Al crearlo, AdDNA arma un ecosistema base (TOF/MOF/BOF) con ángulos y nomenclatura lista para Meta.
                  </p>
                </div>
                <button
                  onClick={createSet}
                  disabled={saving}
                  className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg gradient-blue text-white font-medium shrink-0 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Nuevo batch
                </button>
              </div>

              {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 text-[#3b82f6] animate-spin" /></div>
              ) : adsets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#1e1e2e] bg-[#0d0d14] p-12 text-center text-[#64748b] text-sm">
                  Crea tu primer batch: le pones nombre (ej. B01) y AdDNA arma los anuncios TOF/MOF/BOF con ángulos sugeridos.
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {adsets.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => openSet(s)}
                      className="text-left rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5 hover:border-[#3b82f6]/50 transition"
                    >
                      <p className="font-semibold text-[#f1f5f9] truncate">{s.name}</p>
                      <p className="text-xs text-[#94a3b8] mt-1 truncate">Dolor: {s.pain || 'sin definir'}</p>
                      <p className="text-[10px] text-[#475569] mt-2">{new Date(s.created_at).toLocaleDateString('es-MX')}</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => { setSelected(null); loadList(); }}
                  className="flex items-center gap-1.5 text-sm text-[#94a3b8] hover:text-[#f1f5f9]"
                >
                  <ChevronLeft className="w-4 h-4" /> Conjuntos
                </button>
                <div className="flex items-center gap-2">
                  <button onClick={exportCsv} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-[#2e2e42] text-[#cbd5e1] hover:border-[#3b82f6]/50">
                    <Download className="w-3.5 h-3.5" /> Exportar
                  </button>
                  <button onClick={removeSet} className="p-2 rounded-lg text-[#94a3b8] hover:text-[#f43f5e] hover:bg-[#1e1e2e]" title="Borrar conjunto">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Datos del conjunto */}
              <div className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5 space-y-3">
                <input
                  value={selected.name}
                  onChange={(e) => patchSet({ name: e.target.value })}
                  className="w-full bg-transparent text-xl font-bold text-[#f1f5f9] focus:outline-none border-b border-transparent focus:border-[#3b82f6]/50 pb-1"
                />
                <input
                  value={selected.pain ?? ''}
                  onChange={(e) => patchSet({ pain: e.target.value })}
                  placeholder="Dolor del conjunto (ej. manchas en axilas por depilación)"
                  className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-[#e2e8f0] placeholder:text-[#475569] focus:border-[#3b82f6]/50 focus:outline-none"
                />
                <textarea
                  value={selected.notes ?? ''}
                  onChange={(e) => patchSet({ notes: e.target.value })}
                  rows={2}
                  placeholder="Estrategia / hipótesis general del conjunto"
                  className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-[#e2e8f0] placeholder:text-[#475569] focus:border-[#3b82f6]/50 focus:outline-none resize-y"
                />
              </div>

              {/* Barra de acciones de métricas */}
              <div className="rounded-2xl border border-[#1e1e2e] bg-[#0d0d14] p-4 flex flex-wrap items-center gap-2">
                <button onClick={() => csvRef.current?.click()} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-[#2e2e42] text-[#cbd5e1] hover:border-[#3b82f6]/50">
                  <Upload className="w-3.5 h-3.5" /> Subir reporte de este conjunto
                </button>
                <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])} />
                <button onClick={autoWinner} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-[#f59e0b]/40 text-[#fbbf24] hover:bg-[#f59e0b]/10">
                  <Wand2 className="w-3.5 h-3.5" /> Detectar ganador
                </button>
                <p className="text-[11px] text-[#64748b] flex-1 min-w-[180px]">Las métricas se rellenan por nombre de anuncio.</p>
                {csvMsg && <p className="text-xs text-[#4ade80] w-full">{csvMsg}</p>}
              </div>

              {/* Dashboard de métricas */}
              {hasAnyMetrics && scores && (
                <div className="rounded-2xl border border-[#1e1e2e] bg-[#111118] overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[#64748b] border-b border-[#1e1e2e]">
                        <th className="text-left font-medium px-3 py-2">Anuncio</th>
                        <th className="text-right font-medium px-2 py-2" title="Cuántos pesos regresas por cada peso invertido.">ROAS</th>
                        <th className="text-right font-medium px-2 py-2" title="Costo por resultado. Más bajo = mejor.">CPA</th>
                        <th className="text-right font-medium px-2 py-2" title="Retención tras 3 segundos.">Hook</th>
                        <th className="text-right font-medium px-2 py-2">CTR</th>
                        <th className="text-right font-medium px-3 py-2">Veredicto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ads.map((a) => {
                        const s = scores.get(a.id);
                        const e = s?.extracted ?? {};
                        const vs = VERDICT_STYLE[s?.verdict ?? 'sin-datos'];
                        return (
                          <tr key={a.id} className="border-b border-[#1e1e2e]/60 last:border-0">
                            <td className="px-3 py-2 text-[#e2e8f0] max-w-[220px] truncate" title={a.name}>{a.name}</td>
                            <td className="px-2 py-2 text-right text-[#cbd5e1]">{e.roas ?? '—'}</td>
                            <td className="px-2 py-2 text-right text-[#cbd5e1]">{e.cpa ?? '—'}</td>
                            <td className="px-2 py-2 text-right text-[#cbd5e1]">{e.hookRate !== undefined ? `${e.hookRate}%` : '—'}</td>
                            <td className="px-2 py-2 text-right text-[#cbd5e1]">{e.ctr !== undefined ? `${e.ctr}%` : '—'}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={`inline-block px-2 py-0.5 rounded-md border text-[10px] ${vs.cls}`}>{vs.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Anuncios (maqueta editable) */}
              <div className="space-y-3">
                {ads.map((ad) => {
                  const chips = metricChips(ad.metrics);
                  const s = scores?.get(ad.id);
                  return (
                    <div
                      key={ad.id}
                      className={`rounded-2xl border p-4 space-y-2 ${ad.is_winner ? 'border-[#f59e0b]/50 bg-gradient-to-br from-[#241a08] to-[#111118]' : 'border-[#1e1e2e] bg-[#111118]'}`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          value={ad.name}
                          onChange={(e) => patchAd(ad.id, { name: e.target.value })}
                          className="flex-1 bg-transparent text-sm font-semibold text-[#f1f5f9] focus:outline-none border-b border-transparent focus:border-[#3b82f6]/50"
                        />
                        <button
                          onClick={() => patchAd(ad.id, { is_winner: !ad.is_winner })}
                          className={`p-1.5 rounded-lg ${ad.is_winner ? 'text-[#fbbf24]' : 'text-[#475569] hover:text-[#fbbf24]'}`}
                          title="Marcar ganador"
                        >
                          <Trophy className="w-4 h-4" />
                        </button>
                        <button onClick={() => removeAd(ad.id)} className="p-1.5 rounded-lg text-[#475569] hover:text-[#f43f5e]" title="Borrar anuncio">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Maqueta: embudo, ángulo, formato, conciencia, público */}
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <select value={ad.funnel_stage} onChange={(e) => changeMaqueta(ad, { funnel_stage: e.target.value })}
                          className="text-[11px] px-2 py-1.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-[#cbd5e1] focus:outline-none">
                          {STAGES.map((s2) => <option key={s2.v} value={s2.v}>{s2.short}</option>)}
                        </select>
                        <input list="angulos" value={ad.angle ?? ''} onChange={(e) => changeMaqueta(ad, { angle: e.target.value })} placeholder="Ángulo"
                          className="text-[11px] px-2 py-1.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-[#cbd5e1] placeholder:text-[#475569] focus:outline-none" />
                        <select value={ad.format ?? ''} onChange={(e) => changeMaqueta(ad, { format: e.target.value })}
                          className="text-[11px] px-2 py-1.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-[#cbd5e1] focus:outline-none">
                          <option value="">Formato</option>
                          {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <select value={ad.awareness_stage ?? ''} onChange={(e) => patchAd(ad.id, { awareness_stage: e.target.value })}
                          className="text-[11px] px-2 py-1.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-[#cbd5e1] focus:outline-none">
                          <option value="">Conciencia</option>
                          {AWARENESS.map((a2) => <option key={a2.v} value={a2.v}>{a2.v}</option>)}
                        </select>
                        <input value={ad.audience ?? ''} onChange={(e) => patchAd(ad.id, { audience: e.target.value })} placeholder="Público"
                          className="text-[11px] px-2 py-1.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-[#cbd5e1] placeholder:text-[#475569] focus:outline-none" />
                      </div>

                      <textarea
                        value={ad.script ?? ''}
                        onChange={(e) => patchAd(ad.id, { script: e.target.value })}
                        rows={2}
                        placeholder="Qué se habla en este anuncio (guion / mensaje)"
                        className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-xs text-[#e2e8f0] placeholder:text-[#475569] focus:border-[#3b82f6]/50 focus:outline-none resize-y"
                      />

                      {s && s.verdict !== 'sin-datos' && (
                        <p className="text-[10px] text-[#94a3b8]">{s.reason}</p>
                      )}
                      {chips.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {chips.map((c) => (
                            <span key={c.label} className="text-[10px] px-2 py-1 rounded-md bg-[#0a0a0f] border border-[#1e1e2e] text-[#cbd5e1]">
                              <span className="text-[#64748b]">{c.label}:</span> {c.value}
                            </span>
                          ))}
                          <span className="text-[10px] px-2 py-1 rounded-md bg-[#22c55e]/10 text-[#4ade80] flex items-center gap-1">
                            <Check className="w-3 h-3" /> métricas cargadas
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}

                <button
                  onClick={addAd}
                  className="w-full py-3 rounded-xl border border-dashed border-[#2e2e42] text-sm text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[#3b82f6]/50 flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Agregar anuncio al conjunto
                </button>
              </div>

              {/* Sugerencias de ángulo (datalist) */}
              <datalist id="angulos">
                {ANGLES.map((a) => <option key={a.code} value={a.code}>{`${a.label} — ${a.hint}`}</option>)}
              </datalist>
            </motion.div>
          )}

          {error && <p className="text-xs text-[#f43f5e]">{error}</p>}
        </div>
      </section>
    </main>
  );
}
