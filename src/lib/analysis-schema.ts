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
// Top-Level Analysis Result
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  structural_analysis: StructuralAnalysis;
  dashboard: Dashboard;
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
// Variants (on-demand generation)
// ---------------------------------------------------------------------------

export interface VariantsResult {
  script_variants: ScriptVariant[];
  seedance_variants?: {
    segment_number: number;
    variants: SeedanceSegmentVariant[];
  }[];
}
