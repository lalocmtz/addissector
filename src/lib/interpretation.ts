// =============================================================================
// AdDNA — Normalización de la interpretación simple (Capa 1 + 2).
// Si el modelo no devolvió los campos de alto nivel, los deriva del análisis
// técnico existente para que la UI nunca quede vacía.
// =============================================================================

import type { SignalLevel } from '@/lib/analysis-schema';

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function scoreLabel(score: number): string {
  if (score >= 75) return 'Ganador';
  if (score >= 50) return 'Decente';
  return 'Flojo';
}

function levelFromScore10(score: number): SignalLevel {
  if (score >= 7) return 'alto';
  if (score >= 4) return 'medio';
  return 'bajo';
}

function normalizeLevel(v: unknown, fallback: SignalLevel): SignalLevel {
  const s = asStr(v).toLowerCase();
  if (s === 'alto' || s === 'medio' || s === 'bajo') return s;
  if (s === 'high') return 'alto';
  if (s === 'medium' || s === 'mid') return 'medio';
  if (s === 'low') return 'bajo';
  return fallback;
}

function normalizeSignal(raw: unknown, fallbackLevel: SignalLevel, fallbackNote: string): Rec {
  const r = asRec(raw);
  return {
    level: normalizeLevel(r.level, fallbackLevel),
    note: asStr(r.note) || fallbackNote,
  };
}

/**
 * Asegura verdict / overall_score / score_label / signals / winning_recipe /
 * keep / test en un análisis de VIDEO. Muta y devuelve el mismo objeto.
 */
export function ensureVideoInterpretation(analysis: Rec): Rec {
  const psych = asRec(analysis.psychological_analysis);
  const dashboard = asRec(analysis.dashboard);
  const hook = asRec(dashboard.hook);
  const scrollStop = asRec(psych.scroll_stop);
  const structural = asRec(analysis.structural_analysis);
  const winning = asRec(structural.winning_structure);

  const hookScore = typeof hook.effectiveness_score === 'number' ? hook.effectiveness_score : 5;
  const scrollScore =
    typeof scrollStop.strength_score === 'number' ? scrollStop.strength_score : hookScore;

  if (typeof analysis.overall_score !== 'number') {
    analysis.overall_score = clamp(Math.round(((hookScore + scrollScore) / 2) * 10), 0, 100);
  }
  analysis.overall_score = clamp(Math.round(analysis.overall_score as number), 0, 100);
  if (!asStr(analysis.score_label)) {
    analysis.score_label = scoreLabel(analysis.overall_score as number);
  }

  if (!asStr(analysis.verdict)) {
    analysis.verdict =
      asStr(psych.why_it_converts) ||
      asStr(winning.hook) ||
      'Este creativo combina un arranque que detiene el scroll con una razón clara para comprar.';
  }

  const signals = asRec(analysis.signals);
  analysis.signals = {
    scroll_stop: normalizeSignal(
      signals.scroll_stop,
      levelFromScore10(scrollScore),
      asStr(scrollStop.mechanism) || 'Arranque que captura la atención en los primeros segundos.'
    ),
    clarity: normalizeSignal(
      signals.clarity,
      levelFromScore10(hookScore),
      'El mensaje principal se entiende rápido.'
    ),
    offer: normalizeSignal(
      signals.offer,
      'medio',
      asStr(winning.cta) || 'La oferta y el llamado a la acción cierran la venta.'
    ),
  };

  if (asStrArray(analysis.winning_recipe).length === 0) {
    const recipe: string[] = [];
    if (asStr(winning.hook)) recipe.push(`Arranque: ${asStr(winning.hook)}`);
    if (asStr(winning.development)) recipe.push(`Desarrollo: ${asStr(winning.development)}`);
    if (asStr(winning.cta)) recipe.push(`Cierre: ${asStr(winning.cta)}`);
    if (asStr(psych.why_it_converts)) recipe.push(asStr(psych.why_it_converts));
    analysis.winning_recipe = recipe.slice(0, 5);
  }

  if (asStrArray(analysis.keep).length === 0) {
    analysis.keep = asStrArray(winning.persuasion_elements).slice(0, 4);
  }
  if (!Array.isArray(analysis.test)) analysis.test = [];

  // team_brief por variante de guion.
  if (Array.isArray(analysis.script_variants)) {
    for (const v of analysis.script_variants) {
      const variant = asRec(v);
      if (!asStr(variant.team_brief)) {
        const scenario = asStr(variant.scenario);
        const script = asStr(variant.script);
        variant.team_brief = [
          scenario ? `Escenario: ${scenario}.` : '',
          'Graba este guion tal cual, manteniendo el mismo orden de ideas:',
          script,
          asStr(winning.tone) ? `Tono: ${asStr(winning.tone)}.` : '',
        ]
          .filter(Boolean)
          .join('\n');
      }
    }
  }

  return analysis;
}

