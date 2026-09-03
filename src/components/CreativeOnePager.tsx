'use client';

// =============================================================================
// AdDNA — CreativeOnePager
// UN SOLO entregable de una página, denso pero legible, orientado a decisión.
//
// Orden de lectura (de arriba a abajo, sin pestañas ni bloques apilados):
//   1. El veredicto            — lo primero que se lee es la conclusión
//   2. Qué hacer               — 3-5 acciones concretas, ARRIBA
//   3. Línea de tiempo         — hook → cuerpo → cierre, en tabla compacta
//   4. Por qué funciona        — la lectura psicológica como prosa, integrada
//   5. Dónde se pierde         — riesgos de retención + números reales
//   6. El guion                — colapsado
//   7. Prompts y briefs        — colapsado
//
// Reemplaza el apilado SimpleResults + AnalysisResults (dashboard, psicología,
// estructura, guiones, Seedance, plan).
// =============================================================================

import { useMemo, useState } from 'react';
import {
  AlertTriangle, Brain, ChevronDown, Clock, FileText, Heart, Loader2, Lock,
  Quote, Sparkles, Target, TrendingDown, Users, Wand2, Zap,
} from 'lucide-react';
import CopyButton from './CopyButton';
import type { AnalysisResult, SimpleSignals } from '@/lib/analysis-schema';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface ReplicaVariant {
  id: string | number;
  title: string;
  subtitle?: string;
  /** Prompt listo para pegar en un generador de IA. */
  prompt: string;
  /** Brief sin jerga para el diseñador o editor. */
  teamBrief: string;
}

export interface RetentionStats {
  hookRate: number | null;
  ret50: number | null;
  ret75: number | null;
}

interface CreativeOnePagerProps {
  analysis: AnalysisResult;
  /** Nombre del creativo (archivo o anuncio de Meta). */
  name: string;
  /** Retención real de Meta, si el creativo está vinculado. */
  retention?: RetentionStats | null;
  variants?: ReplicaVariant[];
  onGenerateVariants?: () => void;
  isGeneratingVariants?: boolean;
  /** Texto completo para el botón "Copiar todo". */
  copyAllText?: string;
  /** Manda este análisis al Cerebro (extrae persona, ángulo, hooks y aprendizajes). */
  onFeedBrain?: () => void;
  feedingBrain?: boolean;
  /** Resultado corto de la última ingesta: "2 hooks, 1 ángulo nuevo". */
  brainChip?: string | null;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** "0-3", "0:03", "3s", "00:03-00:06" → segundos numéricos. */
function parseSeconds(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (!raw) return null;
  const clock = raw.match(/(\d+)\s*:\s*(\d+)/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const plain = raw.match(/\d+(?:[.,]\d+)?/);
  if (!plain) return null;
  const n = Number(plain[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function nearest<T>(items: T[], getSec: (t: T) => number | null, target: number): T | undefined {
  let best: T | undefined;
  let bestDist = Infinity;
  for (const item of items) {
    const s = getSec(item);
    if (s === null) continue;
    const d = Math.abs(s - target);
    if (d < bestDist) {
      bestDist = d;
      best = item;
    }
  }
  return bestDist <= 4 ? best : undefined;
}

function scoreTone(score0to100: number): { hex: string; text: string } {
  if (score0to100 >= 75) return { hex: 'var(--color-ok)', text: 'text-ok' };
  if (score0to100 >= 50) return { hex: 'var(--color-warn)', text: 'text-warn' };
  return { hex: 'var(--color-danger)', text: 'text-danger' };
}

function levelTone(level: string): { dot: string; text: string } {
  if (level === 'alto') return { dot: 'bg-ok', text: 'text-ok' };
  if (level === 'medio') return { dot: 'bg-warn', text: 'text-warn' };
  return { dot: 'bg-danger', text: 'text-danger' };
}

// ---------------------------------------------------------------------------
// Piezas de UI
// ---------------------------------------------------------------------------

function SectionHeading({
  step, icon, title, hint,
}: { step: string; icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-accent shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-ink-4 font-[family-name:var(--font-mono)]">
            {step}
          </span>
          <h2 className="text-lg font-bold text-ink leading-tight">{title}</h2>
        </div>
        {hint && <p className="text-xs text-ink-4 mt-0.5 leading-relaxed">{hint}</p>}
      </div>
    </div>
  );
}

function SubHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-ink mb-1.5">
      <span className="text-accent">{icon}</span>
      {children}
    </h3>
  );
}

function Chip({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-canvas border border-line px-2.5 py-1.5 min-w-0">
      <p className="text-[9px] uppercase tracking-wide text-ink-4 truncate">{label}</p>
      <p className={`text-xs font-bold font-[family-name:var(--font-mono)] truncate ${tone}`}>{value}</p>
    </div>
  );
}

function Tags({ items, tone }: { items: string[]; tone: string }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t, i) => (
        <span key={i} className={`text-[11px] px-2 py-0.5 rounded-md bg-canvas border border-line ${tone}`}>
          {t}
        </span>
      ))}
    </div>
  );
}

