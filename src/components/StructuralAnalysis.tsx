'use client';

import { motion } from 'framer-motion';
import { FileText, Clock, ShoppingBag, Video, Eye } from 'lucide-react';
import type { StructuralAnalysis as StructuralAnalysisType } from '@/lib/analysis-schema';

interface StructuralAnalysisProps {
  data: StructuralAnalysisType;
}

export default function StructuralAnalysis({ data }: StructuralAnalysisProps) {
  const ws = data.winning_structure ?? {};

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Video Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <InfoCard
          icon={<Video className="w-4 h-4" />}
          label="Tipo"
          value={data.video_type ?? 'N/A'}
        />
        <InfoCard
          icon={<Clock className="w-4 h-4" />}
          label="Duración"
          value={`${data.total_duration_seconds ?? 0}s`}
        />
        <InfoCard
          icon={<ShoppingBag className="w-4 h-4" />}
          label="Producto"
          value={data.product ?? 'N/A'}
        />
        <InfoCard
          icon={<Eye className="w-4 h-4" />}
          label="Segmentos Seedance"
          value={`${data.seedance_segments_count ?? 0} x 15s`}
        />
      </div>

      {/* Visual Context */}
      <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
        <h4 className="text-[#64748b] text-xs uppercase tracking-wider mb-2">Contexto Visual</h4>
        <p className="text-[#f1f5f9] text-sm leading-relaxed">{data.visual_context ?? ''}</p>
      </div>

      {/* Transcription Table */}
      <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#1e1e2e] flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#3b82f6]" />
          <h4 className="text-[#64748b] text-xs uppercase tracking-wider">Transcripcion Completa</h4>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e1e2e]">
                <th className="text-left px-5 py-2 text-[#64748b] text-xs font-medium w-20">Segundo</th>
                <th className="text-left px-5 py-2 text-[#64748b] text-xs font-medium">Lo que dice</th>
              </tr>
            </thead>
            <tbody>
              {(data.transcription ?? []).map((entry, i) => (
                <tr key={i} className="border-b border-[#1e1e2e]/50 last:border-0">
                  <td className="px-5 py-2 text-[#3b82f6] text-xs font-mono">{entry.second ?? ''}</td>
                  <td className="px-5 py-2 text-[#f1f5f9] text-sm">&ldquo;{entry.text ?? ''}&rdquo;</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Content Summary */}
      <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
        <h4 className="text-[#64748b] text-xs uppercase tracking-wider mb-2">Resumen del Contenido</h4>
        <p className="text-[#f1f5f9] text-sm leading-relaxed">{data.content_summary ?? ''}</p>
      </div>

      {/* Winning Structure */}
      <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5 space-y-4">
        <h4 className="text-[#64748b] text-xs uppercase tracking-wider">Estructura Ganadora Identificada</h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StructureCard
            label="Hook (0-3s)"
            value={ws.hook ?? ''}
            color="text-[#f59e0b]"
            borderColor="border-[#f59e0b]/30"
          />
          <StructureCard
            label="Desarrollo"
            value={ws.development ?? ''}
            color="text-[#3b82f6]"
            borderColor="border-[#3b82f6]/30"
          />
          <StructureCard
            label="CTA"
            value={ws.cta ?? ''}
            color="text-[#10b981]"
            borderColor="border-[#10b981]/30"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <span className="text-[#64748b] text-xs">Tono:</span>
            <p className="text-[#f1f5f9] text-sm mt-1">{ws.tone ?? ''}</p>
          </div>
          <div>
            <span className="text-[#64748b] text-xs">Formato:</span>
            <p className="text-[#f1f5f9] text-sm mt-1">{ws.format ?? ''}</p>
          </div>
          <div>
            <span className="text-[#64748b] text-xs">Persuasion:</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(ws.persuasion_elements ?? []).map((el, i) => (
                <span key={i} className="px-2 py-0.5 rounded-full bg-[#8b5cf6]/15 text-[#8b5cf6] text-xs border border-[#8b5cf6]/25">
                  {el}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[#3b82f6]">{icon}</span>
        <span className="text-[#64748b] text-xs uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-[#f1f5f9] text-sm font-medium">{value}</p>
    </div>
  );
}

function StructureCard({ label, value, color, borderColor }: { label: string; value: string; color: string; borderColor: string }) {
  return (
    <div className={`border ${borderColor} rounded-xl p-4 bg-[#111118]`}>
      <span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>{label}</span>
      <p className="text-[#f1f5f9] text-sm mt-2 leading-relaxed">{value}</p>
    </div>
  );
}
