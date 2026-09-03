// =============================================================================
// AdDissector - Client-side image preprocessing for static-ad analysis
// Vercel serverless functions reject request bodies over 4.5 MB, and a raw
// phone screenshot can easily blow past that once base64-encoded. We downscale
// to a sane max dimension and re-encode as JPEG before sending to /api/analyze-image.
// =============================================================================

export interface PreparedImage {
  /** Downscaled JPEG data URL sent to the analysis model. */
  dataUrl: string;
  /** Smaller JPEG data URL used as the library thumbnail. */
  previewDataUrl: string;
  width: number;
  height: number;
  aspectRatio: string;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Human-friendly aspect ratio (e.g. "9:16") snapped to common ad formats. */
function computeAspectRatio(w: number, h: number): string {
  if (!w || !h) return '';
  const common: Array<[number, number]> = [
    [9, 16], [4, 5], [1, 1], [16, 9], [2, 3], [3, 4], [3, 2], [4, 3],
  ];
  const ratio = w / h;
  let best = '';
  let bestDelta = Infinity;
  for (const [rw, rh] of common) {
    const delta = Math.abs(ratio - rw / rh);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = `${rw}:${rh}`;
    }
  }
  // If it doesn't snap cleanly to a common format, fall back to the reduced ratio.
  if (bestDelta > 0.06) {
    const g = gcd(w, h) || 1;
    return `${Math.round(w / g)}:${Math.round(h / g)}`;
  }
  return best;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

function renderToDataUrl(
  img: HTMLImageElement,
  maxDim: number,
  quality: number
): string {
  const { naturalWidth: w, naturalHeight: h } = img;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const targetW = Math.max(1, Math.round(w * scale));
  const targetH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');
  // White backdrop so transparent PNGs don't turn black when flattened to JPEG.
  ctx.fillStyle = 'var(--color-surface)';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Downscale + re-encode an uploaded image for analysis and library preview.
 * - analysis: longest side capped at 1536px (plenty for vision), JPEG q0.85
 * - preview: longest side capped at 768px, JPEG q0.8
 */
export async function prepareImageForAnalysis(file: File): Promise<PreparedImage> {
  const img = await loadImage(file);
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  const dataUrl = renderToDataUrl(img, 1536, 0.85);
  const previewDataUrl = renderToDataUrl(img, 768, 0.8);

  return {
    dataUrl,
    previewDataUrl,
    width,
    height,
    aspectRatio: computeAspectRatio(width, height),
  };
}
