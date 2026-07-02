'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Film, Image as ImageIcon, Sparkles, ArrowRight, Loader2, PartyPopper } from 'lucide-react';
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
  const isWelcome = searchParams.get('welcome') === '1';

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

        updateProgress(file.name, 'Guardando en biblioteca...', 90);
        // Persist to the library (Supabase). Non-blocking: a save failure must
        // never lose the analysis the user just paid for.
        try {
          const previewFrame =
            selectedFrames[Math.floor(selectedFrames.length / 2)] ?? selectedFrames[0];
          await fetch('/api/creatives', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: file.name,
              type: 'video',
              brandId: activeBrandId,
              previewDataUrl: previewFrame?.dataUrl ?? null,
              duration: metadata.duration,
              aspectRatio: metadata.aspectRatio,
              transcript: transcript.transcript,
              analysis,
            }),
          });
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

  const steps = [
    { n: '1', t: 'Sube tu anuncio ganador', d: 'El video o imagen que ya te está vendiendo.' },
    { n: '2', t: 'Entiende por qué vende', d: 'Veredicto claro + la receta que lo hace funcionar.' },
    { n: '3', t: 'Haz más como ese', d: 'Prompts para IA o brief para tu equipo creativo.' },
  ];

  const remaining = me?.usage?.remaining;

  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      {/* Wizard de onboarding */}
      {showWizard && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-2xl border border-[#1e1e2e] bg-[#111118] p-6"
          >
            <div className="w-11 h-11 rounded-xl gradient-blue flex items-center justify-center mb-4">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-bold mb-1">¡Bienvenido! ¿Cómo se llama tu marca?</h2>
            <p className="text-sm text-[#94a3b8] mb-4">
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
              className="w-full px-3 py-2.5 rounded-xl bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-[#f1f5f9] placeholder:text-[#475569] focus:border-[#3b82f6]/60 focus:outline-none mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={completeWizard}
                disabled={wizardSaving}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold gradient-blue text-white disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {wizardSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Empezar
              </button>
              <button
                onClick={() => {
                  localStorage.setItem('addna-onboarded', '1');
                  setShowWizard(false);
                }}
                className="px-4 py-2.5 rounded-xl text-sm text-[#94a3b8] border border-[#1e1e2e] hover:text-[#f1f5f9]"
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
          {isWelcome && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full border border-[#22c55e]/30 bg-[#22c55e]/10 text-[#4ade80] mb-6"
            >
              <PartyPopper className="w-4 h-4" />
              ¡Tu plan está activo! Sube tu primer creativo ganador.
            </motion.div>
          )}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-4xl sm:text-5xl font-bold mb-4 leading-tight">
              <span className="text-[#f1f5f9]">Entiende.</span>{' '}
              <span className="gradient-text">Replica.</span>{' '}
              <span className="text-[#f1f5f9]">Escala.</span>
            </h2>
            <p className="text-lg text-[#94a3b8] max-w-2xl mx-auto mb-2">
              Sube el anuncio que ya te funciona{activeBrand ? ` para ${activeBrand.name}` : ''} y
              recibe: por qué vende, la receta ganadora y las indicaciones para hacer más como ese.
            </p>
            {typeof remaining === 'number' && Number.isFinite(remaining) && (
              <p className="text-sm text-[#64748b] mb-6 font-[family-name:var(--font-mono)]">
                Te quedan <span className="text-[#3b82f6] font-bold">{remaining}</span> análisis este mes
              </p>
            )}
          </motion.div>
        </div>
      </section>

      {/* Upload */}
      <section className="px-6 pb-12">
        <div className="max-w-4xl mx-auto">
          {/* Mode toggle: Video vs Imagen */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex gap-1 bg-[#111118] border border-[#1e1e2e] rounded-xl p-1">
              <button
                onClick={() => !isProcessing && setMode('video')}
                disabled={isProcessing}
                className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
                  mode === 'video'
                    ? 'bg-[#3b82f6] text-white shadow-lg shadow-blue-500/20'
                    : 'text-[#94a3b8] hover:text-[#f1f5f9]'
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
                    ? 'bg-[#8b5cf6] text-white shadow-lg shadow-purple-500/20'
                    : 'text-[#94a3b8] hover:text-[#f1f5f9]'
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
                  ? 'bg-[#f59e0b]/10 border-[#f59e0b]/25 text-[#fbbf24]'
                  : 'bg-[#f43f5e]/10 border-[#f43f5e]/20 text-[#f43f5e] font-[family-name:var(--font-mono)]'
              }`}
            >
              <p>{error.message}</p>
              {error.upgrade && (
                <Link
                  href="/#precios"
                  className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-lg gradient-blue text-white text-sm font-semibold"
                >
                  Ver planes
                  <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </motion.div>
          )}
        </div>
      </section>

      {/* Cómo funciona (3 pasos, mismo lenguaje que la landing) */}
      <section className="px-6 pb-20">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {steps.map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 * i }}
                className="card card-hover"
              >
                <div className="w-8 h-8 rounded-lg gradient-blue flex items-center justify-center text-white text-sm font-bold mb-3">
                  {s.n}
                </div>
                <h3 className="font-semibold text-sm mb-1.5">{s.t}</h3>
                <p className="text-xs text-[#94a3b8] leading-relaxed">{s.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1e1e2e] px-6 py-6 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#64748b] font-[family-name:var(--font-mono)]">
          <span>AdDNA — La inteligencia detrás de tus anuncios ganadores</span>
          <span className="flex items-center gap-1">
            <ArrowRight className="w-3 h-3" />
            Sube un creativo para comenzar
          </span>
        </div>
      </footer>
    </main>
  );
}

export default function StudioPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-[#3b82f6] animate-spin" />
        </div>
      }
    >
      <StudioContent />
    </Suspense>
  );
}
