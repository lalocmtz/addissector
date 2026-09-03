// =============================================================================
// AdDNA — Extractor determinista para alimentar el Cerebro.
//
// Cada anuncio subido se trata hoy como GANADOR (sin criterio de rendimiento — se corrige en la Fase B): su análisis es la materia
// prima más valiosa que tiene la plataforma. El schema de análisis
// (analysis-schema.ts) ya viene estructurado, así que sacar los candidatos NO
// necesita un LLM: es un mapeo directo.
//
//   psychological.target_avatar                      -> persona
//   psychological.buyer_psychology + awareness       -> ángulo
//   structural.winning_structure.hook + dashboard.hook -> hooks
//   dashboard.patterns + persuasion_triggers + biases -> aprendizajes
//
// El LLM sólo entra después, para reconciliar contra lo que ya existe (¿este
// ángulo es el mismo que ya tengo?) y redactar en español de México.
//
// REGLA DURA: todo candidato lleva `evidence` con el nombre del anuncio y, si
// los hay, sus números reales. Un candidato sin evidencia NO se emite.
// =============================================================================

import type { AnalysisResult } from './analysis-schema';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface IngestMetrics {
  spend?: number | null;
  roas?: number | null;
  hookRate?: number | null;
}

export interface PersonaCandidate {
  name: string;
  description?: string;
  pains?: string;
  desires?: string;
  objections?: string;
  awareness_stage?: string;
  evidence: string;
}

export interface AngleCandidate {
  name: string;
  pain?: string;
  desire?: string;
  mechanism?: string;
  objection?: string;
  identity_shift?: string;
  awareness_stage?: string;
  market_sophistication?: string;
  evidence: string;
}

export interface HookCandidate {
  title: string;
  body?: string;
  evidence: string;
}

export interface LearningCandidate {
  text: string;
  evidence: string;
}

