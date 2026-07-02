// =============================================================================
// AdDissector - Client-side audio extraction for transcription
// Decodes a video/audio file in the browser, downmixes to mono, resamples to
// 16 kHz (what Whisper uses internally) and encodes a compact 16-bit WAV.
// This keeps the payload sent to /api/transcribe well under Vercel's 4.5 MB
// serverless request-body limit (a full MP4 would be rejected with a 413).
// =============================================================================

const TARGET_SAMPLE_RATE = 16000;

interface AudioContextWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

function getAudioContextCtor(): typeof AudioContext {
  const w = window as AudioContextWindow;
  const Ctor = window.AudioContext || w.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API not available in this browser');
  return Ctor;
}

/**
 * Encodes a mono AudioBuffer (already at the target sample rate) into a
 * 16-bit PCM WAV Blob. No external dependencies.
 */
function encodeWavMono16(buffer: AudioBuffer): Blob {
  const samples = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const dataLength = samples.length * 2;
  const ab = new ArrayBuffer(44 + dataLength);
  const view = new DataView(ab);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, s, true);
    offset += 2;
  }

  return new Blob([ab], { type: 'audio/wav' });
}

/**
 * Extracts the audio track of a media file and returns a small mono 16 kHz WAV
 * File suitable for upload to the transcription endpoint.
 *
 * Falls back to returning the original file if decoding is not possible (the
 * caller can still try, and small files transcribe fine as-is).
 */
export async function extractAudioForTranscription(file: File): Promise<File> {
  const arrayBuffer = await file.arrayBuffer();

  const Ctor = getAudioContextCtor();
  const decodeCtx = new Ctor();
  let decoded: AudioBuffer;
  try {
    // slice(0) -> pass a copy; decodeAudioData detaches the buffer
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void decodeCtx.close();
  }

  // Resample to mono / 16 kHz via an offline context.
  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();

  const wavBlob = encodeWavMono16(rendered);
  const baseName = file.name.replace(/\.[^/.]+$/, '') || 'audio';
  return new File([wavBlob], `${baseName}.wav`, { type: 'audio/wav' });
}
