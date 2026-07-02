'use client';

// =============================================================================
// AdDNA — Vista de resultados en 3 capas:
//   Capa 1: El veredicto (frase + score 0-100 + 3 semáforos sin jerga)
//   Capa 2: La receta ganadora + cómo hacer más (Modo IA / Modo Equipo)
//   Capa 3: Análisis completo (children, colapsado, "para nerds")
// =============================================================================

import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Zap, Eye, Tag, ChevronDown, Sparkles, Users, Lock, FlaskConical, Microscope,
} from 'lucide-react';
import CopyButton from './CopyButton';
import type { SimpleSignal, SimpleSignals } from '@/lib/analysis-schema';

export interface ReplicaVariant {
  id: string | number;
  title: string;      // ej. "Variante 1"
  subtitle?: string;  // ángulo / escenario
  prompt: string;     // Modo IA: listo para pegar en un generador
  teamBrief: string;  // Modo Equipo: brief para diseñador/editor
}

interface SimpleResultsProps {
  verdict: string;
  overallScore: number;
  scoreLabel: string;
  signals?: SimpleSignals | null;
  winningRecipe: string[];
  keep: string[];
  test: string[];
  variants: ReplicaVariant[];
  /** Contenido técnico completo (Capa 3). */
  children?: ReactNode;
}

const SIGNAL_META: Array<{ key: keyof SimpleSignals; label: string; icon: ReactNode }> = [
  { key: 'scroll_stop', label: 'Detiene el scroll', icon: <Zap className="w-4 h-4" /> },
  { key: 'clarity', label: 'Se entiende al instante', icon: <Eye className="w-4 h-4" /> },
  { key: 'offer', label: 'Oferta convincente', icon: <Tag className="w-4 h-4" /> },
];

function signalColors(level: string): { dot: string; border: string; text: string } {
  if (level === 'alto') return { dot: 'bg-[#22c55e]', border: 'border-[#22c55e]/30', text: 'text-[#4ade80]' };
  if (level === 'medio') return { dot: 'bg-[#f59e0b]', border: 'border-[#f59e0b]/30', text: 'text-[#fbbf24]' };
  return { dot: 'bg-[#f43f5e]', border: 'border-[#f43f5e]/30', text: 'text-[#fb7185]' };
}

function scoreColors(score: number): { ring: string; label: string } {
  if (score >= 75) return { ring: '#22c55e', label: 'text-[#4ade80]' };
  if (score >= 50) return { ring: '#f59e0b', label: 'text-[#fbbf24]' };
  return { ring: '#f43f5e', label: 'text-[#fb7185]' };
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, score));
  const { ring, label: labelColor } = scoreColors(clamped);
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 80 80" className="w-24 h-24 -rotate-90">
          <circle cx="40" cy="40" r={r} fill="none" stroke="#1e1e2e" strokeWidth="7" />
          <circle
            cx="40" cy="40" r={r} fill="none" stroke={ring} strokeWidth="7"
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - clamped / 100)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-[#f1f5f9]">{clamped}</span>
          <span className="text-[9px] text-[#64748b] font-[family-name:var(--font-mono)]">/100</span>
        </div>
      </div>
      <span className={`text-xs font-bold uppercase tracking-wide ${labelColor}`}>{label}</span>
    </div>
  );
}

