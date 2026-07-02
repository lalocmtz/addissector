'use client';

import { motion } from 'framer-motion';
import {
  Brain, Zap, ShoppingCart, Target, Gauge, AlertTriangle,
  Heart, Layers, Sparkles,
} from 'lucide-react';
import type { PsychologicalAnalysis as PsychData } from '@/lib/analysis-schema';

function Section({
  icon, title, children,
}: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-[#1e1e2e] flex items-center justify-center text-[#8b5cf6]">
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-[#f1f5f9] font-[family-name:var(--font-mono)]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Score({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(10, value || 0));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-[#1e1e2e] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6]"
          style={{ width: `${v * 10}%` }}
        />
      </div>
      <span className="text-xs font-bold text-[#cbd5e1] w-12 text-right">{v}/10 {label ? '' : ''}</span>
    </div>
  );
}

export default function PsychologicalAnalysis({ data }: { data: PsychData }) {
  if (!data) return null;
  const bp = data.buyer_psychology ?? { core_desire: '', core_pain: '', identity_shift: '', objections_handled: [] };
  const ss = data.scroll_stop ?? { mechanism: '', primary_trigger: '', strength_score: 0, reasoning: '' };
  const math = data.math_breakdown;
  const avatar = data.target_avatar;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid grid-cols-1 lg:grid-cols-2 gap-4"
    >
      {/* Why it converts — hero */}
      <div className="lg:col-span-2 rounded-2xl p-5 bg-gradient-to-br from-[#2a1a4a] to-[#111118] border border-[#8b5cf6]/30">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-[#a78bfa]" />
          <h3 className="text-sm font-semibold text-[#e9d5ff] font-[family-name:var(--font-mono)]">
            Por qué convierte
          </h3>
        </div>
        <p className="text-[#f1f5f9] leading-relaxed">{data.why_it_converts || '—'}</p>
      </div>

      {/* Scroll stop */}
      <Section icon={<Zap className="w-4 h-4" />} title="Scroll-stop (primeros 1-2s)">
        <div className="space-y-3">
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Mecanismo</span>
            <p className="text-sm text-[#e2e8f0]">{ss.mechanism || '—'}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Gatillo</span>
            <span className="text-xs px-2 py-0.5 rounded-md bg-[#1e1e2e] text-[#a78bfa]">{ss.primary_trigger || '—'}</span>
          </div>
          <Score value={ss.strength_score} label="" />
          <p className="text-xs text-[#94a3b8] leading-relaxed">{ss.reasoning}</p>
        </div>
      </Section>

      {/* Awareness & sophistication */}
      <Section icon={<Layers className="w-4 h-4" />} title="Consciencia y mercado">
        <div className="space-y-3">
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Nivel de consciencia (Schwartz)</span>
            <p className="text-sm text-[#e2e8f0]">{data.awareness_level || '—'}</p>
          </div>
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Sofisticación del mercado</span>
            <p className="text-sm text-[#e2e8f0]">{data.market_sophistication || '—'}</p>
          </div>
          {avatar && (
            <div className="pt-2 border-t border-[#1e1e2e]">
              <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Avatar</span>
              <p className="text-sm text-[#e2e8f0]">{avatar.who}</p>
              <p className="text-xs text-[#94a3b8] mt-1">{avatar.mindset}</p>
              <p className="text-xs text-[#8b5cf6] mt-1">{avatar.resonance_reason}</p>
            </div>
          )}
        </div>
      </Section>

      {/* Buyer psychology */}
      <Section icon={<ShoppingCart className="w-4 h-4" />} title="Psicología del comprador">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <div className="rounded-lg bg-[#0d0d14] p-3">
              <span className="text-[10px] uppercase tracking-wide text-[#22c55e]">Deseo profundo</span>
              <p className="text-sm text-[#e2e8f0]">{bp.core_desire || '—'}</p>
            </div>
            <div className="rounded-lg bg-[#0d0d14] p-3">
              <span className="text-[10px] uppercase tracking-wide text-[#ef4444]">Dolor agitado</span>
              <p className="text-sm text-[#e2e8f0]">{bp.core_pain || '—'}</p>
            </div>
            <div className="rounded-lg bg-[#0d0d14] p-3">
              <span className="text-[10px] uppercase tracking-wide text-[#3b82f6]">Cambio de identidad</span>
              <p className="text-sm text-[#e2e8f0]">{bp.identity_shift || '—'}</p>
            </div>
          </div>
          {bp.objections_handled?.length > 0 && (
            <div>
              <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Objeciones neutralizadas</span>
              <ul className="mt-1 space-y-1">
                {bp.objections_handled.map((o, i) => (
                  <li key={i} className="text-xs text-[#cbd5e1] flex gap-2">
                    <span className="text-[#8b5cf6]">✓</span>{o}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {/* Math breakdown */}
      {math && (
        <Section icon={<Gauge className="w-4 h-4" />} title="Desglose matemático">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg bg-[#0d0d14] p-2.5">
              <div className="text-[10px] text-[#64748b]">Hook</div>
              <div className="text-sm font-bold text-[#e2e8f0]">{math.hook_duration_seconds ?? 0}s</div>
              <div className="text-[10px] text-[#64748b]">ideal: {math.ideal_hook_window || '—'}</div>
            </div>
            <div className="rounded-lg bg-[#0d0d14] p-2.5">
              <div className="text-[10px] text-[#64748b]">CTA timing</div>
              <div className="text-sm text-[#e2e8f0]">{math.cta_timing || '—'}</div>
            </div>
          </div>
          <div className="mb-3">
            <div className="text-[10px] text-[#64748b] mb-1">Pacing</div>
            <Score value={math.pacing_score} label="" />
          </div>
          <div className="mb-3">
            <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Thumbstop</span>
            <p className="text-sm text-[#e2e8f0]">{math.thumbstop_estimate || '—'}</p>
          </div>
          {math.retention_risk_points?.length > 0 && (
            <div>
              <span className="text-[10px] uppercase tracking-wide text-[#f59e0b] flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Riesgos de retención
              </span>
              <ul className="mt-1 space-y-1">
                {math.retention_risk_points.map((r, i) => (
                  <li key={i} className="text-xs text-[#cbd5e1]">
                    <span className="text-[#f59e0b] font-mono">{r.timestamp}</span> — {r.risk}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* Persuasion triggers */}
      {data.persuasion_triggers?.length > 0 && (
        <Section icon={<Target className="w-4 h-4" />} title="Gatillos de persuasión">
          <div className="space-y-2">
            {data.persuasion_triggers.map((t, i) => (
              <div key={i} className="rounded-lg bg-[#0d0d14] p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-[#a78bfa] capitalize">{t.trigger?.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] font-mono text-[#64748b]">{t.timestamp}</span>
                </div>
                <p className="text-xs text-[#cbd5e1]">{t.how_used}</p>
                <div className="mt-2"><Score value={t.strength} label="" /></div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Cognitive biases + emotional journey */}
      <Section icon={<Brain className="w-4 h-4" />} title="Sesgos y arco emocional">
        {data.cognitive_biases?.length > 0 && (
          <div className="mb-4">
            <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Sesgos cognitivos</span>
            <div className="mt-2 space-y-2">
              {data.cognitive_biases.map((b, i) => (
                <div key={i} className="text-xs text-[#cbd5e1]">
                  <span className="text-[#8b5cf6] font-semibold capitalize">{b.bias?.replace(/_/g, ' ')}:</span> {b.how_exploited}
                </div>
              ))}
            </div>
          </div>
        )}
        {data.emotional_journey?.length > 0 && (
          <div>
            <span className="text-[10px] uppercase tracking-wide text-[#64748b] flex items-center gap-1">
              <Heart className="w-3 h-3 text-[#ef4444]" /> Arco emocional
            </span>
            <div className="mt-2 space-y-1.5">
              {data.emotional_journey.map((e, i) => (
                <div key={i} className="flex gap-2 text-xs">
                  <span className="font-mono text-[#64748b] w-12 shrink-0">{e.second}</span>
                  <span className="text-[#e2e8f0] font-medium">{e.emotion}</span>
                  <span className="text-[#94a3b8]">— {e.purpose}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>
    </motion.div>
  );
}
