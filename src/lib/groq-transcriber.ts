// =============================================================================
// AdDissector - Video Transcription via Groq Whisper
// Client-side module that calls the internal /api/transcribe route
// =============================================================================

import type { TranscriptResult } from './analysis-schema';

interface GroqSegment {
  start: number;
  end: number;
  text: string;
}

interface GroqTranscriptionResponse {
  text: string;
  segments?: GroqSegment[];
}

/**
 * Transcribes a video file by sending it to the internal /api/transcribe route.
 *
 * The internal route forwards the request to Groq's Whisper API. This avoids
 * exposing the Groq API key to the client.
 *
 * @param file - The video file to transcribe
 * @returns Parsed transcript with full text and timed segments
 * @throws Error if the transcription request fails or returns invalid data
 */
export async function transcribeVideo(file: File): Promise<TranscriptResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `Transcription failed (${response.status}): ${errorText}`
    );
  }

  const data: GroqTranscriptionResponse = await response.json();

  if (!data.text && (!data.segments || data.segments.length === 0)) {
    throw new Error(
      'Transcription returned empty results. The video may have no audible speech.'
    );
  }

  const segments = (data.segments ?? []).map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text.trim(),
  }));

  const transcript =
    data.text?.trim() ||
    segments.map((s) => s.text).join(' ');

  return { transcript, segments };
}
