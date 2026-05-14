'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Scan, FileText, Film, Rocket, GitMerge, Eye } from 'lucide-react';
import StructuralAnalysis from './StructuralAnalysis';
import DashboardAnalysis from './DashboardAnalysis';
import ScriptBlock from './ScriptBlock';
import SeedancePrompts from './SeedancePrompts';
import ReplicationPlan from './ReplicationPlan';
import CrossAnalysis from './CrossAnalysis';
import type { AnalysisResult, VariantsResult, CrossAnalysisResult } from '@/lib/analysis-schema';

interface AnalysisResultsProps {
  results: Map<string, AnalysisResult>;
  crossAnalysis?: CrossAnalysisResult | null;
  onGenerateVariants?: (videoKey: string) => Promise<void>;
  onGenerateCrossAnalysis?: () => Promise<void>;
  isGeneratingVariants?: boolean;
  isGeneratingCross?: boolean;
}

type TabKey = 'dashboard' | 'analysis' | 'scripts' | 'seedance' | 'plan' | 'cross';

const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <Eye className="w-4 h-4" /> },
  { key: 'analysis', label: 'Analisis', icon: <Scan className="w-4 h-4" /> },
  { key: 'scripts', label: 'Guiones', icon: <FileText className="w-4 h-4" /> },
  { key: 'seedance', label: 'Seedance', icon: <Film className="w-4 h-4" /> },
  { key: 'plan', label: 'Plan', icon: <Rocket className="w-4 h-4" /> },
];

export default function AnalysisResults({
  results,
  crossAnalysis,
  onGenerateVariants,
  onGenerateCrossAnalysis,
  isGeneratingVariants = false,
  isGeneratingCross = false,
}: AnalysisResultsProps) {
  const videoKeys = useMemo(() => Array.from(results.keys()), [results]);
  const [activeVideoKey, setActiveVideoKey] = useState(videoKeys[0] ?? '');
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');

  const activeResult = results.get(activeVideoKey);
  const isMulti = videoKeys.length > 1;

  const allTabs = useMemo(() => {
    if (isMulti) {
      return [...tabs, { key: 'cross' as TabKey, label: 'Patrones', icon: <GitMerge className="w-4 h-4" /> }];
    }
    return tabs;
  }, [isMulti]);

  if (!activeResult) return null;

  return (
    <div className="w-full space-y-6">
      {/* Video Tabs (if multiple) */}
      {isMulti && activeTab !== 'cross' && (
        <div className="overflow-x-auto">
          <div className="flex gap-1 bg-[#111118] border border-[#1e1e2e] rounded-xl p-1 min-w-min">
            {videoKeys.map((key) => (
              <button
                key={key}
                onClick={() => setActiveVideoKey(key)}
                className={`
                  px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap
                  ${activeVideoKey === key
                    ? 'bg-[#3b82f6] text-white shadow-lg shadow-blue-500/20'
                    : 'text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#1e1e2e]'
                  }
                `}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Section Tabs */}
      <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-1 flex overflow-x-auto">
        {allTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`
              flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap
              ${activeTab === tab.key
                ? 'bg-[#1e1e2e] text-[#f1f5f9] shadow-sm'
                : 'text-[#64748b] hover:text-[#94a3b8]'
              }
            `}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <motion.div
        key={`${activeTab}-${activeVideoKey}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {activeTab === 'dashboard' && activeResult.dashboard && (
          <DashboardAnalysis dashboard={activeResult.dashboard} />
        )}

        {activeTab === 'analysis' && activeResult.structural_analysis && (
          <StructuralAnalysis data={activeResult.structural_analysis} />
        )}

        {activeTab === 'scripts' && (
          <ScriptBlock
            originalScript={activeResult.original_script ?? ''}
            variants={activeResult.script_variants ?? []}
            onGenerateMore={onGenerateVariants ? () => onGenerateVariants(activeVideoKey) : undefined}
            isGenerating={isGeneratingVariants}
          />
        )}

        {activeTab === 'seedance' && (
          <SeedancePrompts
            segments={activeResult.seedance_segments ?? []}
            onGenerateMore={onGenerateVariants ? () => onGenerateVariants(activeVideoKey) : undefined}
            isGenerating={isGeneratingVariants}
          />
        )}

        {activeTab === 'plan' && activeResult.replication_plan && (
          <ReplicationPlan plan={activeResult.replication_plan} />
        )}

        {activeTab === 'cross' && isMulti && (
          crossAnalysis ? (
            <CrossAnalysis data={crossAnalysis} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <GitMerge className="w-12 h-12 text-[#64748b]" />
              <p className="text-[#94a3b8] text-sm text-center max-w-md">
                Analiza los patrones comunes entre tus {videoKeys.length} videos para crear una formula maestra.
              </p>
              {onGenerateCrossAnalysis && (
                <button
                  onClick={onGenerateCrossAnalysis}
                  disabled={isGeneratingCross}
                  className="px-6 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#f59e0b] to-[#f97316] text-white
                    shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 transition-all disabled:opacity-50"
                >
                  {isGeneratingCross ? 'Analizando patrones...' : 'Generar Analisis Cruzado'}
                </button>
              )}
            </div>
          )
        )}
      </motion.div>
    </div>
  );
}
