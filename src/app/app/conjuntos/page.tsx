'use client';

// =============================================================================
// AdDNA — Conjuntos: planificador de ad sets para Meta.
// Cada conjunto ataca UN dolor; sus anuncios se planifican por etapa del
// embudo (hipótesis + guion). Luego subes el CSV de Meta y las métricas se
// rellenan por nombre de anuncio para marcar ganadores.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, Plus, Trash2, Trophy, Upload, LayoutGrid, ChevronLeft, Check,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';

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
}

const STAGES = [
  { v: 'tofu', label: 'TOFU · frío' },
  { v: 'mofu', label: 'MOFU · consideración' },
  { v: 'bofu', label: 'BOFU · cierre' },
];

// Métricas destacadas del CSV de Meta (busca por coincidencia de encabezado)
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadList = useCallback(() => {
    setLoading(true);
    fetch(`/api/adsets${activeBrandId ? `?brand=${activeBrandId}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.adsets && setAdsets(d.adsets))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeBrandId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

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

  const createSet = async () => {
    setSaving(true);
    const res = await fetch('/api/adsets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Conjunto nuevo', brandId: activeBrandId }),
    });
    setSaving(false);
    if (res.ok) {
      const d = await res.json();
      setAdsets((p) => [d.adset, ...p]);
      openSet(d.adset);
    }
  };

  // Guardado con debounce del conjunto
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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/adsets/${selected.id}/ads`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adId, ...patch }),
      }).catch(() => {});
    }, 700);
  };

  const addAd = async () => {
    if (!selected) return;
    const res = await fetch(`/api/adsets/${selected.id}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${selected.name} — AD${String(ads.length + 1).padStart(2, '0')}` }),
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

  const uploadCsv = async (file: File) => {
    if (!selected) return;
    setCsvMsg('Procesando CSV…');
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
      setCsvMsg(
        `✓ ${d.matched} anuncio(s) actualizados por nombre.` +
          (d.unmatched?.length ? ` Sin match en tu plan: ${d.unmatched.join(', ')}` : '')
      );
      openSet(selected);
    } catch (err) {
      setCsvMsg(null);
      setError(err instanceof Error ? err.message : 'Error con el CSV');
    } finally {
      if (csvRef.current) csvRef.current.value = '';
    }
  };

  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-5">
          {!selected ? (
            <>
              {/* Bloque de instrucciones: cómo exportar métricas de Meta (colapsable) */}
              <details className="rounded-xl border border-[#1e1e2e] bg-[#111118] p-4 open:pb-4">
                <summary className="cursor-pointer text-sm font-semibold text-[#f1f5f9] select-none">
                  📊 Cómo leer tus anuncios de Meta en 3 pasos
                </summary>
                <div className="mt-3 space-y-2 text-sm text-[#94a3b8]">
                  <p><span className="text-[#f1f5f9] font-medium">Paso 1 — Prepara tu export.</span> En tu Administrador de Anuncios, en <em>Columnas → Personalizar columnas</em>, agrega antes de exportar: Hook Rate <span title="Qué % sigue viendo tu video tras los primeros 3 segundos.">(retención 3s / ThruPlay)</span>, reproducciones de video (25/50/75/95/100%), impresiones, clics (todos) y CTR <span title="Qué % de quienes ven tu anuncio le dan clic.">ⓘ</span>, CPA <span title="Cuánto te cuesta conseguir un resultado. Más bajo = mejor.">(costo por resultado)</span>, ROAS <span title="Cuántos pesos regresas por cada peso invertido. 3 = $3 por cada $1.">ⓘ</span> y gasto.</p>
                  <p><span className="text-[#f1f5f9] font-medium">Paso 2 — Exporta y sube.</span> Descárgalo como CSV y súbelo aquí con &quot;Subir CSV de Meta&quot;. Funciona en español o inglés.</p>
                  <p><span className="text-[#f1f5f9] font-medium">Paso 3 — Recibe tu lectura.</span> Las métricas se rellenan por nombre de anuncio y se marcan tus ganadores. Abajo también puedes planear la estructura de tus conjuntos.</p>
                </div>
              </details>
              <div className="flex items-end justify-between">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    <LayoutGrid className="w-6 h-6 text-[#3b82f6]" />
                    Conjuntos de anuncios
                  </h1>
                  <p className="text-sm text-[#64748b] mt-1">
                    Planifica cada conjunto alrededor de UN dolor, estructura sus anuncios por
                    etapa del embudo y luego sube el CSV de Meta para rellenar métricas y marcar
                    ganadores.
                  </p>
                </div>
                <button
                  onClick={createSet}
                  disabled={saving}
                  className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg gradient-blue text-white font-medium shrink-0 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" /> Nuevo conjunto
                </button>
              </div>

              {loading ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="w-7 h-7 text-[#3b82f6] animate-spin" />
                </div>
              ) : adsets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#1e1e2e] bg-[#0d0d14] p-12 text-center text-[#64748b] text-sm">
                  Crea tu primer conjunto: por ejemplo, &quot;Axilas — manchas&quot; con 4 anuncios TOFU/MOFU/BOFU.
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
                      <p className="text-xs text-[#94a3b8] mt-1 truncate">
                        Dolor: {s.pain || 'sin definir'}
                      </p>
                      <p className="text-[10px] text-[#475569] mt-2">
                        {new Date(s.created_at).toLocaleDateString('es-MX')}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => {
                    setSelected(null);
                    loadList();
                  }}
                  className="flex items-center gap-1.5 text-sm text-[#94a3b8] hover:text-[#f1f5f9]"
                >
                  <ChevronLeft className="w-4 h-4" /> Conjuntos
                </button>
                <button
                  onClick={removeSet}
                  className="p-2 rounded-lg text-[#94a3b8] hover:text-[#f43f5e] hover:bg-[#1e1e2e]"
                  title="Borrar conjunto"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
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
                <p className="text-[10px] text-[#64748b]">Se guarda solo mientras escribes.</p>
              </div>

              {/* Métricas de Meta */}
              <div className="rounded-2xl border border-[#1e1e2e] bg-[#0d0d14] p-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => csvRef.current?.click()}
                  className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-[#2e2e42] text-[#cbd5e1] hover:border-[#3b82f6]/50"
                >
                  <Upload className="w-3.5 h-3.5" /> Subir CSV de Meta
                </button>
                <input
                  ref={csvRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])}
                />
                <p className="text-[11px] text-[#64748b] flex-1 min-w-[200px]">
                  Exporta el reporte de anuncios desde Meta (con la columna &quot;Nombre del
                  anuncio&quot;). Las métricas se rellenan en cada anuncio cuyo nombre coincida.
                </p>
                {csvMsg && <p className="text-xs text-[#4ade80] w-full">{csvMsg}</p>}
              </div>

              {/* Anuncios */}
              <div className="space-y-3">
                {ads.map((ad) => {
                  const chips = metricChips(ad.metrics);
                  return (
                    <div
                      key={ad.id}
                      className={`rounded-2xl border p-4 space-y-2 ${
                        ad.is_winner
                          ? 'border-[#f59e0b]/50 bg-gradient-to-br from-[#241a08] to-[#111118]'
                          : 'border-[#1e1e2e] bg-[#111118]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          value={ad.name}
                          onChange={(e) => patchAd(ad.id, { name: e.target.value })}
                          className="flex-1 bg-transparent text-sm font-semibold text-[#f1f5f9] focus:outline-none border-b border-transparent focus:border-[#3b82f6]/50"
                        />
                        <select
                          value={ad.funnel_stage}
                          onChange={(e) => patchAd(ad.id, { funnel_stage: e.target.value })}
                          className="text-[11px] px-2 py-1.5 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-[#cbd5e1] focus:outline-none"
                        >
                          {STAGES.map((s) => (
                            <option key={s.v} value={s.v}>{s.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => patchAd(ad.id, { is_winner: !ad.is_winner })}
                          className={`p-1.5 rounded-lg ${ad.is_winner ? 'text-[#fbbf24]' : 'text-[#475569] hover:text-[#fbbf24]'}`}
                          title="Marcar ganador"
                        >
                          <Trophy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => removeAd(ad.id)}
                          className="p-1.5 rounded-lg text-[#475569] hover:text-[#f43f5e]"
                          title="Borrar anuncio"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <input
                        value={ad.pain ?? ''}
                        onChange={(e) => patchAd(ad.id, { pain: e.target.value })}
                        placeholder="Dolor que toca este anuncio"
                        className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-xs text-[#e2e8f0] placeholder:text-[#475569] focus:border-[#3b82f6]/50 focus:outline-none"
                      />
                      <textarea
                        value={ad.hypothesis ?? ''}
                        onChange={(e) => patchAd(ad.id, { hypothesis: e.target.value })}
                        rows={2}
                        placeholder="Hipótesis / explicación de la planificación"
                        className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-xs text-[#e2e8f0] placeholder:text-[#475569] focus:border-[#3b82f6]/50 focus:outline-none resize-y"
                      />
                      <textarea
                        value={ad.script ?? ''}
                        onChange={(e) => patchAd(ad.id, { script: e.target.value })}
                        rows={2}
                        placeholder="Qué dice el anuncio (guion / ángulo)"
                        className="w-full px-3 py-2 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] text-xs text-[#e2e8f0] placeholder:text-[#475569] focus:border-[#3b82f6]/50 focus:outline-none resize-y"
                      />

                      {chips.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {chips.map((c) => (
                            <span
                              key={c.label}
                              className="text-[10px] px-2 py-1 rounded-md bg-[#0a0a0f] border border-[#1e1e2e] text-[#cbd5e1]"
                            >
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
            </motion.div>
          )}

          {error && <p className="text-xs text-[#f43f5e]">{error}</p>}
        </div>
      </section>
    </main>
  );
}
