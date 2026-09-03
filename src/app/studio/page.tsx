'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Film, Image as ImageIcon, Sparkles, Loader2 } from 'lucide-react';
import VideoUploader from '@/components/VideoUploader';
import ImageUploader from '@/components/ImageUploader';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { extractFrames, selectFramesForAnalysis } from '@/lib/frame-extractor';
import { extractAudioForTranscription } from '@/lib/audio-extractor';
import { prepareImageForAnalysis } from '@/lib/image-preprocess';
import type { AnalysisResult, ImageAnalysisResult, TranscriptResult } from '@/lib/analysis-schema';

interface FileProgress {
  stage: string;
  percent: number;
}

interface AnalysisError {
  message: string;
  upgrade?: boolean;
}

function StudioContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { me, refresh, activeBrand, activeBrandId, setActiveBrandId } = useMe();

  const [mode, setMode] = useState<'video' | 'image'>('video');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<Map<string, FileProgress>>(new Map());
  const [error, setError] = useState<AnalysisError | null>(null);

  // Onboarding: nombrar la marca en el primer login (marca por defecto, sin análisis).
  const [showWizard, setShowWizard] = useState(false);
  const [wizardName, setWizardName] = useState('');
  const [wizardSaving, setWizardSaving] = useState(false);
  // Viene desde Meta: analizar un ganador específico (vincula el análisis al anuncio)
  const adParam = searchParams.get('ad');

  useEffect(() => {
    if (!me?.configured || !activeBrand) return;
    const dismissed =
      typeof window !== 'undefined' && localStorage.getItem('addna-onboarded') === '1';
    if (!dismissed && me.brands.length === 1 && activeBrand.name === 'Mi marca') {
      setShowWizard(true);
    }
  }, [me, activeBrand]);

  const completeWizard = async () => {
    const name = wizardName.trim();
    if (!name || !activeBrand) {
      localStorage.setItem('addna-onboarded', '1');
      setShowWizard(false);
      return;
    }
    setWizardSaving(true);
    try {
      await fetch(`/api/brands/${activeBrand.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await refresh();
    } finally {
      localStorage.setItem('addna-onboarded', '1');
      setWizardSaving(false);
      setShowWizard(false);
    }
  };

  const updateProgress = useCallback((fileName: string, stage: string, percent: number) => {
    setProgress(prev => {
      const next = new Map(prev);
      next.set(fileName, { stage, percent });
      return next;
    });
  }, []);

  const handleApiError = useCallback(async (res: Response): Promise<never> => {
    const errData = await res.json().catch(() => ({ error: `Error ${res.status}` }));
    const message = errData.error || `Error ${res.status}`;
    const err = new Error(message) as Error & { upgrade?: boolean };
    if (res.status === 402) err.upgrade = true;
    throw err;
  }, []);

  const handleAnalyze = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    setError(null);
    const newResults = new Map<string, AnalysisResult>();
    // Ids de los creativos recién guardados: /analyze se los pasa al Cerebro
    // para que se alimente solo de cada ganador.
    const savedIds: string[] = [];

    for (const file of files) {
      try {
        updateProgress(file.name, 'Extrayendo frames...', 10);
        const { frames, metadata } = await extractFrames(file);
        // Cap at 12 frames: enough coverage (hook + spread + CTA) while keeping
        // the Claude vision call fast enough to finish within the timeout.
        const selectedFrames = selectFramesForAnalysis(frames, 12);

        updateProgress(file.name, 'Extrayendo audio...', 25);
        let audioForUpload: File = file;
        try {
          audioForUpload = await extractAudioForTranscription(file);
        } catch {
          audioForUpload = file;
        }

        updateProgress(file.name, 'Transcribiendo audio...', 35);
        const formData = new FormData();
        formData.append('file', audioForUpload);
        const transcriptRes = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });
        if (!transcriptRes.ok) await handleApiError(transcriptRes);
        const transcript: TranscriptResult = await transcriptRes.json();

        updateProgress(file.name, 'Analizando con AI...', 55);
        const analyzeRes = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frames: selectedFrames.map(f => ({
              timestamp: f.timestamp,
              dataUrl: f.dataUrl,
            })),
            transcript,
            videoMeta: {
              duration: metadata.duration,
              width: metadata.width,
              height: metadata.height,
              aspectRatio: metadata.aspectRatio,
            },
          }),
        });
        if (!analyzeRes.ok) await handleApiError(analyzeRes);
        const analysis: AnalysisResult = await analyzeRes.json();

        // Sube el VIDEO ORIGINAL al storage para poder reverlo en la Biblioteca.
        updateProgress(file.name, 'Guardando video original...', 80);
        let videoPath: string | null = null;
        try {
          const urlRes = await fetch('/api/creatives/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name }),
          });
          if (urlRes.ok) {
            const { path, signedUrl } = await urlRes.json();
            const put = await fetch(signedUrl, {
              method: 'PUT',
              headers: { 'Content-Type': file.type || 'video/mp4' },
              body: file,
            });
            if (put.ok) videoPath = path;
          }
        } catch {
          /* el video es best-effort: el análisis no se pierde */
        }

        updateProgress(file.name, 'Guardando en biblioteca...', 92);
        // Persist to the library (Supabase). Non-blocking: a save failure must
        // never lose the analysis the user just paid for.
        try {
          const previewFrame =
            selectedFrames[Math.floor(selectedFrames.length / 2)] ?? selectedFrames[0];
          const saveRes = await fetch('/api/creatives', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: adParam || file.name,
              type: 'video',
              brandId: activeBrandId,
              previewDataUrl: previewFrame?.dataUrl ?? null,
              duration: metadata.duration,
              aspectRatio: metadata.aspectRatio,
              transcript: transcript.transcript,
              analysis,
              videoPath,
              adName: adParam || file.name,
            }),
          });
          if (saveRes.ok) {
            const saved = (await saveRes.json()) as { id?: string };
            if (saved.id) savedIds.push(saved.id);
          }
        } catch {
          /* library save is best-effort */
        }

        updateProgress(file.name, 'Completado', 100);
        newResults.set(file.name, analysis);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        const upgrade = Boolean((err as { upgrade?: boolean })?.upgrade);
        updateProgress(file.name, `Error: ${message}`, -1);
        setError({ message, upgrade });
        if (upgrade) break;
      }
    }

    setIsProcessing(false);
    refresh(); // actualiza el contador de uso en el header

    if (newResults.size > 0) {
      sessionStorage.setItem('addissector-results', JSON.stringify(Object.fromEntries(newResults)));
      sessionStorage.setItem('addna-ingest-queue', JSON.stringify(savedIds));
      router.push('/analyze');
    }
  }, [router, updateProgress, activeBrandId, refresh, handleApiError]);

  const handleAnalyzeImages = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    setError(null);
    const newResults = new Map<string, { analysis: ImageAnalysisResult; previewUrl: string | null }>();

    for (const file of files) {
      try {
        updateProgress(file.name, 'Preparando imagen...', 20);
        const prepared = await prepareImageForAnalysis(file);

        updateProgress(file.name, 'Analizando con AI...', 55);
        const analyzeRes = await fetch('/api/analyze-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: prepared.dataUrl,
            imageMeta: {
              width: prepared.width,
              height: prepared.height,
              aspectRatio: prepared.aspectRatio,
            },
          }),
        });
        if (!analyzeRes.ok) await handleApiError(analyzeRes);
        const analysis: ImageAnalysisResult = await analyzeRes.json();

        updateProgress(file.name, 'Guardando en biblioteca...', 90);
        try {
          await fetch('/api/creatives', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: file.name,
              type: 'image',
              brandId: activeBrandId,
              previewDataUrl: prepared.previewDataUrl,
              aspectRatio: prepared.aspectRatio,
              analysis,
            }),
          });
        } catch {
          /* library save is best-effort */
        }

        updateProgress(file.name, 'Completado', 100);
        newResults.set(file.name, { analysis, previewUrl: prepared.previewDataUrl });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        const upgrade = Boolean((err as { upgrade?: boolean })?.upgrade);
        updateProgress(file.name, `Error: ${message}`, -1);
        setError({ message, upgrade });
        if (upgrade) break;
      }
    }

    setIsProcessing(false);
    refresh();

    if (newResults.size > 0) {
      sessionStorage.setItem('addissector-image-results', JSON.stringify(Object.fromEntries(newResults)));
      router.push('/analyze-image');
    }
  }, [router, updateProgress, activeBrandId, refresh, handleApiError]);


  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      {/* Wizard de onboarding */}
      {showWizard && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/70  px-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-6"
          >
            <div className="w-11 h-11 rounded-xl gradient-blue flex items-center justify-center mb-4">
              <Sparkles className="w-5 h-5 text-on-accent" />
            </div>
            <h2 className="text-lg font-bold mb-1">¡Bienvenido! ¿Cómo se llama tu marca?</h2>
            <p className="text-sm text-ink-3 mb-4">
              Tus análisis se organizan por marca. Ponle nombre a la primera y sube tu primer
              creativo ganador.
            </p>
            <input
              autoFocus
              type="text"
              value={wizardName}
              onChange={(e) => setWizardName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && completeWizard()}
              placeholder="Ej. Skinglow"
              className="w-full px-3 py-2.5 rounded-xl bg-canvas border border-line text-sm text-ink placeholder:text-ink-4 focus:border-accent/60 focus:outline-none mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={completeWizard}
                disabled={wizardSaving}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold gradient-blue text-on-accent disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {wizardSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Empezar
              </button>
              <button
                onClick={() => {
                  localStorage.setItem('addna-onboarded', '1');
                  setShowWizard(false);
                }}
                className="px-4 py-2.5 rounded-xl text-sm text-ink-3 border border-line hover:text-ink"
              >
                Después
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Hero */}
      <section className="px-6 pt-10 pb-6">
        <div className="max-w-4xl mx-auto text-center">
          {adParam && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full border border-warn/30 bg-warn/10 text-warn mb-6 max-w-full"
            >
              <Film className="w-4 h-4 shrink-0" />
              <span className="truncate">
                Analizando el ganador de Meta: <b>{adParam}</b> — descarga el video del Ads Manager y súbelo aquí; quedará vinculado con sus métricas.
              </span>
            </motion.div>
          )}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-2xl font-semibold mb-2 tracking-tight">Analyze a creative</h2>
            <p className="text-sm text-ink-3 max-w-2xl mx-auto mb-2">
              Upload a video or image{activeBrand ? ` for ${activeBrand.name}` : ''}. It gets transcribed, analyzed and stored with its Meta metrics.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Upload */}
      <section className="px-6 pb-12">
        <div className="max-w-4xl mx-auto">
          {/* Mode toggle: Video vs Imagen */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex gap-1 bg-surface border border-line rounded-xl p-1">
              <button
                onClick={() => !isProcessing && setMode('video')}
                disabled={isProcessing}
                className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
                  mode === 'video'
                    ? 'bg-accent text-on-accent shadow-lg '
                    : 'text-ink-3 hover:text-ink'
                }`}
              >
                <Film className="w-4 h-4" />
                Video
              </button>
              <button
                onClick={() => !isProcessing && setMode('image')}
                disabled={isProcessing}
                className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
                  mode === 'image'
                    ? 'bg-accent text-on-accent shadow-lg '
                    : 'text-ink-3 hover:text-ink'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                Imagen
              </button>
            </div>
          </div>

          {mode === 'video' ? (
            <VideoUploader
              onAnalyze={handleAnalyze}
              isProcessing={isProcessing}
              progress={progress}
            />
          ) : (
            <ImageUploader
              onAnalyze={handleAnalyzeImages}
              isProcessing={isProcessing}
              progress={progress}
            />
          )}
          {error && !isProcessing && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-4 p-4 rounded-xl border text-sm ${
                error.upgrade
                  ? 'bg-warn/10 border-warn/25 text-warn'
                  : 'bg-danger/10 border-danger/20 text-danger font-[family-name:var(--font-mono)]'
              }`}
            >
              <p>{error.message}</p>
            </motion.div>
          )}
        </div>
      </section>

    </main>
  );
}

export default function StudioPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      }
    >
      <StudioContent />
    </Suspense>
  );
}
