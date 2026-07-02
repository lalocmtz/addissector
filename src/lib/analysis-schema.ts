// =============================================================================
// AdDissector - Analysis Schema Types (v2)
// Restructured for Seedance + ElevenLabs replication workflow
// =============================================================================

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  transcript: string;
  segments: TranscriptSegment[];
}

// ---------------------------------------------------------------------------
// Block 1 — Structural Analysis
// ---------------------------------------------------------------------------

export interface TranscriptionEntry {
  second: string;
  text: string;
}

export interface WinningStructure {
  hook: string;
  development: string;
  cta: string;
  persuasion_elements: string[];
  tone: string;
  format: string;
}

export interface StructuralAnalysis {
  video_type: string;
  visual_context: string;
  product: string;
  total_duration_seconds: number;
  seedance_segments_count: number;
  transcription: TranscriptionEntry[];
  content_summary: string;
  winning_structure: WinningStructure;
}

// ---------------------------------------------------------------------------
// Block 2 — Scripts
// ---------------------------------------------------------------------------

export interface ScriptVariant {
  variant_number: number;
  scenario: string;
  script: string;
  /** Modo IA: prompt listo para pegar en un generador (opcional; para video el guion hace de base). */
  prompt?: string;
  /** Modo Equipo: brief claro para diseñador/editor, sin jerga técnica. */
  team_brief?: string;
}

// ---------------------------------------------------------------------------
// Block 3 — Seedance Prompts (15s segments)
// ---------------------------------------------------------------------------

export interface SeedanceSegmentVariant {
  variant_number: number;
  prompt: string;
}

export interface SeedanceSegment {
  segment_number: number;
  total_segments: number;
  time_start: string;
  time_end: string;
  prompt: string;
  variants: SeedanceSegmentVariant[];
}

// ---------------------------------------------------------------------------
// Block 4 — Replication Plan
// ---------------------------------------------------------------------------

export interface SegmentSummary {
  segment: number;
  summary: string;
}

export interface ReplicationPlan {
  seedance_count: number;
  segments_summary: SegmentSummary[];
  elevenlabs_script: string;
  audio_duration_estimate: number;
  voice_tone: string;
  editing_notes: string;
}

// ---------------------------------------------------------------------------
// Dashboard — Visual Analysis (recovered from v1)
// ---------------------------------------------------------------------------

export interface DashboardFrame {
  timestamp: string;
  description: string;
  composition: string;
  dominant_colors: string[];
  text_on_screen: string | null;
  subject: string;
  camera_movement: string;
}

export interface HookDashboard {
  type: string;
  duration_seconds: number;
  effectiveness_score: number;
  effectiveness_reasoning: string;
  scroll_stop_mechanism: string;
  frame_descriptions: string[];
  dominant_colors: string[];
  text_overlay: string | null;
  audio_tone: string;
  music_type: string;
}

export interface PatternsDashboard {
  persuasion_framework: string;
  retention_techniques: string[];
  power_words: string[];
  emotional_arc: string;
  pacing_rhythm: string;
  music_strategy: string;
  ugc_markers: string[];
}

export interface Dashboard {
  hook: HookDashboard;
  visual_frames: DashboardFrame[];
  patterns: PatternsDashboard;
}

// ---------------------------------------------------------------------------
// Block 2.7 — Deep Psychological Analysis
// ---------------------------------------------------------------------------

export interface ScrollStop {
  mechanism: string;
  primary_trigger: string;
  strength_score: number;
  reasoning: string;
}

export interface BuyerPsychology {
  core_desire: string;
  core_pain: string;
  identity_shift: string;
  objections_handled: string[];
}

export interface PersuasionTrigger {
  trigger: string;
  how_used: string;
  timestamp: string;
  strength: number;
}

export interface CognitiveBias {
  bias: string;
  how_exploited: string;
}

export interface EmotionalBeat {
  second: string;
  emotion: string;
  purpose: string;
}

export interface TargetAvatar {
  who: string;
  mindset: string;
  resonance_reason: string;
}

export interface RetentionRiskPoint {
  timestamp: string;
  risk: string;
}

export interface MathBreakdown {
  hook_duration_seconds: number;
  ideal_hook_window: string;
  pacing_score: number;
  retention_risk_points: RetentionRiskPoint[];
  cta_timing: string;
  thumbstop_estimate: string;
}

export interface PsychologicalAnalysis {
  scroll_stop: ScrollStop;
  why_it_converts: string;
  buyer_psychology: BuyerPsychology;
  persuasion_triggers: PersuasionTrigger[];
  cognitive_biases: CognitiveBias[];
  emotional_journey: EmotionalBeat[];
  awareness_level: string;
  market_sophistication: string;
  target_avatar: TargetAvatar;
  math_breakdown: MathBreakdown;
}

// ---------------------------------------------------------------------------
// Interpretación simple (Capa 1 + 2) — lenguaje llano para dueños de negocio
// ---------------------------------------------------------------------------

