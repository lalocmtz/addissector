'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Scan, Loader2 } from 'lucide-react';
import CreativeOnePager, { type ReplicaVariant } from '@/components/CreativeOnePager';
import CrossAnalysis from '@/components/CrossAnalysis';
import { analysisToClipboardText } from '@/lib/copy-context';
import { ensureVideoInterpretation } from '@/lib/interpretation';
import { getStoredActiveBrandId } from '@/lib/use-me';
import type { AnalysisResult, CrossAnalysisResult } from '@/lib/analysis-schema';

function normalizeResult(a: AnalysisResult): AnalysisResult {
  // Rellena la interpretación simple en análisis viejos guardados en la biblioteca.
  return ensureVideoInterpretation(a as unknown as Record<string, unknown>) as unknown as AnalysisResult;
}

/** Convierte las variantes de guion en la salida dual (prompt IA / brief equipo). */
function toReplicaVariants(analysis: AnalysisResult): ReplicaVariant[] {
  const keep = (analysis.keep ?? []).join('; ');
  return (analysis.script_variants ?? []).slice(0, 6).map((v) => ({
    id: v.variant_number,
    title: `Variante ${v.variant_number}`,
    subtitle: v.scenario,
    prompt:
      v.prompt ||
      [
 `Genera un video anuncio estilo UGC vertical (9:16).`,
        v.scenario ? `Escenario/persona: ${v.scenario}.` : '',
 `Guion (voz en off, respétalo tal cual):\n"${v.script}"`,
        keep ? `Elementos que NO deben cambiar: ${keep}.` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    teamBrief: v.team_brief || v.script,
  }));
}

// ---------------------------------------------------------------------------
// El cerebro comiendo: cuenta lo que se guardó en lenguaje de Eduardo.
// ---------------------------------------------------------------------------

interface BrainCounts { personas: number; angles: number; hooks: number; learnings: number }

const emptyCounts = (): BrainCounts => ({ personas: 0, angles: 0, hooks: 0, learnings: 0 });

function brainLabel(created: BrainCounts, merged: BrainCounts): string {
  const parts: string[] = [];
  if (created.hooks) parts.push(`${created.hooks} hook${created.hooks > 1 ? 's' : ''}`);
  if (created.angles) parts.push(`${created.angles} ángulo${created.angles > 1 ? 's' : ''} nuevo${created.angles > 1 ? 's' : ''}`);
  if (created.personas) parts.push(`${created.personas} persona${created.personas > 1 ? 's' : ''}`);
  if (created.learnings) parts.push(`${created.learnings} aprendizaje${created.learnings > 1 ? 's' : ''}`);
  if (parts.length) return `Cerebro alimentado — ${parts.join(', ')}`;
  const refuerzo = merged.personas + merged.angles;
  if (refuerzo) return `Cerebro actualizado — reforzó ${refuerzo} ficha${refuerzo > 1 ? 's' : ''} que ya tenías`;
  return 'Cerebro al día — nada nuevo que guardar';
}

export default function AnalyzePage() {
  const router = useRouter();
  const [results, setResults] = useState<Map<string, AnalysisResult>>(new Map());
  const [crossAnalysis, setCrossAnalysis] = useState<CrossAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [isGeneratingCross, setIsGeneratingCross] = useState(false);
  const [activeKey, setActiveKey] = useState<string>('');
  const [creativeId, setCreativeId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [adName, setAdName] = useState<string | null>(null);
  const [metaStats, setMetaStats] = useState<{
    ad_name: string; spend: number; roas: number | null; hook_rate: number | null; ret50: number | null;
    ret75: number | null; cvr: number | null; freq: number | null; cpa: number | null;
    fusion: string | null;
  } | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [fusing, setFusing] = useState(false);
  const [fusionError, setFusionError] = useState<string | null>(null);
  const [feedingBrain, setFeedingBrain] = useState(false);
  const [brainChip, setBrainChip] = useState<string | null>(null);
  const brainBusy = useRef(false);
  const autoFed = useRef(false);

  /** Manda uno o varios análisis al Cerebro. Corre en segundo plano: la vista
   *  del análisis nunca se bloquea, el chip aparece cuando termina. */
  const feedBrain = useCallback(async (ids: string[], bid: string | null) => {
    const clean = ids.filter(Boolean);
    if (!clean.length || brainBusy.current) return;
    brainBusy.current = true;
    setFeedingBrain(true);
    const created = emptyCounts();
    const merged = emptyCounts();
    try {
      for (const id of clean) {
        const res = await fetch('/api/brain/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creativeId: id, brandId: bid }),
        });
        const data = (await res.json()) as { created?: BrainCounts; merged?: BrainCounts };
        for (const k of ['personas', 'angles', 'hooks', 'learnings'] as const) {
          created[k] += data.created?.[k] ?? 0;
          merged[k] += data.merged?.[k] ?? 0;
        }
      }
      setBrainChip(brainLabel(created, merged));
    } catch {
      setBrainChip(null);
    } finally {
      brainBusy.current = false;
      setFeedingBrain(false);
    }
  }, []);

  // Disparo automático tras guardar un análisis nuevo: studio deja los ids
  // recién guardados en sessionStorage y aquí el cerebro se los come solo.
  useEffect(() => {
    if (autoFed.current) return;
    const raw = sessionStorage.getItem('addna-ingest-queue');
    if (!raw) return;
    autoFed.current = true;
    sessionStorage.removeItem('addna-ingest-queue');
    let ids: string[] = [];
    try {
      ids = JSON.parse(raw) as string[];
    } catch {
      return;
    }
    if (ids.length) void Promise.resolve().then(() => feedBrain(ids, null));
  }, [feedBrain]);

  const generateFusion = async () => {
    if (!brandId || !metaStats) return;
    setFusing(true);
    setFusionError(null);
    try {
      const res = await fetch('/api/fusion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, adName: metaStats.ad_name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setMetaStats((m) => (m ? { ...m, fusion: data.fusion } : m));
    } catch (err) {
      setFusionError(err instanceof Error ? err.message : 'Error generando el análisis');
    } finally {
      setFusing(false);
    }
  };

  useEffect(() => {
    // Reopen a saved creative from the library: /analyze?id=<uuid>
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) {
      fetch(`/api/creatives/${id}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          // Image creatives have their own results view.
          if (data.type === 'image') {
            router.replace(`/analyze-image?id=${id}`);
            return;
          }
          const analysis = normalizeResult(data.analysis as AnalysisResult);
          const name = data.name || 'Creativo';
          setResults(new Map([[name, analysis]]));
          setActiveKey(name);
          setCreativeId(id);
          setVideoUrl(data.video_url ?? null);
          setAdName(data.ad_name ?? null);
          // Cruza con las métricas de Meta del mismo anuncio (memoria completa)
          const lookup = data.ad_name || data.name;
          setBrandId(data.brand_id ?? null);
          if (data.brand_id && lookup) {
            const norm = (s: string) =>
              s.toLowerCase().replace(/\.(mp4|mov|webm|m4v|png|jpg|jpeg)$/i, '').replace(/\s+/g, ' ').trim();
            fetch(`/api/meta/ads?brand=${data.brand_id}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => {
                const hit = (d?.ads ?? []).find((a: { ad_name: string }) => norm(a.ad_name) === norm(lookup));
                if (hit) setMetaStats(hit);
              })
              .catch(() => {});
          }
        })
        .catch(() => router.push('/biblioteca'))
        .finally(() => setLoading(false));
      return;
    }

    const stored = sessionStorage.getItem('addissector-results');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Record<string, AnalysisResult>;
        const entries = Object.entries(parsed).map(
          ([k, v]) => [k, normalizeResult(v)] as [string, AnalysisResult]
        );
        setResults(new Map(entries));
        setActiveKey(entries[0]?.[0] ?? '');
      } catch {
        router.push('/studio');
      }
    } else {
      router.push('/studio');
    }
    setLoading(false);
  }, [router]);

  const handleGenerateVariants = async (videoKey: string) => {
    const analysis = results.get(videoKey);
    if (!analysis) return;

    setIsGeneratingVariants(true);
    try {
      // Contexto de la marca activa para enriquecer las variantes.
      let brandContext: Record<string, unknown> | null = null;
      try {
        const brandId = getStoredActiveBrandId();
        if (brandId) {
          const meRes = await fetch('/api/me');
          if (meRes.ok) {
            const me = await meRes.json();
            const brand = (me.brands ?? []).find((b: { id: string }) => b.id === brandId);
            if (brand) {
              brandContext = {
                name: brand.name,
                tone: brand.tone,
                palette: brand.palette,
                product: brand.product,
              };
            }
          }
        }
      } catch {
        /* sin contexto de marca */
      }

      const response = await fetch('/api/variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisJson: analysis, brandContext }),
      });

      if (!response.ok) throw new Error('Failed to generate variants');

      const newVariants = await response.json();

      // Merge new variants into the existing analysis
      setResults(prev => {
        const next = new Map(prev);
        const current = next.get(videoKey);
        if (current) {
          const updated = { ...current };
          if (newVariants.script_variants) {
            updated.script_variants = [
              ...(current.script_variants ?? []),
              ...newVariants.script_variants,
            ];
          }
          next.set(videoKey, normalizeResult(updated));
        }
        return next;
      });
    } catch (error) {
      console.error('Variant generation error:', error);
    } finally {
      setIsGeneratingVariants(false);
    }
  };

  const handleGenerateCrossAnalysis = async () => {
    if (results.size < 2) return;

    setIsGeneratingCross(true);
    try {
      const analyses = Array.from(results.values());
      const response = await fetch('/api/cross-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analyses }),
      });

      if (!response.ok) throw new Error('Failed to generate cross-analysis');

      const data: CrossAnalysisResult = await response.json();
      setCrossAnalysis(data);
    } catch (error) {
      console.error('Cross-analysis error:', error);
    } finally {
      setIsGeneratingCross(false);
    }
  };

  const keys = useMemo(() => Array.from(results.keys()), [results]);
  const active = results.get(activeKey) ?? results.get(keys[0] ?? '');

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  if (results.size === 0 || !active) return null;

  return (
    <main className="flex-1">
      {/* Header */}
      <header className="border-b border-line px-6 py-4 sticky top-0 z-50 bg-canvas/90 ">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push(creativeId ? '/biblioteca' : '/studio')}
              className="flex items-center gap-2 text-sm text-ink-3 hover:text-ink transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {creativeId ? 'Biblioteca' : 'Nuevo análisis'}
            </button>
            <div className="w-px h-6 bg-surface-2" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-blue flex items-center justify-center">
                <Scan className="w-4 h-4 text-on-accent" />
              </div>
              <span className="text-sm font-semibold font-[family-name:var(--font-mono)]">
                AdDNA
              </span>
            </div>
          </div>
          <div className="text-xs text-ink-4 font-[family-name:var(--font-mono)]">
            {results.size} video{results.size > 1 ? 's' : ''} analizado{results.size > 1 ? 's' : ''}
          </div>
        </div>
      </header>

      {/* Results */}
      <section className="px-6 py-8">
        <div className="max-w-5xl mx-auto">
          {/* Selector de video (si hay varios) */}
          {keys.length > 1 && (
            <div className="overflow-x-auto mb-6">
              <div className="flex gap-1 bg-surface border border-line rounded-xl p-1 min-w-min">
                {keys.map((key) => (
                  <button
                    key={key}
                    onClick={() => setActiveKey(key)}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      (activeKey || keys[0]) === key
                        ? 'bg-accent text-on-accent shadow-lg '
                        : 'text-ink-3 hover:text-ink hover:bg-surface-2'
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>
          )}

          <motion.div
            key={activeKey}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6 lg:items-start">
              {/* Columna izquierda FIJA: el video siempre visible mientras lees */}
              {(videoUrl || metaStats) && (
                <div className="lg:sticky lg:top-24 mb-6 lg:mb-0 space-y-3">
                  {videoUrl && (
                    <video
                      src={videoUrl}
                      controls
                      playsInline
                      className="w-full max-h-[440px] rounded-xl bg-overlay object-contain border border-line"
                    />
                  )}
                  <div className="rounded-xl border border-line bg-surface p-3">
                    <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-2 truncate" title={adName ?? undefined}>
                      {adName ? `Meta: ${adName}` : 'Creativo'}
                    </p>
                    {metaStats ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        {([
                          ['Gasto', `$${Math.round(metaStats.spend).toLocaleString()}`],
                          ['ROAS', metaStats.roas != null ? metaStats.roas.toFixed(2) : '—'],
                          ['CPA', metaStats.cpa != null ? `$${metaStats.cpa.toFixed(2)}` : '—'],
                          ['Hook', metaStats.hook_rate != null ? `${metaStats.hook_rate.toFixed(1)}%` : '—'],
                          ['Ret 50%', metaStats.ret50 != null ? `${metaStats.ret50.toFixed(0)}%` : '—'],
                          ['Ret 75%', metaStats.ret75 != null ? `${metaStats.ret75.toFixed(0)}%` : '—'],
                          ['CVR', metaStats.cvr != null ? `${metaStats.cvr.toFixed(2)}%` : '—'],
                          ['Frec', metaStats.freq != null ? metaStats.freq.toFixed(1) : '—'],
                        ] as const).map(([l, v]) => (
                          <div key={l} className="rounded-lg bg-canvas border border-surface-2 px-2 py-1.5">
                            <p className="text-[8px] uppercase tracking-wide text-ink-4">{l}</p>
                            <p className="text-xs font-bold font-[family-name:var(--font-mono)] text-ink">{v}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-4">
                        Aún no cruza con la memoria de Meta (nombres distintos). Sube el export en Meta
                        o usa el nombre exacto del anuncio.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="min-w-0">
                {/* Análisis fusionado: video × Meta */}
                {metaStats && (
                  <div className="mb-5 rounded-xl border border-accent/25 bg-accent/5 p-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-accent">
                        ✦ Análisis fusionado · video × Meta
                      </p>
                      <button
                        onClick={generateFusion}
                        disabled={fusing}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-accent text-on-accent font-medium disabled:opacity-60"
                      >
                        {fusing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        {fusing ? 'Desmenuzando… (~1 min)' : metaStats.fusion ? 'Regenerar' : 'Desmenuzar con los números de Meta'}
                      </button>
                    </div>
                    {fusionError && <p className="text-xs text-danger mb-2">{fusionError}</p>}
                    {metaStats.fusion ? (
                      <div className="text-xs text-ink-2 whitespace-pre-wrap leading-relaxed max-h-[440px] overflow-y-auto rounded-lg bg-canvas/60 p-3">
                        {metaStats.fusion}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-3">
                        Psicólogo + creative strategist + analista: línea de tiempo segundo a segundo,
                        guion, dolores, psicología, dónde se pierde la atención y cómo mejorarlo — todo
                        cruzado con la retención y conversión reales.
                      </p>
                    )}
                  </div>
                )}

                {/* UN SOLO entregable: veredicto -> qué hacer -> línea de tiempo ->
                    por qué funciona -> dónde se pierde -> guion y prompts (colapsados) */}
                <CreativeOnePager
                  analysis={active}
                  name={adName || activeKey || keys[0]}
                  retention={
                    metaStats
                      ? { hookRate: metaStats.hook_rate, ret50: metaStats.ret50, ret75: metaStats.ret75 }
                      : null
                  }
                  variants={toReplicaVariants(active)}
                  onGenerateVariants={() => handleGenerateVariants(activeKey || keys[0])}
                  isGeneratingVariants={isGeneratingVariants}
                  onFeedBrain={creativeId ? () => void feedBrain([creativeId], brandId) : undefined}
                  feedingBrain={feedingBrain}
                  brainChip={brainChip}
                  copyAllText={
                    analysisToClipboardText(
                      active as unknown as Record<string, unknown>,
                      activeKey || keys[0]
                    ) +
                    (metaStats?.fusion
                      ? `\n\n=== ANÁLISIS FUSIONADO (video × Meta) ===\n${metaStats.fusion}`
                      : '')
                  }
                />

                {/* Patrón común cuando se analizan varios videos a la vez */}
                {keys.length > 1 && (
                  <div className="mt-8">
                    {crossAnalysis ? (
                      <CrossAnalysis data={crossAnalysis} />
                    ) : (
                      <button
                        onClick={handleGenerateCrossAnalysis}
                        disabled={isGeneratingCross}
                        className="w-full py-3 rounded-xl border border-dashed border-line-strong text-sm text-ink-3 hover:text-ink hover:border-accent/50 transition-colors disabled:opacity-50"
                      >
                        {isGeneratingCross
                          ? 'Buscando patrones…'
                          : `Buscar el patrón común entre los ${keys.length} videos`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
