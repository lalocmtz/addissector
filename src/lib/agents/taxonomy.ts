// =============================================================================
// Taxonomy — the controlled vocabulary for transversal dimensions and the
// shared types the classifier and the coverage queries use.
//
// Dimensions are ATTRIBUTES of an ad, never levels of the hierarchy. The same
// hook can appear under three angles; that is a feature. Adding a dimension
// value is inserting rows in ad_dimension, not a migration.
// =============================================================================

export const DIMENSIONS = [
  'hook', 'format', 'narrative_structure', 'creator', 'proof_type', 'offer', 'cta',
  'visual_style', 'duration_bucket', 'pacing', 'awareness_level', 'emotional_driver',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Controlled values. `hook` is free text (it maps to the hook bank instead). */
export const DIMENSION_VALUES: Record<Exclude<Dimension, 'hook'>, readonly string[]> = {
  format: ['ugc_talking_head', 'ugc_voiceover', 'static_image', 'product_demo', 'testimonial', 'comparison', 'screen_recording', 'founder', 'before_after', 'listicle', 'meme', 'reply_to_comment', 'other'],
  narrative_structure: ['pas', 'aida', 'problem_solution', 'testimonial', 'comparison', 'myth_vs_fact', 'listicle', 'story', 'demo', 'reply_to_comment', 'apology_reframe', 'other'],
  creator: ['founder', 'customer_ugc', 'actor', 'no_person', 'influencer', 'unknown'],
  proof_type: ['before_after', 'testimonial', 'demo', 'ingredient', 'authority', 'social_numbers', 'guarantee', 'none'],
  offer: ['discount', 'bundle', 'free_shipping', 'guarantee', 'price_anchor', 'none', 'other'],
  cta: ['shop_now', 'learn_more', 'comment', 'link_in_bio', 'dm', 'none', 'other'],
  visual_style: ['raw_ugc', 'polished', 'text_heavy', 'product_only', 'lifestyle', 'mixed'],
  duration_bucket: ['image', 'under_10s', '10_20s', '20_40s', '40_60s', 'over_60s'],
  pacing: ['fast', 'medium', 'slow'],
  awareness_level: ['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware'],
  emotional_driver: ['shame', 'fear', 'desire', 'curiosity', 'humor', 'trust', 'urgency', 'pride', 'relief', 'belonging', 'other'],
};

export function durationBucket(seconds: number | null | undefined, isImage: boolean): string {
  if (isImage) return 'image';
  if (seconds == null || !Number.isFinite(seconds)) return 'unknown';
  if (seconds < 10) return 'under_10s';
  if (seconds < 20) return '10_20s';
  if (seconds < 40) return '20_40s';
  if (seconds <= 60) return '40_60s';
  return 'over_60s';
}

export const CLASSIFIER_VERSION = 'taxonomy-classifier/1';
export const LINKER_VERSION = 'learning-linker/1';