export default function SimpleResults({
  verdict,
  overallScore,
  scoreLabel,
  signals,
  winningRecipe,
  keep,
  test,
  variants,
  children,
}: SimpleResultsProps) {
  const [mode, setMode] = useState<'ia' | 'equipo'>('ia');
  const [showFull, setShowFull] = useState(false);

  return (
    <div className="space-y-6">
      {/* ============ CAPA 1 — EL VEREDICTO ============ */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-[#3b82f6]/25 bg-gradient-to-br from-[#12203a] to-[#111118] p-6"
      >
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <ScoreRing score={overallScore} label={scoreLabel} />
          <div className="flex-1 text-center sm:text-left">
            <p className="text-[10px] uppercase tracking-wider text-[#60a5fa] font-[family-name:var(--font-mono)] mb-2">
              Por qué funciona
            </p>
            <h2 className="text-xl sm:text-2xl font-bold leading-snug text-[#f1f5f9]">
              {verdict}
            </h2>
          </div>
        </div>

        {signals && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
            {SIGNAL_META.map(({ key, label, icon }) => {
              const sig: SimpleSignal | undefined = signals[key];
              if (!sig) return null;
              const colors = signalColors(sig.level);
              return (
                <div
                  key={key}
                  className={`rounded-xl border ${colors.border} bg-[#0d0d14]/70 px-4 py-3`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    <span className="text-[#94a3b8]">{icon}</span>
                    <span className="text-xs font-semibold text-[#f1f5f9]">{label}</span>
                    <span className={`ml-auto text-[10px] font-bold uppercase ${colors.text}`}>
                      {sig.level}
                    </span>
                  </div>
                  <p className="text-xs text-[#94a3b8] leading-relaxed">{sig.note}</p>
                </div>
              );
            })}
          </div>
        )}
      </motion.section>

      {/* ============ CAPA 2 — LA RECETA + CÓMO HACER MÁS ============ */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        {/* La receta ganadora */}
        <div className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5">
          <h3 className="text-sm font-semibold text-[#f1f5f9] mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#8b5cf6]" />
            La receta ganadora
          </h3>
          {winningRecipe.length > 0 ? (
            <ul className="space-y-2.5">
              {winningRecipe.map((r, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-[#cbd5e1] leading-relaxed">
                  <span className="text-[#8b5cf6] font-bold font-[family-name:var(--font-mono)] shrink-0">
                    {i + 1}.
                  </span>
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[#64748b]">Sin receta disponible.</p>
          )}
        </div>

        {/* Qué mantener vs qué probar */}
        <div className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[#f1f5f9] mb-2 flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#22c55e]" />
              Qué mantener <span className="text-[10px] text-[#64748b] font-normal">(no negociable)</span>
            </h3>
            {keep.length > 0 ? (
              <ul className="space-y-1.5">
                {keep.map((k, i) => (
                  <li key={i} className="text-sm text-[#cbd5e1] flex gap-2">
                    <span className="text-[#22c55e] shrink-0">✓</span>
                    {k}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#64748b]">—</p>
            )}
          </div>
          <div className="pt-3 border-t border-[#1e1e2e]">
            <h3 className="text-sm font-semibold text-[#f1f5f9] mb-2 flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-[#f59e0b]" />
              Qué probar <span className="text-[10px] text-[#64748b] font-normal">(hipótesis de mejora)</span>
            </h3>
            {test.length > 0 ? (
              <ul className="space-y-1.5">
                {test.map((t, i) => (
                  <li key={i} className="text-sm text-[#cbd5e1] flex gap-2">
                    <span className="text-[#f59e0b] shrink-0">→</span>
                    {t}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#64748b]">—</p>
            )}
          </div>
        </div>
      </motion.section>

      {/* Cómo hacer más como este */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14 }}
        className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h3 className="text-base font-bold text-[#f1f5f9]">Cómo hacer más como este</h3>
            <p className="text-xs text-[#94a3b8] mt-0.5">
              {mode === 'ia'
                ? 'Prompts listos para pegar en tu generador de imagen o video.'
                : 'Briefs claros para dictarle la receta a tu diseñador o editor.'}
            </p>
          </div>
          <div className="inline-flex gap-1 bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-1 self-start">
            <button
              onClick={() => setMode('ia')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                mode === 'ia' ? 'bg-[#3b82f6] text-white shadow-lg shadow-blue-500/20' : 'text-[#94a3b8] hover:text-[#f1f5f9]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Modo IA
            </button>
            <button
              onClick={() => setMode('equipo')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                mode === 'equipo' ? 'bg-[#8b5cf6] text-white shadow-lg shadow-purple-500/20' : 'text-[#94a3b8] hover:text-[#f1f5f9]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Modo Equipo
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {variants.length === 0 && (
            <p className="text-sm text-[#64748b]">Este análisis no incluyó variantes.</p>
          )}
          {variants.map((v) => {
            const text = mode === 'ia' ? v.prompt : v.teamBrief;
            return (
              <div key={v.id} className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-md shrink-0 ${
                      mode === 'ia'
                        ? 'bg-[#3b82f6]/15 text-[#60a5fa]'
                        : 'bg-[#8b5cf6]/15 text-[#a78bfa]'
                    }`}>
                      {v.title}
                    </span>
                    {v.subtitle && (
                      <span className="text-xs text-[#94a3b8] truncate">{v.subtitle}</span>
                    )}
                  </div>
                  <CopyButton
                    text={text}
                    label={mode === 'ia' ? 'Copiar prompt' : 'Copiar brief'}
                  />
                </div>
                <p className="text-sm text-[#cbd5e1] leading-relaxed whitespace-pre-wrap">
                  {text || '—'}
                </p>
              </div>
            );
          })}
        </div>
      </motion.section>

      {/* ============ CAPA 3 — ANÁLISIS COMPLETO (colapsado) ============ */}
      {children && (
        <section>
          <button
            onClick={() => setShowFull((v) => !v)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-[#2e2e42] text-sm text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[#3b82f6]/50 transition-colors"
          >
            <Microscope className="w-4 h-4" />
            {showFull ? 'Ocultar análisis completo' : 'Ver análisis completo'}
            <ChevronDown className={`w-4 h-4 transition-transform ${showFull ? 'rotate-180' : ''}`} />
          </button>
          {showFull && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-5"
            >
              {children}
            </motion.div>
          )}
        </section>
      )}
    </div>
  );
}
