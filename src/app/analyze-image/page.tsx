'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Scan, Loader2 } from 'lucide-react';
import CopyButton from '@/components/CopyButton';
import ImageAnalysisResults from '@/components/ImageAnalysisResults';
import { analysisToClipboardText } from '@/lib/copy-context';
import SimpleResults, { type ReplicaVariant } from '@/components/SimpleResults';
import { ensureImageInterpretation } from '@/lib/interpretation';
import type { ImageAnalysisResult } from '@/lib/analysis-schema';

type Entry = { analysis: ImageAnalysisResult; previewUrl: string | null };

function normalizeEntry(entry: Entry): Entry {
  // Rellena la interpretación simple en análisis viejos guardados en la biblioteca.
  return {
    ...entry,
    analysis: ensureImageInterpretation(
      entry.analysis as unknown as Record<string, unknown>
    ) as unknown as ImageAnalysisResult,
  };
}

/** Variantes de replicación → salida dual (prompt IA / brief equipo). */
function toReplicaVariants(analysis: ImageAnalysisResult): ReplicaVariant[] {
  return (analysis.replication?.variants ?? []).slice(0, 6).map((v) => ({
    id: v.variant_number,
    title: `Variante ${v.variant_number}`,
    subtitle: v.angle,
    prompt: v.prompt || '',
    teamBrief: v.team_brief || v.prompt || '',
  }));
}

export default function AnalyzeImagePage() {
  const router = useRouter();
  const [results, setResults] = useState<Map<string, Entry>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState('');
  const [creativeId, setCreativeId] = useState<string | null>(null);

  useEffect(() => {
    // Reopen a saved image creative from the library: /analyze-image?id=<uuid>
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) {
      fetch(`/api/creatives/${id}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          const analysis = data.analysis as ImageAnalysisResult;
          const name = data.name || 'Creativo';
          setResults(
            new Map([[name, normalizeEntry({ analysis, previewUrl: data.preview_url ?? null })]])
          );
          setActiveKey(name);
          setCreativeId(id);
        })
        .catch(() => router.push('/biblioteca'))
        .finally(() => setLoading(false));
      return;
    }

    const stored = sessionStorage.getItem('addissector-image-results');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Record<string, Entry>;
        const entries = Object.entries(parsed).map(
          ([k, v]) => [k, normalizeEntry(v)] as [string, Entry]
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

  const keys = useMemo(() => Array.from(results.keys()), [results]);
  const active = results.get(activeKey) ?? results.get(keys[0] ?? '');

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#8b5cf6] animate-spin" />
      </div>
    );
  }

  if (results.size === 0 || !active) return null;

  return (
    <main className="flex-1">
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
              <span className="text-sm font-semibold font-[family-name:var(--font-mono)]">AdDNA</span>
            </div>
          </div>
          <div className="text-xs text-[#64748b] font-[family-name:var(--font-mono)]">
            {results.size} imagen{results.size > 1 ? 'es' : ''} analizada{results.size > 1 ? 's' : ''}
          </div>
        </div>
      </header>

      <section className="px-6 py-8">
        <div className="max-w-5xl mx-auto">
          {/* Selector de imagen (si hay varias) */}
          {keys.length > 1 && (
            <div className="overflow-x-auto mb-6">
              <div className="flex gap-1 bg-[#111118] border border-[#1e1e2e] rounded-xl p-1 min-w-min">
                {keys.map((key) => (
                  <button
                    key={key}
                    onClick={() => setActiveKey(key)}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      (activeKey || keys[0]) === key
                        ? 'bg-[#8b5cf6] text-white shadow-lg shadow-purple-500/20'
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
            {/* Vista previa de la imagen (contexto rápido) */}
            {active.previewUrl && (
              <div className="mb-6 flex justify-center">
                <div className="rounded-2xl overflow-hidden border border-[#1e1e2e] bg-[#0a0a0f] max-w-[220px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={active.previewUrl} alt={activeKey} className="w-full object-contain" />
                </div>
              </div>
            )}

            {/* Copiar todo el contexto del creativo en un clic */}
            <div className="flex justify-end mb-3">
              <CopyButton
                text={analysisToClipboardText(
                  active.analysis as unknown as Record<string, unknown>,
                  activeKey || keys[0]
                )}
                label="Copiar todo el análisis"
              />
            </div>
            <SimpleResults
              verdict={active.analysis.verdict ?? ''}
              overallScore={active.analysis.overall_score ?? 0}
              scoreLabel={active.analysis.score_label ?? ''}
              signals={active.analysis.signals ?? null}
              winningRecipe={active.analysis.winning_recipe ?? []}
              keep={active.analysis.keep ?? []}
              test={active.analysis.test ?? []}
              variants={toReplicaVariants(active.analysis)}
            >
              {/* Capa 3 — análisis completo con los componentes existentes */}
              <ImageAnalysisResults results={results} />
            </SimpleResults>

                      </motion.div>
        </div>
      </section>
    </main>
  );
}
