'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Scan, Loader2 } from 'lucide-react';
import AnalysisResults from '@/components/AnalysisResults';
import CloneStudio from '@/components/CloneStudio';
import SimpleResults, { type ReplicaVariant } from '@/components/SimpleResults';
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

export default function AnalyzePage() {
  const router = useRouter();
  const [results, setResults] = useState<Map<string, AnalysisResult>>(new Map());
  const [crossAnalysis, setCrossAnalysis] = useState<CrossAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [isGeneratingCross, setIsGeneratingCross] = useState(false);
  const [activeKey, setActiveKey] = useState<string>('');
  const [creativeId, setCreativeId] = useState<string | null>(null);

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
          if (newVariants.seedance_variants && Array.isArray(newVariants.seedance_variants)) {
            const existingSegments = [...(current.seedance_segments ?? [])];
            for (const sv of newVariants.seedance_variants) {
              const segIndex = existingSegments.findIndex(
                s => s.segment_number === sv.segment_number
              );
              if (segIndex !== -1) {
                existingSegments[segIndex] = {
                  ...existingSegments[segIndex],
                  variants: [
                    ...(existingSegments[segIndex].variants ?? []),
                    ...(sv.variants ?? []),
                  ],
                };
              }
            }
            updated.seedance_segments = existingSegments;
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
        <Loader2 className="w-8 h-8 text-[#3b82f6] animate-spin" />
      </div>
    );
  }

  if (results.size === 0 || !active) return null;

  return (
    <main className="flex-1">
      {/* Header */}
      <header className="border-b border-[#1e1e2e] px-6 py-4 sticky top-0 z-50 bg-[#0a0a0f]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/studio')}
              className="flex items-center gap-2 text-sm text-[#94a3b8] hover:text-[#f1f5f9] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Nuevo analisis
            </button>
            <div className="w-px h-6 bg-[#1e1e2e]" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-blue flex items-center justify-center">
                <Scan className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm font-semibold font-[family-name:var(--font-mono)]">
                AdDNA
              </span>
            </div>
          </div>
          <div className="text-xs text-[#64748b] font-[family-name:var(--font-mono)]">
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
              <div className="flex gap-1 bg-[#111118] border border-[#1e1e2e] rounded-xl p-1 min-w-min">
                {keys.map((key) => (
                  <button
                    key={key}
                    onClick={() => setActiveKey(key)}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      (activeKey || keys[0]) === key
                        ? 'bg-[#3b82f6] text-white shadow-lg shadow-blue-500/20'
                        : 'text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#1e1e2e]'
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
            <SimpleResults
              verdict={active.verdict ?? ''}
              overallScore={active.overall_score ?? 0}
              scoreLabel={active.score_label ?? ''}
              signals={active.signals ?? null}
              winningRecipe={active.winning_recipe ?? []}
              keep={active.keep ?? []}
              test={active.test ?? []}
              variants={toReplicaVariants(active)}
            >
              {/* Capa 3 — análisis completo con los componentes existentes */}
              <AnalysisResults
                results={results}
                crossAnalysis={crossAnalysis}
                onGenerateVariants={handleGenerateVariants}
                onGenerateCrossAnalysis={results.size >= 2 ? handleGenerateCrossAnalysis : undefined}
                isGeneratingVariants={isGeneratingVariants}
                isGeneratingCross={isGeneratingCross}
              />
            </SimpleResults>

            {/* Estudio de clonación: de la variante al video UGC generado */}
            <div className="mt-6">
              <CloneStudio
                analysis={active as unknown as Record<string, unknown>}
                creativeType="video"
                creativeId={creativeId}
                variantOptions={[
                  { value: null, label: 'Fiel al original (con persona nueva)' },
                  ...(active.script_variants ?? []).map((v) => ({
                    value: v.variant_number,
                    label: `Variante ${v.variant_number} — ${v.scenario}`,
                  })),
                ]}
              />
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
