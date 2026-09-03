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
  if (level === 'alto') return { dot: 'bg-ok', border: 'border-ok/30', text: 'text-ok' };
  if (level === 'medio') return { dot: 'bg-warn', border: 'border-warn/30', text: 'text-warn' };
  return { dot: 'bg-danger', border: 'border-danger/30', text: 'text-danger' };
}

function scoreColors(score: number): { ring: string; label: string } {
  if (score >= 75) return { ring: 'var(--color-ok)', label: 'text-ok' };
  if (score >= 50) return { ring: 'var(--color-warn)', label: 'text-warn' };
  return { ring: 'var(--color-danger)', label: 'text-danger' };
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
          <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth="7" />
          <circle
            cx="40" cy="40" r={r} fill="none" stroke={ring} strokeWidth="7"
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - clamped / 100)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-ink">{clamped}</span>
          <span className="text-[9px] text-ink-4 font-[family-name:var(--font-mono)]">/100</span>
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
        className="rounded-2xl border border-accent/25 bg-accent-soft p-6"
      >
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <ScoreRing score={overallScore} label={scoreLabel} />
          <div className="flex-1 text-center sm:text-left">
            <p className="text-[10px] uppercase tracking-wider text-accent font-[family-name:var(--font-mono)] mb-2">
              Por qué funciona
            </p>
            <h2 className="text-xl sm:text-2xl font-bold leading-snug text-ink">
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
                  className={`rounded-xl border ${colors.border} bg-surface/70 px-4 py-3`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    <span className="text-ink-3">{icon}</span>
                    <span className="text-xs font-semibold text-ink">{label}</span>
                    <span className={`ml-auto text-[10px] font-bold uppercase ${colors.text}`}>
                      {sig.level}
                    </span>
                  </div>
                  <p className="text-xs text-ink-3 leading-relaxed">{sig.note}</p>
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
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            La receta ganadora
          </h3>
          {winningRecipe.length > 0 ? (
            <ul className="space-y-2.5">
              {winningRecipe.map((r, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-ink-2 leading-relaxed">
                  <span className="text-accent font-bold font-[family-name:var(--font-mono)] shrink-0">
                    {i + 1}.
                  </span>
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-4">Sin receta disponible.</p>
          )}
        </div>

        {/* Qué mantener vs qué probar */}
        <div className="rounded-2xl border border-line bg-surface p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-2">
              <Lock className="w-4 h-4 text-ok" />
              Qué mantener <span className="text-[10px] text-ink-4 font-normal">(no negociable)</span>
            </h3>
            {keep.length > 0 ? (
              <ul className="space-y-1.5">
                {keep.map((k, i) => (
                  <li key={i} className="text-sm text-ink-2 flex gap-2">
                    <span className="text-ok shrink-0">✓</span>
                    {k}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-4">—</p>
            )}
          </div>
          <div className="pt-3 border-t border-line">
            <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-warn" />
              Qué probar <span className="text-[10px] text-ink-4 font-normal">(hipótesis de mejora)</span>
            </h3>
            {test.length > 0 ? (
              <ul className="space-y-1.5">
                {test.map((t, i) => (
                  <li key={i} className="text-sm text-ink-2 flex gap-2">
                    <span className="text-warn shrink-0">→</span>
                    {t}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-4">—</p>
            )}
          </div>
        </div>
      </motion.section>

      {/* Cómo hacer más como este */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14 }}
        className="rounded-2xl border border-line bg-surface p-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h3 className="text-base font-bold text-ink">Cómo hacer más como este</h3>
            <p className="text-xs text-ink-3 mt-0.5">
              {mode === 'ia'
                ? 'Prompts listos para pegar en tu generador de imagen o video.'
                : 'Briefs claros para dictarle la receta a tu diseñador o editor.'}
            </p>
          </div>
          <div className="inline-flex gap-1 bg-canvas border border-line rounded-xl p-1 self-start">
            <button
              onClick={() => setMode('ia')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                mode === 'ia' ? 'bg-accent text-on-accent shadow-lg ' : 'text-ink-3 hover:text-ink'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Modo IA
            </button>
            <button
              onClick={() => setMode('equipo')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                mode === 'equipo' ? 'bg-accent text-on-accent shadow-lg ' : 'text-ink-3 hover:text-ink'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Modo Equipo
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {variants.length === 0 && (
            <p className="text-sm text-ink-4">Este análisis no incluyó variantes.</p>
          )}
          {variants.map((v) => {
            const text = mode === 'ia' ? v.prompt : v.teamBrief;
            return (
              <div key={v.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-md shrink-0 ${
                      mode === 'ia'
                        ? 'bg-accent/15 text-accent'
                        : 'bg-accent/15 text-accent'
                    }`}>
                      {v.title}
                    </span>
                    {v.subtitle && (
                      <span className="text-xs text-ink-3 truncate">{v.subtitle}</span>
                    )}
                  </div>
                  <CopyButton
                    text={text}
                    label={mode === 'ia' ? 'Copiar prompt' : 'Copiar brief'}
                  />
                </div>
                <p className="text-sm text-ink-2 leading-relaxed whitespace-pre-wrap">
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
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-line-strong text-sm text-ink-3 hover:text-ink hover:border-accent/50 transition-colors"
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
