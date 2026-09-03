'use client';

import { motion } from 'framer-motion';
import { GitMerge, Zap, Target } from 'lucide-react';
import CopyButton from './CopyButton';
import ScriptBlock from './ScriptBlock';
import type { CrossAnalysisResult } from '@/lib/analysis-schema';

interface CrossAnalysisProps {
  data: CrossAnalysisResult;
}

export default function CrossAnalysis({ data }: CrossAnalysisProps) {
  const ce = data.common_elements ?? {};
  const mf = data.master_formula ?? {};

  const formulaText = [
 `Formula Maestra (${data.videos_analyzed ?? 0} videos)`,
    '',
 `Hook (0-3s): ${mf.hook ?? ''}`,
 `Desarrollo (3-12s): ${mf.development ?? ''}`,
 `CTA (12-15s): ${mf.cta ?? ''}`,
 `Setting recomendado: ${mf.recommended_setting ?? ''}`,
 `Tono: ${mf.tone ?? ''}`,
 `Elementos obligatorios: ${(mf.mandatory_elements ?? []).join(', ')}`,
  ].join('\n');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-warn/15 flex items-center justify-center">
          <GitMerge className="w-5 h-5 text-warn" />
        </div>
        <div>
          <h2 className="text-ink text-lg font-semibold">Analisis Cruzado — Patrones Ganadores</h2>
          <p className="text-ink-4 text-xs">{data.videos_analyzed ?? 0} videos analizados</p>
        </div>
      </div>

      {/* Common Elements */}
      <div className="bg-canvas border border-line rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-warn" />
          <h4 className="text-ink-4 text-xs uppercase tracking-wider">Elementos en Comun</h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InfoRow label="Hook" value={ce.hook_pattern ?? ''} />
          <InfoRow label="Estructura narrativa" value={ce.narrative_structure ?? ''} />
          <InfoRow label="Tono dominante" value={ce.dominant_tone ?? ''} />
          <InfoRow label="Duracion promedio" value={`${ce.average_duration ?? 0}s`} />
          <InfoRow label="Formato dominante" value={ce.dominant_format ?? ''} />
        </div>
        {(ce.recurring_persuasion ?? []).length > 0 && (
          <div>
            <span className="text-ink-4 text-xs">Persuasion recurrente:</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(ce.recurring_persuasion ?? []).map((el, i) => (
                <span key={i} className="px-2 py-0.5 rounded-full bg-accent/15 text-accent text-xs border border-accent/25">
                  {el}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Master Formula */}
      <div className="bg-canvas border border-line rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-ok" />
            <h4 className="text-ink text-sm font-semibold">Formula Maestra</h4>
          </div>
          <CopyButton text={formulaText} label="Copiar Formula" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FormulaCard label="Hook (0-3s)" value={mf.hook ?? ''} color="text-warn" borderColor="border-warn/30" />
          <FormulaCard label="Desarrollo" value={mf.development ?? ''} color="text-accent" borderColor="border-accent/30" />
          <FormulaCard label="CTA" value={mf.cta ?? ''} color="text-ok" borderColor="border-ok/30" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InfoRow label="Setting recomendado" value={mf.recommended_setting ?? ''} />
          <InfoRow label="Tono" value={mf.tone ?? ''} />
        </div>

        {(mf.mandatory_elements ?? []).length > 0 && (
          <div>
            <span className="text-ink-4 text-xs">Elementos obligatorios:</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(mf.mandatory_elements ?? []).map((el, i) => (
                <span key={i} className="px-2 py-0.5 rounded-full bg-ok/15 text-ok text-xs border border-ok/25">
                  {el}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Master Script */}
      <ScriptBlock
        originalScript={data.master_script ?? ''}
        variants={data.master_script_variants ?? []}
      />
    </motion.div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-ink-4 text-xs">{label}:</span>
      <p className="text-ink text-sm mt-0.5">{value}</p>
    </div>
  );
}

function FormulaCard({ label, value, color, borderColor }: { label: string; value: string; color: string; borderColor: string }) {
  return (
    <div className={`border ${borderColor} rounded-xl p-4 bg-surface`}>
      <span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>{label}</span>
      <p className="text-ink text-sm mt-2 leading-relaxed">{value}</p>
    </div>
  );
}