export interface IngestCandidates {
  persona: PersonaCandidate | null;
  angle: AngleCandidate | null;
  hooks: HookCandidate[];
  learnings: LearningCandidate[];
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Recorta sin cortar a media palabra. */
function trim(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trim()}…`;
}

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(clean).filter(Boolean) : [];

/**
 * La línea de evidencia: nombre del anuncio + sus números reales.
 * "SK Crema Aclarante AD #28_C — gasto $339, ROAS 1.83, hook 16.5%"
 * Sin nombre de anuncio no hay evidencia, y sin evidencia no hay candidato.
 */
export function buildEvidence(adName: string, metrics?: IngestMetrics): string {
  const name = clean(adName);
  if (!name) return '';
  const nums: string[] = [];
  if (metrics?.spend != null && Number.isFinite(metrics.spend) && metrics.spend > 0) {
    nums.push(`gasto $${Math.round(metrics.spend).toLocaleString('es-MX')}`);
  }
  if (metrics?.roas != null && Number.isFinite(metrics.roas)) {
    nums.push(`ROAS ${metrics.roas.toFixed(2)}`);
  }
  if (metrics?.hookRate != null && Number.isFinite(metrics.hookRate)) {
    nums.push(`hook ${metrics.hookRate.toFixed(1)}%`);
  }
  return nums.length ? `${name} — ${nums.join(', ')}` : name;
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

/**
 * Saca del análisis los candidatos a entrar al Cerebro. Puro y determinista:
 * si un campo no existe en el análisis, se omite — nunca se inventa nada.
 */
export function extractCandidates(
  analysis: AnalysisResult,
  adName: string,
  metrics?: IngestMetrics
): IngestCandidates {
  const empty: IngestCandidates = { persona: null, angle: null, hooks: [], learnings: [] };

  const evidence = buildEvidence(adName, metrics);
  if (!evidence) return empty; // sin evidencia no se emite nada
  if (!analysis || typeof analysis !== 'object') return empty;

  const psych = analysis.psychological_analysis;
  const avatar = psych?.target_avatar;
  const buyer = psych?.buyer_psychology;
  const dashHook = analysis.dashboard?.hook;
  const patterns = analysis.dashboard?.patterns;
  const winning = analysis.structural_analysis?.winning_structure;

  // --- Persona: quién es y por qué le resonó -------------------------------
  let persona: PersonaCandidate | null = null;
  const who = clean(avatar?.who);
  if (who) {
    const mindset = clean(avatar?.mindset);
    const reason = clean(avatar?.resonance_reason);
    const description = [mindset, reason && `Le resonó porque: ${reason}`]
      .filter(Boolean)
      .join(' ');
    const objections = list(buyer?.objections_handled).join(' · ');
    persona = {
      name: trim(who, 120),
      ...(description ? { description } : {}),
      ...(clean(buyer?.core_pain) ? { pains: clean(buyer?.core_pain) } : {}),
      ...(clean(buyer?.core_desire) ? { desires: clean(buyer?.core_desire) } : {}),
      ...(objections ? { objections } : {}),
      ...(clean(psych?.awareness_level) ? { awareness_stage: clean(psych?.awareness_level) } : {}),
      evidence,
    };
  }

  // --- Ángulo: dolor + mecanismo + objeción --------------------------------
  let angle: AngleCandidate | null = null;
  const pain = clean(buyer?.core_pain);
  const desire = clean(buyer?.core_desire);
  if (pain || desire) {
    const objections = list(buyer?.objections_handled);
    const mechanism = clean(psych?.why_it_converts);
    angle = {
      name: trim(pain || desire, 70),
      ...(pain ? { pain } : {}),
      ...(desire ? { desire } : {}),
      ...(mechanism ? { mechanism } : {}),
      ...(objections.length ? { objection: objections.join(' · ') } : {}),
      ...(clean(buyer?.identity_shift) ? { identity_shift: clean(buyer?.identity_shift) } : {}),
      ...(clean(psych?.awareness_level) ? { awareness_stage: clean(psych?.awareness_level) } : {}),
      ...(clean(psych?.market_sophistication)
        ? { market_sophistication: clean(psych?.market_sophistication) }
        : {}),
      evidence,
    };
  }

  // --- Hooks: el literal + lo que lo hizo detener el scroll ----------------
  const hooks: HookCandidate[] = [];
  const literal = clean(winning?.hook);
  const mech = clean(dashHook?.scroll_stop_mechanism);
  const hookType = clean(dashHook?.type);
  const score = typeof dashHook?.effectiveness_score === 'number' ? dashHook.effectiveness_score : null;
  const overlay = clean(dashHook?.text_overlay);

  const hookBody = [
    mech,
    hookType && `Tipo: ${hookType}.`,
    score != null && `Efectividad ${score}/10.`,
  ]
    .filter(Boolean)
    .join(' ');

  if (literal) {
    hooks.push({ title: trim(literal, 300), ...(hookBody ? { body: hookBody } : {}), evidence });
  }
  // El texto en pantalla es otro hook: se lee antes de escuchar nada.
  if (overlay && (!literal || !literal.toLowerCase().includes(overlay.toLowerCase()))) {
    hooks.push({
      title: trim(overlay, 300),
      body: ['Texto en pantalla del hook.', hookBody].filter(Boolean).join(' '),
      evidence,
    });
  }

  // --- Aprendizajes: framework + disparadores fuertes + sesgos -------------
  const learnings: LearningCandidate[] = [];
  const target = who ? trim(who, 60) : '';

  const framework = clean(patterns?.persuasion_framework);
  if (framework) {
    learnings.push({
      text: target
        ? `El framework ${framework} funcionó con ${target}.`
        : `El framework ${framework} sostuvo la estructura del anuncio.`,
      evidence,
    });
  }

  for (const t of psych?.persuasion_triggers ?? []) {
    const name = clean(t?.trigger);
    const how = clean(t?.how_used);
    const strength = typeof t?.strength === 'number' ? t.strength : null;
    if (!name || strength == null || strength < 8) continue;
    learnings.push({
      text: [
        `Disparador "${name}" (fuerza ${strength}/10)`,
        target ? ` con ${target}` : '',
        how ? `: ${how}` : '.',
      ].join(''),
      evidence,
    });
  }

  for (const b of psych?.cognitive_biases ?? []) {
    const bias = clean(b?.bias);
    const how = clean(b?.how_exploited);
    if (!bias || !how) continue;
    learnings.push({ text: `Sesgo ${bias}: ${how}`, evidence });
  }

  return { persona, angle, hooks, learnings };
}
