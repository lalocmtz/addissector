// =============================================================================
// AdDissector - Claude Video Analysis & Variant Generation (v2)
// Client-side module that calls internal API routes
// =============================================================================

import type {
  AnalysisResult,
  VariantsResult,
  CrossAnalysisResult,
  TranscriptResult,
} from './analysis-schema';
import type { ExtractedFrame, VideoMetadata } from './frame-extractor';

/**
 * Analyzes video frames and transcript using Claude via /api/analyze.
 */
export async function analyzeVideo(
  frames: ExtractedFrame[],
  transcript: TranscriptResult,
  videoMeta: VideoMetadata
): Promise<AnalysisResult> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frames: frames.map((f) => ({
        timestamp: f.timestamp,
        dataUrl: f.dataUrl,
      })),
      transcript,
      videoMeta,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Video analysis failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Generates additional script and seedance variants via /api/variants.
 */
export async function generateVariants(
  analysis: AnalysisResult
): Promise<VariantsResult> {
  const response = await fetch('/api/variants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysisJson: analysis }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Variant generation failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Generates cross-analysis of multiple videos via /api/cross-analyze.
 */
export async function generateCrossAnalysis(
  analyses: AnalysisResult[]
): Promise<CrossAnalysisResult> {
  const response = await fetch('/api/cross-analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analyses }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Cross-analysis failed (${response.status}): ${errorText}`);
  }

  return response.json();
}
