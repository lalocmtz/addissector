'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Scan, Zap, Film, FileText, Rocket, ArrowRight } from 'lucide-react';
import VideoUploader from '@/components/VideoUploader';
import { extractFrames, selectFramesForAnalysis } from '@/lib/frame-extractor';
import type { AnalysisResult, TranscriptResult } from '@/lib/analysis-schema';

interface FileProgress {
  stage: string;
  percent: number;
}

export default function HomePage() {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<Map<string, FileProgress>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const updateProgress = useCallback((fileName: string, stage: string, percent: number) => {
    setProgress(prev => {
      const next = new Map(prev);
      next.set(fileName, { stage, percent });
      return next;
    });
  }, []);

  const handleAnalyze = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    setError(null);
    const newResults = new Map<string, AnalysisResult>();

    for (const file of files) {
      try {
        updateProgress(file.name, 'Extrayendo frames...', 10);
        const { frames, metadata } = await extractFrames(file);
        const selectedFrames = selectFramesForAnalysis(frames);

        updateProgress(file.name, 'Transcribiendo audio...', 30);
        const formData = new FormData();
        formData.append('file', file);
        const transcriptRes = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });
        if (!transcriptRes.ok) {
          const errData = await transcriptRes.json().catch(() => ({ error: 'Transcription failed' }));
          throw new Error(errData.error || `Transcription failed: ${transcriptRes.status}`);
        }
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
        if (!analyzeRes.ok) {
          const errData = await analyzeRes.json().catch(() => ({ error: 'Analysis failed' }));
          throw new Error(errData.error || `Analysis failed: ${analyzeRes.status}`);
        }
        const analysis: AnalysisResult = await analyzeRes.json();

        updateProgress(file.name, 'Completado', 100);
        newResults.set(file.name, analysis);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        updateProgress(file.name, `Error: ${message}`, -1);
        setError(message);
      }
    }

    setIsProcessing(false);

    if (newResults.size > 0) {
      sessionStorage.setItem('addissector-results', JSON.stringify(Object.fromEntries(newResults)));
      router.push('/analyze');
    }
  }, [router, updateProgress]);

  const features = [
    { icon: Scan, title: 'Diseccion Estructural', desc: 'Analisis completo del video: tipo, contexto visual, producto, transcripcion y estructura ganadora.' },
    { icon: FileText, title: 'Guiones + Variantes', desc: 'Guion original limpio para ElevenLabs + 3 variantes con diferente angulo, escenario y persona.' },
    { icon: Film, title: 'Prompts Seedance', desc: 'Prompts de 15s por segmento listos para Seedance con 2 variantes visuales por segmento.' },
    { icon: Rocket, title: 'Plan de Replicacion', desc: 'Plan ejecutivo: cuantas generaciones de Seedance, que guion usar en ElevenLabs, y como editar.' },
  ];

  return (
    <main className="flex-1">
      {/* Header */}
      <header className="border-b border-[#1e1e2e] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-blue flex items-center justify-center">
              <Scan className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold font-[family-name:var(--font-mono)] tracking-tight">
                AdDissector
              </h1>
              <p className="text-xs text-[#64748b] font-[family-name:var(--font-mono)]">
                Video Intelligence Platform
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-[#64748b] font-[family-name:var(--font-mono)]">
            <Zap className="w-3 h-3 text-[#f59e0b]" />
            Seedance + ElevenLabs Ready
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 pt-10 pb-6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-4xl sm:text-5xl font-bold mb-4 leading-tight">
              <span className="gradient-text">Disecciona.</span>{' '}
              <span className="text-[#f1f5f9]">Replica.</span>{' '}
              <span className="gradient-text">Escala.</span>
            </h2>
            <p className="text-lg text-[#94a3b8] max-w-2xl mx-auto mb-3">
              Sube un video ganador y obtén todo lo necesario para replicarlo:
              guiones para ElevenLabs, prompts para Seedance y un plan de produccion completo.
            </p>
            <p className="text-sm text-[#64748b] max-w-xl mx-auto mb-8">
              1 video = analisis individual · 2-5 videos = patrones cruzados + formula maestra
            </p>
          </motion.div>
        </div>
      </section>

      {/* Upload */}
      <section className="px-6 pb-12">
        <div className="max-w-4xl mx-auto">
          <VideoUploader
            onAnalyze={handleAnalyze}
            isProcessing={isProcessing}
            progress={progress}
          />
          {error && !isProcessing && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-4 rounded-xl bg-[#f43f5e]/10 border border-[#f43f5e]/20 text-[#f43f5e] text-sm font-[family-name:var(--font-mono)]"
            >
              {error}
            </motion.div>
          )}
        </div>
      </section>

      {/* Features */}
      <section className="px-6 pb-20">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map((feat, i) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 * i }}
                className="card card-hover"
              >
                <feat.icon className="w-8 h-8 text-[#3b82f6] mb-3" />
                <h3 className="font-semibold text-sm mb-2">{feat.title}</h3>
                <p className="text-xs text-[#94a3b8] leading-relaxed">{feat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1e1e2e] px-6 py-6 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#64748b] font-[family-name:var(--font-mono)]">
          <span>AdDissector — Video Intelligence Platform</span>
          <span className="flex items-center gap-1">
            <ArrowRight className="w-3 h-3" />
            Sube un video para comenzar
          </span>
        </div>
      </footer>
    </main>
  );
}