/**
 * Asegura los campos de interpretación simple en un análisis de IMAGEN.
 * Muta y devuelve el mismo objeto.
 */
export function ensureImageInterpretation(analysis: Rec): Rec {
  const psych = asRec(analysis.psychological_analysis);
  const scorecard = asRec(analysis.dashboard);
  const scrollStop = asRec(psych.scroll_stop);
  const replication = asRec(analysis.replication);

  const overall10 =
    typeof scorecard.overall_score === 'number' ? scorecard.overall_score : 5;
  const stopping10 =
    typeof scorecard.stopping_power_score === 'number' ? scorecard.stopping_power_score : overall10;
  const clarity10 =
    typeof scorecard.clarity_score === 'number' ? scorecard.clarity_score : overall10;
  const offer10 =
    typeof scorecard.offer_strength_score === 'number' ? scorecard.offer_strength_score : overall10;

  if (typeof analysis.overall_score !== 'number') {
    analysis.overall_score = clamp(Math.round(overall10 * 10), 0, 100);
  }
  analysis.overall_score = clamp(Math.round(analysis.overall_score as number), 0, 100);
  if (!asStr(analysis.score_label)) {
    analysis.score_label = scoreLabel(analysis.overall_score as number);
  }

  if (!asStr(analysis.verdict)) {
    analysis.verdict =
      asStr(psych.why_it_converts) ||
      'Este anuncio combina un visual que detiene el scroll con una oferta clara.';
  }

  const signals = asRec(analysis.signals);
  analysis.signals = {
    scroll_stop: normalizeSignal(
      signals.scroll_stop,
      levelFromScore10(stopping10),
      asStr(scrollStop.mechanism) || 'El visual captura la atención de un vistazo.'
    ),
    clarity: normalizeSignal(
      signals.clarity,
      levelFromScore10(clarity10),
      'El mensaje se entiende en el primer vistazo.'
    ),
    offer: normalizeSignal(
      signals.offer,
      levelFromScore10(offer10),
      'La oferta da una razón concreta para comprar.'
    ),
  };

  if (asStrArray(analysis.winning_recipe).length === 0) {
    const recipe: string[] = [];
    if (asStr(psych.why_it_converts)) recipe.push(asStr(psych.why_it_converts));
    if (asStr(scorecard.scorecard_reasoning)) recipe.push(asStr(scorecard.scorecard_reasoning));
    analysis.winning_recipe = recipe.slice(0, 5);
  }

  if (asStrArray(analysis.keep).length === 0) {
    const notes = asStr(replication.design_notes);
    analysis.keep = notes ? [notes] : [];
  }
  if (!Array.isArray(analysis.test)) analysis.test = [];

  // team_brief por variante de replicación.
  if (Array.isArray(replication.variants)) {
    for (const v of replication.variants) {
      const variant = asRec(v);
      if (!asStr(variant.team_brief)) {
        const angle = asStr(variant.angle);
        variant.team_brief = [
          angle ? `Ángulo de esta versión: ${angle}.` : '',
          'Recrea el anuncio siguiendo esta descripción (composición, texto y estilo):',
          asStr(variant.prompt),
        ]
          .filter(Boolean)
          .join('\n');
      }
    }
  }

  return analysis;
}
