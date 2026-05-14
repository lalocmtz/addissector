'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, Mic, Brain, Palette, Target, Zap, Camera, MessageSquare } from 'lucide-react';
import type { Dashboard } from '@/lib/analysis-schema';

interface DashboardAnalysisProps {
  dashboard: Dashboard;
}

function getScoreColor(score: number): string {
  if (score >= 7) return '#10b981';
  if (score >= 4) return '#f59e0b';
  return '#f43f5e';
}

function ScoreRing({ score }: { score: number }) {
  const color = getScoreColor(score);
  const circumference = 2 * Math.PI * 40;
  const filled = (score / 10) * circumference;

  return (
    <div className="relative w-28 h-28 flex items-center justify-center">
      <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#1e1e2e" strokeWidth="6" />
        <motion.circle
          cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round" strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - filled }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold font-mono" style={{ color }}>{score}</span>
        <span className="text-[#64748b] text-xs">/10</span>
      </div>
    </div>
  );
}

export default function DashboardAnalysis({ dashboard }: DashboardAnalysisProps) {
  const [activeSection, setActiveSection] = useState<'hook' | 'frames' | 'patterns'>('hook');
  const hook = dashboard?.hook ?? {};
  const patterns = dashboard?.patterns ?? {};
  const frames = dashboard?.visual_frames ?? [];

  const sections = [
    { key: 'hook' as const, label: 'Hook', icon: <Eye className="w-4 h-4" /> },
    { key: 'frames' as const, label: 'Frames', icon: <Camera className="w-4 h-4" /> },
    { key: 'patterns' as const, label: 'Patrones', icon: <Brain className="w-4 h-4" /> },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Hook Score Header */}
      <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <ScoreRing score={hook.effectiveness_score ?? 0} />
          <div className="space-y-3 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-[#8b5cf6]/15 text-[#8b5cf6] text-xs font-medium border border-[#8b5cf6]/25">
                {(hook.type ?? 'unknown').replace(/_/g, ' ')}
              </span>
              <span className="text-[#64748b] text-xs font-mono">
                {hook.duration_seconds ?? 0}s
              </span>
            </div>
            <p className="text-[#94a3b8] text-sm leading-relaxed max-w-lg">
              {hook.effectiveness_reasoning ?? ''}
            </p>
            {hook.scroll_stop_mechanism && (
              <div className="flex items-start gap-2 mt-2">
                <Target className="w-3.5 h-3.5 text-[#f59e0b] mt-0.5 shrink-0" />
                <p className="text-[#f59e0b] text-xs">{hook.scroll_stop_mechanism}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-1 bg-[#111118] border border-[#1e1e2e] rounded-xl p-1">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all flex-1 justify-center
              ${activeSection === s.key ? 'bg-[#1e1e2e] text-[#f1f5f9]' : 'text-[#64748b] hover:text-[#94a3b8]'}`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {/* Hook Details */}
      {activeSection === 'hook' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {/* Frame Descriptions */}
          {(hook.frame_descriptions ?? []).length > 0 && (
            <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
              <h4 className="text-[#64748b] text-xs uppercase tracking-wider mb-3">Descripcion Frame por Frame del Hook</h4>
              <div className="space-y-2">
                {(hook.frame_descriptions ?? []).map((desc, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="text-[#3b82f6] text-xs font-mono mt-0.5 shrink-0">F{i + 1}</span>
                    <p className="text-[#f1f5f9] text-sm border-l-2 border-[#1e1e2e] pl-3">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hook Audio & Visual */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Mic className="w-4 h-4 text-[#10b981]" />
                <h4 className="text-[#64748b] text-xs uppercase tracking-wider">Audio</h4>
              </div>
              <div className="space-y-2">
                <InfoLine label="Tono" value={hook.audio_tone ?? ''} />
                <InfoLine label="Musica" value={hook.music_type ?? ''} />
              </div>
            </div>
            <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Palette className="w-4 h-4 text-[#8b5cf6]" />
                <h4 className="text-[#64748b] text-xs uppercase tracking-wider">Visual</h4>
              </div>
              <InfoLine label="Text overlay" value={hook.text_overlay ?? 'Ninguno'} />
              {(hook.dominant_colors ?? []).length > 0 && (
                <div className="mt-2">
                  <span className="text-[#64748b] text-xs">Colores:</span>
                  <div className="flex gap-2 mt-1">
                    {(hook.dominant_colors ?? []).map((c, i) => (
                      <div key={i} className="flex items-center gap-1.5 bg-[#111118] rounded-lg px-2 py-1">
                        <div className="w-3 h-3 rounded-full border border-white/10" style={{ backgroundColor: c }} />
                        <span className="text-[#94a3b8] text-xs font-mono">{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Visual Frames */}
      {activeSection === 'frames' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          {frames.length === 0 && (
            <p className="text-[#64748b] text-sm text-center py-8">No hay frames visuales disponibles</p>
          )}
          {frames.map((frame, i) => (
            <div key={i} className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="px-2 py-0.5 rounded bg-[#3b82f6]/15 text-[#3b82f6] text-xs font-mono">
                  {frame.timestamp ?? `F${i + 1}`}
                </span>
                <span className="text-[#64748b] text-xs">{frame.subject ?? ''}</span>
              </div>
              <p className="text-[#f1f5f9] text-sm leading-relaxed mb-3">{frame.description ?? ''}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <InfoLine label="Composicion" value={frame.composition ?? ''} />
                <InfoLine label="Camara" value={frame.camera_movement ?? ''} />
                <InfoLine label="Texto" value={frame.text_on_screen ?? 'Ninguno'} />
              </div>
              {(frame.dominant_colors ?? []).length > 0 && (
                <div className="flex gap-1.5 mt-3">
                  {(frame.dominant_colors ?? []).map((c, ci) => (
                    <div key={ci} className="w-5 h-5 rounded border border-white/10" style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </motion.div>
      )}

      {/* Patterns */}
      {activeSection === 'patterns' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {/* Framework */}
          <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-[#f59e0b]" />
              <h4 className="text-[#64748b] text-xs uppercase tracking-wider">Framework de Persuasion</h4>
            </div>
            <span className="px-3 py-1.5 rounded-lg bg-[#f59e0b]/15 text-[#f59e0b] text-sm font-semibold border border-[#f59e0b]/25">
              {patterns.persuasion_framework ?? 'N/A'}
            </span>
          </div>

          {/* Retention Techniques */}
          {(patterns.retention_techniques ?? []).length > 0 && (
            <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
              <h4 className="text-[#64748b] text-xs uppercase tracking-wider mb-3">Tecnicas de Retencion</h4>
              <div className="flex flex-wrap gap-2">
                {(patterns.retention_techniques ?? []).map((t, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-full bg-[#3b82f6]/10 text-[#3b82f6] text-xs border border-[#3b82f6]/20">
                    {t.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Power Words */}
          {(patterns.power_words ?? []).length > 0 && (
            <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-4 h-4 text-[#10b981]" />
                <h4 className="text-[#64748b] text-xs uppercase tracking-wider">Power Words</h4>
              </div>
              <div className="flex flex-wrap gap-2">
                {(patterns.power_words ?? []).map((w, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-lg bg-[#10b981]/10 text-[#10b981] text-xs font-medium border border-[#10b981]/20">
                    &ldquo;{w}&rdquo;
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Emotional Arc & Pacing */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
              <h4 className="text-[#64748b] text-xs uppercase tracking-wider mb-2">Arco Emocional</h4>
              <p className="text-[#f1f5f9] text-sm leading-relaxed">{patterns.emotional_arc ?? ''}</p>
            </div>
            <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
              <h4 className="text-[#64748b] text-xs uppercase tracking-wider mb-2">Ritmo de Pacing</h4>
              <p className="text-[#f1f5f9] text-sm leading-relaxed">{patterns.pacing_rhythm ?? ''}</p>
            </div>
          </div>

          {/* Music & UGC */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
              <h4 className="text-[#64748b] text-xs uppercase tracking-wider mb-2">Estrategia de Musica</h4>
              <p className="text-[#f1f5f9] text-sm leading-relaxed">{patterns.music_strategy ?? ''}</p>
            </div>
            {(patterns.ugc_markers ?? []).length > 0 && (
              <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
                <h4 className="text-[#64748b] text-xs uppercase tracking-wider mb-2">Marcadores UGC</h4>
                <ul className="space-y-1">
                  {(patterns.ugc_markers ?? []).map((m, i) => (
                    <li key={i} className="text-[#f1f5f9] text-sm pl-3 border-l-2 border-[#8b5cf6]/30">{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[#64748b] text-xs">{label}:</span>
      <p className="text-[#f1f5f9] text-sm mt-0.5">{value}</p>
    </div>
  );
}