function Collapsible({
  icon, title, hint, children,
}: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-line bg-surface overflow-hidden">
      <summary className="cursor-pointer list-none px-5 py-4 flex items-center gap-3 hover:bg-surface transition-colors [&::-webkit-details-marker]:hidden">
        <span className="text-ink-4 group-open:text-accent transition-colors">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          <span className="block text-xs text-ink-4">{hint}</span>
        </span>
        <ChevronDown className="w-4 h-4 text-ink-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-5 pb-5 pt-1 border-t border-line">{children}</div>
    </details>
  );
}

const SIGNAL_LABELS: Array<{ key: keyof SimpleSignals; label: string }> = [
  { key: 'scroll_stop', label: 'Detiene el scroll' },
  { key: 'clarity', label: 'Se entiende al instante' },
  { key: 'offer', label: 'Oferta convincente' },
];

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export default function CreativeOnePager({
  analysis,
  name,
  retention = null,
  variants = [],
  onGenerateVariants,
  isGeneratingVariants = false,
  copyAllText,
  onFeedBrain,
  feedingBrain = false,
  brainChip = null,
}: CreativeOnePagerProps) {
  const [mode, setMode] = useState<'ia' | 'equipo'>('ia');

  const structural = analysis.structural_analysis;
  const psych = analysis.psychological_analysis;
  const patterns = analysis.dashboard?.patterns;
  const hook = analysis.dashboard?.hook;
  const winning = structural?.winning_structure;
  const math = psych?.math_breakdown;
  const buyer = psych?.buyer_psychology;
  const scrollStop = psych?.scroll_stop;
  const avatar = psych?.target_avatar;
  const plan = analysis.replication_plan;

  const score = Math.max(0, Math.min(100, Math.round(analysis.overall_score ?? 0)));
  const tone = scoreTone(score);

  // --- Qué hacer: 3-5 acciones, primero lo que se prueba, luego lo intocable ---
  const actions = useMemo(() => {
    const test = (analysis.test ?? []).filter(Boolean);
    const keep = (analysis.keep ?? []).filter(Boolean);
    const out: Array<{ text: string; kind: 'probar' | 'mantener' }> = [];
    for (const t of test.slice(0, 3)) out.push({ text: t, kind: 'probar' });
    for (const k of keep.slice(0, Math.max(0, 5 - out.length))) out.push({ text: k, kind: 'mantener' });
    if (out.length < 3) {
      for (const r of (analysis.winning_recipe ?? []).slice(0, 3 - out.length)) {
        out.push({ text: r, kind: 'mantener' });
      }
    }
    return out.slice(0, 5);
  }, [analysis]);

  // --- Línea de tiempo: qué se dice × qué se ve × qué provoca -----------------
  const timeline = useMemo(() => {
    const said = structural?.transcription ?? [];
    const frames = analysis.dashboard?.visual_frames ?? [];
    const beats = psych?.emotional_journey ?? [];

    const base = said.length
      ? said.map((t) => ({ label: t.second, sec: parseSeconds(t.second), said: t.text }))
      : frames.map((f) => ({ label: f.timestamp, sec: parseSeconds(f.timestamp), said: '' }));

    return base.map((row) => {
      const frame = row.sec === null ? undefined : nearest(frames, (f) => parseSeconds(f.timestamp), row.sec);
      const beat = row.sec === null ? undefined : nearest(beats, (b) => parseSeconds(b.second), row.sec);
      return {
        label: row.label,
        said: row.said,
        seen: frame?.description ?? '',
        overlay: frame?.text_on_screen ?? null,
        emotion: beat?.emotion ?? '',
        purpose: beat?.purpose ?? '',
      };
    });
  }, [structural, psych, analysis.dashboard]);

  const riskPoints = math?.retention_risk_points ?? [];
  const triggers = psych?.persuasion_triggers ?? [];
  const biases = psych?.cognitive_biases ?? [];

  const ficha = [
    structural?.video_type,
    structural?.product,
    structural?.total_duration_seconds ? `${Math.round(structural.total_duration_seconds)}s` : null,
    winning?.format,
    winning?.tone,
  ].filter(Boolean) as string[];

  return (
    <article className="space-y-8">
      {/* ==================== 1. EL VEREDICTO ==================== */}
      <section className="rounded-2xl border border-accent/25 bg-accent-soft p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <p className="text-[10px] uppercase tracking-wider text-accent font-[family-name:var(--font-mono)] truncate max-w-full">
            Veredicto · {name}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {brainChip && (
              <span className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg border border-ok/30 bg-ok/5 text-ok">
                <Brain className="w-3 h-3" /> {brainChip}
              </span>
            )}
            {onFeedBrain && (
              <button
                onClick={onFeedBrain}
                disabled={feedingBrain}
                title="Extrae la persona, el ángulo, los hooks y los aprendizajes de este análisis y los guarda en el Cerebro"
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-line text-ink-3 hover:text-ink hover:border-accent/50 transition-colors disabled:opacity-50"
              >
                {feedingBrain ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Brain className="w-3.5 h-3.5" />
                )}
                {feedingBrain ? 'Leyendo…' : 'Alimentar el cerebro'}
              </button>
            )}
            {copyAllText && <CopyButton text={copyAllText} label="Copiar todo" />}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          {/* Score */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="relative w-[86px] h-[86px]">
              <svg viewBox="0 0 80 80" className="w-[86px] h-[86px] -rotate-90">
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-surface-2)" strokeWidth="7" />
                <circle
                  cx="40" cy="40" r="34" fill="none" stroke={tone.hex} strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 34}
                  strokeDashoffset={2 * Math.PI * 34 * (1 - score / 100)}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-ink">{score}</span>
                <span className={`text-[9px] font-bold uppercase tracking-wide ${tone.text}`}>
                  {analysis.score_label || '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Frase de conclusión */}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold leading-snug text-ink">
              {analysis.verdict || 'Sin veredicto disponible.'}
            </h1>
            {ficha.length > 0 && (
              <p className="text-xs text-ink-3 mt-2 font-[family-name:var(--font-mono)]">
                {ficha.join(' · ')}
              </p>
            )}
          </div>
        </div>

        {/* Semáforos + retención real, en una sola fila */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-5">
          {SIGNAL_LABELS.map(({ key, label }) => {
            const sig = analysis.signals?.[key];
            if (!sig) return null;
            const t = levelTone(sig.level);
            return (
              <div key={key} className="rounded-xl border border-line bg-canvas/70 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                  <span className="text-xs font-semibold text-ink">{label}</span>
                  <span className={`ml-auto text-[10px] font-bold uppercase ${t.text}`}>{sig.level}</span>
                </div>
                <p className="text-[11px] text-ink-3 leading-relaxed">{sig.note}</p>
              </div>
            );
          })}
        </div>

        {retention && (retention.hookRate !== null || retention.ret50 !== null || retention.ret75 !== null) && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            <Chip label="Hook rate real" value={retention.hookRate !== null ? `${retention.hookRate.toFixed(1)}%` : '—'} />
            <Chip label="Llegan al 50%" value={retention.ret50 !== null ? `${retention.ret50.toFixed(0)}%` : '—'} />
            <Chip label="Llegan al 75%" value={retention.ret75 !== null ? `${retention.ret75.toFixed(0)}%` : '—'} />
          </div>
        )}
      </section>

      {/* ==================== 2. QUÉ HACER ==================== */}
      <section>
        <SectionHeading
          step="01"
          icon={<Target className="w-4 h-4" />}
          title="Qué hacer"
          hint="Las decisiones que salen de este análisis, en orden de prioridad."
        />
        {actions.length > 0 ? (
          <ol className="space-y-2">
            {actions.map((a, i) => (
              <li
                key={i}
                className="flex gap-3 rounded-xl border border-line bg-surface px-4 py-3"
              >
                <span className="text-sm font-bold text-accent font-[family-name:var(--font-mono)] shrink-0">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <span
                    className={`inline-block text-[9px] font-bold uppercase tracking-wide mb-1 ${
                      a.kind === 'probar' ? 'text-warn' : 'text-ok'
                    }`}
                  >
                    {a.kind === 'probar' ? 'Prueba esto' : 'No lo toques'}
                  </span>
                  <p className="text-sm text-ink-2 leading-relaxed">{a.text}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-4">Este análisis no arrojó acciones concretas.</p>
        )}
      </section>

      {/* ==================== 3. LÍNEA DE TIEMPO ==================== */}
      <section>
        <SectionHeading
          step="02"
          icon={<Clock className="w-4 h-4" />}
          title="Cómo está armado el anuncio"
          hint="Segundo a segundo: qué se dice, qué se ve y qué te hace sentir."
        />

        {winning && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            {([
              ['Hook', winning.hook, 'var(--color-accent)'],
              ['Cuerpo', winning.development, 'var(--color-accent)'],
              ['Cierre / CTA', winning.cta, 'var(--color-ok)'],
            ] as const).map(([label, text, color]) => (
              <div key={label} className="rounded-xl border border-line bg-surface p-3">
                <p className="text-[10px] uppercase tracking-wide font-bold mb-1" style={{ color }}>
                  {label}
                </p>
                <p className="text-xs text-ink-2 leading-relaxed">{text || '—'}</p>
              </div>
            ))}
          </div>
        )}

        {timeline.length > 0 && (
          <div className="rounded-xl border border-line bg-surface overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-ink-4">
                  <th className="px-3 py-2 font-medium w-16">Seg.</th>
                  <th className="px-3 py-2 font-medium">Qué se dice</th>
                  <th className="px-3 py-2 font-medium">Qué se ve</th>
                  <th className="px-3 py-2 font-medium w-48">Qué provoca</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((row, i) => (
                  <tr key={i} className="border-t border-surface-2 align-top">
                    <td className="px-3 py-2.5 text-[11px] font-bold text-accent font-[family-name:var(--font-mono)] whitespace-nowrap">
                      {row.label}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink leading-relaxed">
                      {row.said || '—'}
                      {row.overlay && (
                        <span className="block mt-1 text-[10px] text-warn">
                          En pantalla: {row.overlay}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink-3 leading-relaxed">{row.seen || '—'}</td>
                    <td className="px-3 py-2.5 text-xs leading-relaxed">
                      {row.emotion ? (
                        <>
                          <span className="text-accent font-medium">{row.emotion}</span>
                          {row.purpose && <span className="block text-ink-4 mt-0.5">{row.purpose}</span>}
                        </>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ==================== 4. POR QUÉ FUNCIONA ==================== */}
      <section>
        <SectionHeading
          step="03"
          icon={<Brain className="w-4 h-4" />}
          title="Por qué funciona"
          hint="La lectura psicológica: qué te frena, a quién le habla y qué resortes jala."
        />

        <div className="rounded-2xl border border-line bg-surface p-5 space-y-6">
          {psych?.why_it_converts && (
            <p className="text-[15px] text-ink leading-relaxed">{psych.why_it_converts}</p>
          )}

          {(analysis.winning_recipe ?? []).length > 0 && (
            <div>
              <SubHeading icon={<Sparkles className="w-4 h-4" />}>La receta, en corto</SubHeading>
              <ul className="space-y-1.5">
                {(analysis.winning_recipe ?? []).map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink-2 leading-relaxed">
                    <span className="text-accent font-bold font-[family-name:var(--font-mono)] shrink-0">
                      {i + 1}.
                    </span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {scrollStop && (
            <div className="pt-5 border-t border-line">
              <SubHeading icon={<Zap className="w-4 h-4" />}>Qué frena el dedo</SubHeading>
              <p className="text-sm text-ink-2 leading-relaxed">
                {scrollStop.mechanism || '—'}
                {scrollStop.primary_trigger && (
                  <> El gatillo principal es <b className="text-accent">{scrollStop.primary_trigger}</b>.</>
                )}
              </p>
              {scrollStop.reasoning && (
                <p className="text-sm text-ink-3 leading-relaxed mt-1.5">{scrollStop.reasoning}</p>
              )}
              {hook?.effectiveness_reasoning && hook.effectiveness_reasoning !== scrollStop.reasoning && (
                <p className="text-sm text-ink-3 leading-relaxed mt-1.5">{hook.effectiveness_reasoning}</p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <Chip label="Fuerza del freno" value={`${scrollStop.strength_score ?? 0}/10`} />
                {hook && <Chip label="Tipo de hook" value={hook.type || '—'} />}
                {hook && <Chip label="Dura" value={`${hook.duration_seconds ?? 0}s`} />}
                {hook && <Chip label="Audio" value={hook.music_type || hook.audio_tone || '—'} />}
              </div>
            </div>
          )}

          {(avatar || psych?.awareness_level || psych?.market_sophistication) && (
            <div className="pt-5 border-t border-line">
              <SubHeading icon={<Users className="w-4 h-4" />}>A quién le habla</SubHeading>
              {avatar && (
                <p className="text-sm text-ink-2 leading-relaxed">
                  <b className="text-ink">{avatar.who}</b>
                  {avatar.mindset && <> — {avatar.mindset}</>}
                </p>
              )}
              {avatar?.resonance_reason && (
                <p className="text-sm text-ink-3 leading-relaxed mt-1.5">{avatar.resonance_reason}</p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                <Chip label="Qué tanto te conoce" value={psych?.awareness_level || '—'} />
                <Chip label="Qué tan quemado está el mercado" value={psych?.market_sophistication || '—'} />
              </div>
            </div>
          )}

          {buyer && (
            <div className="pt-5 border-t border-line">
              <SubHeading icon={<Heart className="w-4 h-4" />}>Qué desea y qué le duele</SubHeading>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {([
                  ['Lo que quiere', buyer.core_desire, 'text-ok'],
                  ['Lo que le duele', buyer.core_pain, 'text-danger'],
                  ['En quién se convierte', buyer.identity_shift, 'text-accent'],
                ] as const).map(([label, text, color]) => (
                  <div key={label} className="rounded-xl bg-surface border border-line p-3">
                    <p className={`text-[10px] uppercase tracking-wide font-bold mb-1 ${color}`}>{label}</p>
                    <p className="text-xs text-ink leading-relaxed">{text || '—'}</p>
                  </div>
                ))}
              </div>
              {(buyer.objections_handled ?? []).length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1.5">
                    Objeciones que el anuncio ya desarma
                  </p>
                  <Tags items={buyer.objections_handled} tone="text-ink-2" />
                </div>
              )}
            </div>
          )}

          {(triggers.length > 0 || biases.length > 0) && (
            <div className="pt-5 border-t border-line">
              <SubHeading icon={<Target className="w-4 h-4" />}>Los resortes que jala</SubHeading>
              {triggers.length > 0 && (
                <ul className="space-y-2">
                  {triggers.map((t, i) => (
                    <li key={i} className="text-sm leading-relaxed">
                      <span className="text-ink font-semibold">{t.trigger}</span>
                      {t.timestamp && (
                        <span className="text-[10px] text-accent font-[family-name:var(--font-mono)] ml-2">
                          {t.timestamp}
                        </span>
                      )}
                      {typeof t.strength === 'number' && (
                        <span className="text-[10px] text-ink-4 ml-2">fuerza {t.strength}/10</span>
                      )}
                      <span className="block text-ink-3">{t.how_used}</span>
                    </li>
                  ))}
                </ul>
              )}
              {biases.length > 0 && (
                <div className="mt-3 pt-3 border-t border-surface-2">
                  <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1.5">
                    Atajos mentales que aprovecha
                  </p>
                  <ul className="space-y-1.5">
                    {biases.map((b, i) => (
                      <li key={i} className="text-xs text-ink-3 leading-relaxed">
                        <b className="text-ink-2">{b.bias}:</b> {b.how_exploited}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {patterns && (
            <div className="pt-5 border-t border-line">
              <SubHeading icon={<Sparkles className="w-4 h-4" />}>Recursos del formato</SubHeading>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                <Chip label="Estructura de persuasión" value={patterns.persuasion_framework || '—'} />
                <Chip label="Ritmo" value={patterns.pacing_rhythm || '—'} />
                <Chip label="Arco emocional" value={patterns.emotional_arc || '—'} />
                <Chip label="Música" value={patterns.music_strategy || '—'} />
              </div>
              <div className="space-y-2">
                {(patterns.retention_techniques ?? []).length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1.5">Qué usa para retener</p>
                    <Tags items={patterns.retention_techniques} tone="text-ink-2" />
                  </div>
                )}
                {(patterns.power_words ?? []).length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1.5">Palabras que pegan</p>
                    <Tags items={patterns.power_words} tone="text-warn" />
                  </div>
                )}
                {(patterns.ugc_markers ?? []).length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1.5">Señales de que se siente real</p>
                    <Tags items={patterns.ugc_markers} tone="text-ok" />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ==================== 5. DÓNDE SE PIERDE LA ATENCIÓN ==================== */}
      {(math || riskPoints.length > 0 || retention) && (
        <section>
          <SectionHeading
            step="04"
            icon={<TrendingDown className="w-4 h-4" />}
            title="Dónde se pierde la atención"
            hint="Los momentos donde la gente se va — y qué revisar antes de escalarlo."
          />
          <div className="rounded-2xl border border-line bg-surface p-5 space-y-4">
            {math && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Chip label="El hook dura" value={`${math.hook_duration_seconds ?? 0}s`} />
                <Chip label="Ventana ideal" value={math.ideal_hook_window || '—'} />
                <Chip label="Ritmo" value={`${math.pacing_score ?? 0}/10`} />
                <Chip label="El CTA entra" value={math.cta_timing || '—'} />
              </div>
            )}
            {math?.thumbstop_estimate && (
              <p className="text-sm text-ink-3 leading-relaxed">
                Freno estimado en el feed: <b className="text-ink">{math.thumbstop_estimate}</b>
              </p>
            )}
            {riskPoints.length > 0 ? (
              <ul className="space-y-2">
                {riskPoints.map((r, i) => (
                  <li key={i} className="flex gap-3 rounded-xl bg-surface border border-warn/20 px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="text-[11px] font-bold text-warn font-[family-name:var(--font-mono)]">
                        {r.timestamp}
                      </span>
                      <p className="text-sm text-ink-2 leading-relaxed">{r.risk}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-4">No se detectaron caídas claras de atención.</p>
            )}
          </div>
        </section>
      )}

      {/* ==================== 6. EL GUION (colapsado) ==================== */}
      <Collapsible
        icon={<FileText className="w-4 h-4" />}
        title="El guion completo"
        hint="El texto tal cual se dice, para copiarlo o pasárselo a quien graba."
      >
        {analysis.original_script ? (
          <>
            <div className="flex justify-end mb-2">
              <CopyButton text={analysis.original_script} label="Copiar guion" />
            </div>
            <div className="rounded-xl bg-canvas border border-line p-4">
              <Quote className="w-4 h-4 text-line-strong mb-2" />
              <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
                {analysis.original_script}
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-4">Este análisis no incluyó el guion.</p>
        )}

        {plan && (plan.voice_tone || plan.editing_notes) && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {plan.voice_tone && (
              <div className="rounded-xl bg-canvas border border-line p-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1">Cómo suena la voz</p>
                <p className="text-xs text-ink-2 leading-relaxed">{plan.voice_tone}</p>
              </div>
            )}
            {plan.editing_notes && (
              <div className="rounded-xl bg-canvas border border-line p-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-4 mb-1">Notas de edición</p>
                <p className="text-xs text-ink-2 leading-relaxed">{plan.editing_notes}</p>
              </div>
            )}
          </div>
        )}
      </Collapsible>

      {/* ==================== 7. PROMPTS Y BRIEFS (colapsado) ==================== */}
      <Collapsible
        icon={<Wand2 className="w-4 h-4" />}
        title="Cómo hacer más como este"
        hint={`${variants.length} variante${variants.length === 1 ? '' : 's'} — prompt para IA o brief para tu equipo.`}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="inline-flex gap-1 bg-canvas border border-line rounded-xl p-1">
            <button
              onClick={() => setMode('ia')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === 'ia' ? 'bg-accent text-on-accent' : 'text-ink-3 hover:text-ink'
              }`}
            >
              Para IA
            </button>
            <button
              onClick={() => setMode('equipo')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === 'equipo' ? 'bg-accent text-on-accent' : 'text-ink-3 hover:text-ink'
              }`}
            >
              Para mi equipo
            </button>
          </div>
          {onGenerateVariants && (
            <button
              onClick={onGenerateVariants}
              disabled={isGeneratingVariants}
              className="text-xs px-4 py-2 rounded-lg border border-line text-ink-3 hover:text-ink hover:border-accent/40 transition-colors disabled:opacity-50"
            >
              {isGeneratingVariants ? 'Generando…' : 'Generar más variantes'}
            </button>
          )}
        </div>

        {(analysis.keep ?? []).length > 0 && (
          <div className="rounded-xl bg-canvas border border-ok/20 p-3 mb-4">
            <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-ok mb-1.5">
              <Lock className="w-3 h-3" />
              Esto no debe cambiar en ninguna variante
            </p>
            <Tags items={analysis.keep ?? []} tone="text-ink-2" />
          </div>
        )}

        <div className="space-y-3">
          {variants.length === 0 && (
            <p className="text-sm text-ink-4">Este análisis no incluyó variantes.</p>
          )}
          {variants.map((v) => {
            const text = mode === 'ia' ? v.prompt : v.teamBrief;
            return (
              <div key={v.id} className="rounded-xl border border-line bg-canvas p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-md shrink-0 ${
                        mode === 'ia' ? 'bg-accent/15 text-accent' : 'bg-accent/15 text-accent'
                      }`}
                    >
                      {v.title}
                    </span>
                    {v.subtitle && <span className="text-xs text-ink-3 truncate">{v.subtitle}</span>}
                  </div>
                  <CopyButton text={text} label={mode === 'ia' ? 'Copiar prompt' : 'Copiar brief'} />
                </div>
                <p className="text-sm text-ink-2 leading-relaxed whitespace-pre-wrap">{text || '—'}</p>
              </div>
            );
          })}
        </div>
      </Collapsible>

    </article>
  );
}
