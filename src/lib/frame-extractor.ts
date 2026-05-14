// =============================================================================
// AdDissector - Client-Side Video Frame Extraction
// Uses HTML5 Video + Canvas API to extract frames for analysis
// =============================================================================

export interface FrameExtractionOptions {
  maxWidth?: number;
  jpegQuality?: number;
  hookDensity?: boolean;
}

export interface ExtractedFrame {
  timestamp: string;
  timeSeconds: number;
  dataUrl: string;
  width: number;
  height: number;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  aspectRatio: string;
}

const DEFAULT_OPTIONS: Required<FrameExtractionOptions> = {
  maxWidth: 512,
  jpegQuality: 0.8,
  hookDensity: true,
};

/**
 * Formats seconds into MM:SS.ms timestamp string.
 */
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = secs.toFixed(2).padStart(5, '0');
  return `${mm}:${ss}`;
}

/**
 * Determines the aspect ratio label from width and height.
 */
function detectAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  if (ratio > 1.5) return '16:9';
  if (ratio < 0.7) return '9:16';
  if (Math.abs(ratio - 1) < 0.15) return '1:1';
  return `${width}:${height}`;
}

/**
 * Calculates the frame budget (how many frames to extract) based on duration.
 */
function calculateFrameBudget(durationSeconds: number): number {
  if (durationSeconds <= 30) return Math.min(Math.ceil(durationSeconds), 30);
  if (durationSeconds <= 60) return 40;
  if (durationSeconds <= 180) return 60;
  if (durationSeconds <= 600) return 80;
  return 100;
}

/**
 * Generates timestamps to extract frames at, including hook density boost.
 */
function generateTimestamps(
  duration: number,
  budget: number,
  hookDensity: boolean
): number[] {
  const timestamps: number[] = [];

  // Hook density: first 5 seconds at 1 frame every 0.5s
  const hookEnd = Math.min(5, duration);
  let hookFrameCount = 0;

  if (hookDensity && duration > 2) {
    for (let t = 0; t < hookEnd; t += 0.5) {
      timestamps.push(t);
      hookFrameCount++;
    }
  }

  // Remaining budget for the rest of the video
  const remainingBudget = Math.max(budget - hookFrameCount, 5);
  const startAfterHook = hookDensity ? hookEnd : 0;
  const remainingDuration = duration - startAfterHook;

  if (remainingDuration > 0) {
    const interval = remainingDuration / remainingBudget;
    for (let i = 0; i < remainingBudget; i++) {
      const t = startAfterHook + i * interval;
      if (t < duration) {
        timestamps.push(t);
      }
    }
  }

  // Deduplicate and sort
  const unique = [...new Set(timestamps.map((t) => Math.round(t * 100) / 100))];
  unique.sort((a, b) => a - b);

  return unique;
}

/**
 * Seeks a video element to a specific time and waits for the seek to complete.
 */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error(`Failed to seek video to ${time}s`));
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = time;
  });
}

/**
 * Captures a single frame from a video element onto a canvas.
 */
function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
  jpegQuality: number
): { dataUrl: string; width: number; height: number } {
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);

  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(video, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
  return { dataUrl, width, height };
}

/**
 * Extracts frames from a video file at calculated intervals.
 *
 * Uses the HTML5 Video element and Canvas API to seek through the video
 * and capture JPEG snapshots. Applies hook density boosting for the first
 * 5 seconds and calculates frame budget based on video duration.
 */
export async function extractFrames(
  file: File,
  options?: FrameExtractionOptions
): Promise<{ frames: ExtractedFrame[]; metadata: VideoMetadata }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const objectUrl = URL.createObjectURL(file);

  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;

    // Wait for metadata to load
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
        reject(new Error('Failed to load video metadata. The file may be corrupted or unsupported.'));
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
    });

    const duration = video.duration;
    if (!isFinite(duration) || duration <= 0) {
      throw new Error('Video has invalid duration. The file may be corrupted.');
    }

    const metadata: VideoMetadata = {
      duration,
      width: video.videoWidth,
      height: video.videoHeight,
      aspectRatio: detectAspectRatio(video.videoWidth, video.videoHeight),
    };

    const budget = calculateFrameBudget(duration);
    const timestamps = generateTimestamps(duration, budget, opts.hookDensity);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create canvas 2D context for frame extraction.');
    }

    const frames: ExtractedFrame[] = [];

    for (const time of timestamps) {
      try {
        await seekTo(video, time);
        const { dataUrl, width, height } = captureFrame(
          video,
          canvas,
          ctx,
          opts.maxWidth,
          opts.jpegQuality
        );
        frames.push({
          timestamp: formatTimestamp(time),
          timeSeconds: time,
          dataUrl,
          width,
          height,
        });
      } catch {
        // Skip frames that fail to seek — some codecs have seek limitations
        continue;
      }
    }

    if (frames.length === 0) {
      throw new Error('No frames could be extracted from the video.');
    }

    return { frames, metadata };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Selects the most strategically important frames for analysis.
 *
 * Selection strategy:
 * - Always includes hook frames (first 5 seconds)
 * - Evenly distributes remaining frames across the video
 * - Always includes the last frame (CTA)
 * - Caps at maxFrames (default 30)
 */
export function selectFramesForAnalysis(
  frames: ExtractedFrame[],
  maxFrames: number = 30
): ExtractedFrame[] {
  if (frames.length <= maxFrames) {
    return frames;
  }

  const selected: ExtractedFrame[] = [];
  const hookThreshold = 5;

  // Always include hook frames (first 5 seconds)
  const hookFrames = frames.filter((f) => f.timeSeconds <= hookThreshold);
  const nonHookFrames = frames.filter((f) => f.timeSeconds > hookThreshold);

  // Add all hook frames (cap at half the budget)
  const maxHookFrames = Math.floor(maxFrames / 2);
  const selectedHookFrames = hookFrames.slice(0, maxHookFrames);
  selected.push(...selectedHookFrames);

  // Budget for non-hook frames (reserve 1 for the last frame)
  const remainingBudget = maxFrames - selected.length - 1;

  if (nonHookFrames.length > 0 && remainingBudget > 0) {
    // Evenly distribute across non-hook frames
    const step = nonHookFrames.length / remainingBudget;
    for (let i = 0; i < remainingBudget; i++) {
      const index = Math.min(
        Math.floor(i * step),
        nonHookFrames.length - 1
      );
      selected.push(nonHookFrames[index]);
    }
  }

  // Always include the last frame (CTA)
  const lastFrame = frames[frames.length - 1];
  if (!selected.includes(lastFrame)) {
    selected.push(lastFrame);
  }

  // Sort by timestamp to maintain chronological order
  selected.sort((a, b) => a.timeSeconds - b.timeSeconds);

  return selected.slice(0, maxFrames);
}