export type SignalLevel = 'alto' | 'medio' | 'bajo';

export interface SimpleSignal {
  level: SignalLevel;
  note: string;
}

export interface SimpleSignals {
  scroll_stop: SimpleSignal; // Detiene el scroll
  clarity: SimpleSignal;     // Se entiende al instante
  offer: SimpleSignal;       // Oferta convincente
}

export interface SimpleInterpretation {
  verdict: string;           // 1 frase: por qué funciona
  overall_score: number;     // 0-100
  score_label: string;       // Flojo | Decente | Ganador
  signals: SimpleSignals;
  winning_recipe: string[];  // 3-5 viñetas en español simple
  keep: string[];            // qué mantener (no negociable)
  test: string[];            // qué probar (hipótesis)
}

// ---------------------------------------------------------------------------
// Top-Level Analysis Result
// ---------------------------------------------------------------------------

export interface AnalysisResult extends Partial<SimpleInterpretation> {
  structural_analysis: StructuralAnalysis;
  dashboard: Dashboard;
  psychological_analysis: PsychologicalAnalysis;
  original_script: string;
  script_variants: ScriptVariant[];
  seedance_segments: SeedanceSegment[];
  replication_plan: ReplicationPlan;
}

// ---------------------------------------------------------------------------
// Mode 2 — Cross-Analysis (Multi-Video)
// ---------------------------------------------------------------------------

export interface CommonElements {
  hook_pattern: string;
  narrative_structure: string;
  recurring_persuasion: string[];
  dominant_tone: string;
  average_duration: number;
  dominant_format: string;
}

export interface MasterFormula {
  hook: string;
  development: string;
  cta: string;
  recommended_setting: string;
  tone: string;
  mandatory_elements: string[];
}

export interface CrossAnalysisResult {
  videos_analyzed: number;
  common_elements: CommonElements;
  master_formula: MasterFormula;
  master_script: string;
  master_script_variants: ScriptVariant[];
  master_seedance_segments: SeedanceSegment[];
}

// ---------------------------------------------------------------------------
// Stage 3 — Static Image (ad) Analysis
// ---------------------------------------------------------------------------

export interface ImageVisualBreakdown {
  format: string;                 // "9:16 vertical", "1:1", "4:5", etc.
  layout: string;                 // composición / grid / distribución
  focal_point: string;           // dónde cae el ojo primero
  visual_hierarchy: string[];     // elementos ordenados por atención
  color_palette: string[];        // hex codes
  color_psychology: string;       // qué comunica la paleta
  typography: string;             // fuentes / pesos / estilo
  product_presentation: string;   // cómo se muestra el producto
  imagery_style: string;          // foto / 3D / UGC / ilustración / etc.
  branding_elements: string[];    // logo, ubicación, marcadores de marca
}

export interface ImageCopyAnalysis {
  headline: string;               // verbatim
  subheadline: string | null;
  body_text: string | null;
  cta_text: string | null;
  offer_badges: string[];         // "50% OFF", "Hot Sale", etc. verbatim
  all_text_verbatim: string[];    // todo el texto de la imagen, tal cual
  copy_angle: string;             // ángulo persuasivo
  copy_framework: string;         // PAS / AIDA / benefit-led / etc.
}

export interface ImageScorecard {
  stopping_power_score: number;   // 1-10 poder de detener el scroll
  clarity_score: number;          // claridad del mensaje
  offer_strength_score: number;   // fuerza de la oferta
  brand_visibility_score: number; // visibilidad de marca
  overall_score: number;          // 1-10 global
  scorecard_reasoning: string;    // por qué estos scores
}

export interface ReplicationPrompt {
  variant_number: number;
  angle: string;                  // qué cambia (escenario / audiencia / ángulo)
  prompt: string;                 // prompt de generación listo para pegar
  team_brief?: string;            // brief para el diseñador, sin jerga técnica
}

export interface ImageReplication {
  faithful_recreation_prompt: string; // recrear fielmente el ad ganador
  variants: ReplicationPrompt[];       // 3 ángulos frescos
  design_notes: string;                // cómo conservar la estructura ganadora
}

export interface ImageAnalysisResult extends Partial<SimpleInterpretation> {
  visual_breakdown: ImageVisualBreakdown;
  copy_analysis: ImageCopyAnalysis;
  dashboard: ImageScorecard;
  psychological_analysis: PsychologicalAnalysis; // mismo shape que video (reutilizado)
  replication: ImageReplication;
  product?: string;               // denormalizado para la biblioteca
  ad_type?: string;               // denormalizado para la biblioteca
}

// ---------------------------------------------------------------------------
// Variants (on-demand generation)
// ---------------------------------------------------------------------------

export interface VariantsResult {
  script_variants: ScriptVariant[];
  seedance_variants?: {
    segment_number: number;
    variants: SeedanceSegmentVariant[];
  }[];
}
