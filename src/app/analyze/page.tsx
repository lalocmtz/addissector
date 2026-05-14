'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, Scan, Loader2 } from 'lucide-react';
import AnalysisResults from '@/components/AnalysisResults';
import type { AnalysisResult, CrossAnalysisResult } from '@/lib/analysis-schema';

export default function AnalyzePage() {
  const router = useRouter();
  const [results, setResults] = useState<Map<string, AnalysisResult>>(new Map());
  const [crossAnalysis, setCrossAnalysis] = useState<CrossAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [isGeneratingCross, setIsGeneratingCross] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('addissector-results');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Record<string, AnalysisResult>;
        setResults(new Map(Object.entries(parsed)));
      } catch {
        router.push('/');
      }
    } else {
      router.push('/');
    }
    setLoading(false);
  }, [router]);

  const handleGenerateVariants = async (videoKey: string) => {
    const analysis = results.get(videoKey);
    if (!analysis) return;

    setIsGeneratingVariants(true);
    try {
      const response = await fetch('/api/variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisJson: analysis }),
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
          next.set(videoKey, updated);
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#3b82f6] animate-spin" />
      </div>
    );
  }

  if (results.size === 0) return null;

  return (
    <main className="flex-1">
      {/* Header */}
      <header className="border-b border-[#1e1e2e] px-6 py-4 sticky top-0 z-50 bg-[#0a0a0f]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
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
                AdDissector
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
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <AnalysisResults
              results={results}
              crossAnalysis={crossAnalysis}
              onGenerateVariants={handleGenerateVariants}
              onGenerateCrossAnalysis={results.size >= 2 ? handleGenerateCrossAnalysis : undefined}
              isGeneratingVariants={isGeneratingVariants}
              isGeneratingCross={isGeneratingCross}
            />
          </motion.div>
        </div>
      </section>
    </main>
  );
}
