'use client';

import { motion } from 'framer-motion';
import { Rocket, Film, Mic, Scissors } from 'lucide-react';
import CopyButton from './CopyButton';
import type { ReplicationPlan as ReplicationPlanType } from '@/lib/analysis-schema';

interface ReplicationPlanProps {
  plan: ReplicationPlanType;
}

export default function ReplicationPlan({ plan }: ReplicationPlanProps) {
  const fullPlanText = buildPlanText(plan);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Header with copy all */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="w-5 h-5 text-[#f59e0b]" />
          <h3 className="text-[#f1f5f9] text-lg font-semibold">Plan de Replicacion Completo</h3>
        </div>
        <CopyButton text={fullPlanText} label="Copiar Plan Completo" />
      </div>

      {/* Seedance Section */}
      <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Film className="w-4 h-4 text-[#3b82f6]" />
          <h4 className="text-[#f1f5f9] text-sm font-semibold">
            Seedance: {plan.seedance_count ?? 0} generaciones de 15s cada una
          </h4>
        </div>
        <div className="space-y-2">
          {(plan.segments_summary ?? []).map((seg, i) => (
            <div key={i} className="flex items-start gap-3 pl-2">
              <span className="text-[#3b82f6] text-xs font-mono mt-0.5 shrink-0">
                Seg {seg.segment ?? i + 1}:
              </span>
              <span className="text-[#94a3b8] text-sm">{seg.summary ?? ''}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ElevenLabs Section */}
      <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Mic className="w-4 h-4 text-[#10b981]" />
          <h4 className="text-[#f1f5f9] text-sm font-semibold">ElevenLabs</h4>
        </div>
        <div className="space-y-3">
          <div>
            <span className="text-[#64748b] text-xs">Guion a usar:</span>
            <p className="text-[#f1f5f9] text-sm mt-1">{plan.elevenlabs_script ?? ''}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[#64748b] text-xs">Duracion estimada:</span>
              <p className="text-[#f1f5f9] text-sm mt-1">{plan.audio_duration_estimate ?? 0} segundos</p>
            </div>
            <div>
              <span className="text-[#64748b] text-xs">Tono de voz:</span>
              <p className="text-[#f1f5f9] text-sm mt-1">{plan.voice_tone ?? ''}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Editing Notes */}
      <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Scissors className="w-4 h-4 text-[#8b5cf6]" />
          <h4 className="text-[#f1f5f9] text-sm font-semibold">Edicion Final</h4>
        </div>
        <p className="text-[#94a3b8] text-sm leading-relaxed">{plan.editing_notes ?? ''}</p>
      </div>
    </motion.div>
  );
}

function buildPlanText(plan: ReplicationPlanType): string {
  const lines: string[] = [];
  lines.push('Plan de Replicacion Completo');
  lines.push('');
  lines.push(`1. Seedance: ${plan.seedance_count ?? 0} generaciones de 15s cada una`);
  for (const seg of plan.segments_summary ?? []) {
    lines.push(`   - Segmento ${seg.segment ?? '?'}: ${seg.summary ?? ''}`);
  }
  lines.push('');
  lines.push(`2. ElevenLabs: ${plan.elevenlabs_script ?? ''}`);
  lines.push(`   - Duracion estimada del audio: ${plan.audio_duration_estimate ?? 0} segundos`);
  lines.push(`   - Tono de voz sugerido: ${plan.voice_tone ?? ''}`);
  lines.push('');
  lines.push(`3. Edicion final: ${plan.editing_notes ?? ''}`);
  return lines.join('\n');
}
