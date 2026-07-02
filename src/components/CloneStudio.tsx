'use client';

// =============================================================================
// AdDNA — Estudio de Clonación: del análisis del ganador a imagen + video UGC
// con IA (Kie.ai: Nano Banana Pro + Seedance 2.0), en clics guiados.
// Control de costos: cada generación muestra su costo estimado y el saldo real
// de Kie ANTES de gastar. Nada se genera sin confirmación explícita.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Clapperboard, Loader2, Sparkles, Image as ImageIcon, Film, RefreshCw,
  Download, Wallet, AlertTriangle, ChevronDown, Wand2, MessageSquareText,
} from 'lucide-react';
import { getStoredActiveBrandId } from '@/lib/use-me';
import type { GenerationPlan } from '@/lib/replication-prompts';

interface GenerationRow {
  id: string;
  kind: 'image' | 'video';
  status: 'pending' | 'processing' | 'success' | 'failed';
  result_url: string | null;
  variant_label: string | null;
  spoken_script: string | null;
  duration_seconds: number | null;
  error: string | null;
  parent_id: string | null;
  created_at: string;
}

interface VariantOption {
  value: number | null;
  label: string;
}

interface CloneStudioProps {
  analysis: Record<string, unknown>;
  creativeType: 'video' | 'image';
  creativeId?: string | null;
  variantOptions: VariantOption[];
}

interface CreditsInfo {
  configured: boolean;
  credits: number | null;
  estimates: { imageUsd: number; videoPerSecondUsd: number };
}

const fmtUsd = (n: number) => `$${n.toFixed(2)} USD`;

export default function CloneStudio({
  analysis,
  creativeType,
  creativeId,
  variantOptions,
}: CloneStudioProps) {
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [variant, setVariant] = useState<number | null>(variantOptions[0]?.value ?? null);
  const [plan, setPlan] = useState<GenerationPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [image, setImage] = useState<GenerationRow | null>(null);
  const [video, setVideo] = useState<GenerationRow | null>(null);
  const [launching, setLaunching] = useState<'image' | 'video' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GenerationRow[]>([]);
  const pollers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const brandId = typeof window !== 'undefined' ? getStoredActiveBrandId() : null;

  // Saldo de Kie + galería previa
  useEffect(() => {
    if (!open) return;
    fetch('/api/replicate/credits')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCredits(d))
      .catch(() => {});
    if (creativeId) {
      fetch(`/api/replicate/generations?creative=${creativeId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.generations && setGallery(d.generations))
        .catch(() => {});
    }
  }, [open, creativeId]);

  // Polling de una generación hasta que termine
  const track = useCallback((gen: GenerationRow, setter: (g: GenerationRow) => void) => {
    setter(gen);
    if (gen.status === 'success' || gen.status === 'failed') return;
    const existing = pollers.current.get(gen.id);
    if (existing) clearInterval(existing);
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/replicate/status/${gen.id}`);
        if (!res.ok) return;
        const data = await res.json();
        const updated: GenerationRow = data.generation;
        setter(updated);
        if (updated.status === 'success' || updated.status === 'failed') {
          clearInterval(interval);
          pollers.current.delete(gen.id);
        }
      } catch {
        /* siguiente intento */
      }
    }, 6000);
    pollers.current.set(gen.id, interval);
  }, []);

  useEffect(() => {
    const map = pollers.current;
    return () => {
      map.forEach((i) => clearInterval(i));
      map.clear();
    };
  }, []);

  const buildPlan = async () => {
    setPlanning(true);
    setError(null);
    setPlan(null);
    setImage(null);
    setVideo(null);
    try {
      const res = await fetch('/api/replicate/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis, creativeType, variantNumber: variant, brandId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo armar el plan');
      setPlan(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo armar el plan');
    } finally {
      setPlanning(false);
    }
  };

  const generate = async (kind: 'image' | 'video') => {
    if (!plan) return;
    setLaunching(kind);
    setError(null);
    try {
      const res = await fetch('/api/replicate/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          plan,
          brandId,
          creativeId: creativeId ?? null,
          parentGenerationId: kind === 'video' ? image?.id : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar la generación');
      if (kind === 'image') {
        setVideo(null);
        track(data.generation, setImage);
      } else {
        track(data.generation, setVideo);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar la generación');
    } finally {
      setLaunching(null);
    }
  };

  const est = credits?.estimates ?? { imageUsd: 0.1, videoPerSecondUsd: 0.06 };
  const videoCost = plan ? est.videoPerSecondUsd * plan.duration_seconds : 0;
  const kieMissing = credits !== null && !credits.configured;

  const successGallery = gallery.filter((g) => g.status === 'success' && g.result_url);

  return (
    <section className="rounded-2xl border border-[#f59e0b]/25 bg-gradient-to-br from-[#241a08] to-[#111118]">
      {/* Header / toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-5 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#f97316] flex items-center justify-center">
            <Clapperboard className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#f1f5f9]">Clonar este anuncio con IA</h3>
            <p className="text-xs text-[#94a3b8]">
              Imagen UGC realista + video con voz, generados de tu variante. Tú solo das clic.
            </p>
          </div>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-[#f59e0b] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="px-5 pb-5 space-y-4"
        >
          {/* Saldo Kie */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0d0d14] border border-[#1e1e2e] text-[#cbd5e1]">
              <Wallet className="w-3.5 h-3.5 text-[#f59e0b]" />
              {credits === null
                ? 'Consultando saldo…'
                : kieMissing
                  ? 'Kie.ai sin conectar'
                  : credits.credits === null
                    ? 'Saldo Kie: —'
                    : `Saldo Kie: ${credits.credits} créditos`}
            </span>
            <span className="text-[#64748b]">
              Costos estimados: imagen ≈ {fmtUsd(est.imageUsd)} · video ≈ {fmtUsd(est.videoPerSecondUsd)}/seg
            </span>
          </div>

          {kieMissing && (
            <div className="flex items-start gap-2 rounded-xl border border-[#f59e0b]/25 bg-[#f59e0b]/10 p-3">
              <AlertTriangle className="w-4 h-4 text-[#fbbf24] shrink-0 mt-0.5" />
              <p className="text-xs text-[#fbbf24] leading-relaxed">
                Falta conectar Kie.ai (la plataforma que genera las imágenes y videos). Crea tu
                cuenta en kie.ai, compra créditos y agrega tu API key como <code>KIE_API_KEY</code>.
              </p>
            </div>
          )}

          {/* Paso 1: elegir variante y armar plan */}
          <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4 space-y-3">
            <p className="text-xs font-semibold text-[#f1f5f9] flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-[#f59e0b]" />
              Paso 1 · Elige qué versión quieres producir
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={variant === null ? 'faithful' : String(variant)}
                onChange={(e) =>
                  setVariant(e.target.value === 'faithful' ? null : Number(e.target.value))
                }
                className="flex-1 px-3 py-2.5 rounded-xl bg-[#111118] border border-[#1e1e2e] text-sm text-[#f1f5f9] focus:border-[#f59e0b]/60 focus:outline-none"
              >
                {variantOptions.map((v) => (
                  <option key={v.value === null ? 'faithful' : v.value} value={v.value === null ? 'faithful' : v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
              <button
                onClick={buildPlan}
                disabled={planning}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#f59e0b] to-[#f97316] text-white shadow-lg shadow-orange-500/20 disabled:opacity-60 flex items-center justify-center gap-2 shrink-0"
              >
                {planning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {plan ? 'Rearmar plan' : 'Armar plan (gratis)'}
              </button>
            </div>
          </div>

          {/* Paso 2: plan listo → generar imagen */}
          {plan && (
            <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4 space-y-3">
              <p className="text-xs font-semibold text-[#f1f5f9] flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-[#f59e0b]" />
                Paso 2 · Genera la imagen base — {plan.variant_label}
              </p>
              <p className="text-xs text-[#94a3b8] leading-relaxed">{plan.rationale}</p>
              <div className="rounded-lg bg-[#111118] border border-[#1e1e2e] p-3">
                <p className="text-[10px] uppercase tracking-wide text-[#64748b] mb-1 flex items-center gap-1.5">
                  <MessageSquareText className="w-3 h-3" />
                  Lo que dirá el video ({plan.duration_seconds}s)
                </p>
                <p className="text-sm text-[#e2e8f0] italic">“{plan.spoken_script}”</p>
              </div>

              {!image && (
                <button
                  onClick={() => generate('image')}
                  disabled={launching !== null || kieMissing}
                  className="w-full py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#3b82f6] to-[#6366f1] text-white shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {launching === 'image' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ImageIcon className="w-4 h-4" />
                  )}
                  Generar imagen · ≈ {fmtUsd(est.imageUsd)}
                </button>
              )}

              {image && image.status !== 'success' && image.status !== 'failed' && (
                <div className="flex items-center gap-3 rounded-xl border border-[#3b82f6]/25 bg-[#3b82f6]/5 p-4">
                  <Loader2 className="w-5 h-5 text-[#3b82f6] animate-spin shrink-0" />
                  <p className="text-sm text-[#cbd5e1]">
                    Generando la imagen… tarda 1-2 minutos. Puedes quedarte aquí.
                  </p>
                </div>
              )}

              {image?.status === 'failed' && (
                <div className="rounded-xl border border-[#f43f5e]/25 bg-[#f43f5e]/10 p-3 space-y-2">
                  <p className="text-xs text-[#fb7185]">
                    La imagen falló: {image.error || 'error en Kie'}. No se cobra doble por
                    reintentar desde cero, pero cada intento sí consume créditos.
                  </p>
                  <button
                    onClick={() => generate('image')}
                    className="text-xs px-3 py-1.5 rounded-lg border border-[#f43f5e]/40 text-[#fb7185] flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" /> Reintentar
                  </button>
                </div>
              )}

              {image?.status === 'success' && image.result_url && (
                <div className="space-y-3">
                  <div className="flex gap-4 items-start">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.result_url}
                      alt={plan.variant_label}
                      className="w-40 rounded-xl border border-[#1e1e2e]"
                    />
                    <div className="flex-1 space-y-2">
                      <p className="text-xs text-[#4ade80]">✓ Imagen lista</p>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={image.result_url}
                          download
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs px-3 py-2 rounded-lg border border-[#2e2e42] text-[#cbd5e1] flex items-center gap-1.5 hover:border-[#3b82f6]/50"
                        >
                          <Download className="w-3.5 h-3.5" /> Descargar
                        </a>
                        <button
                          onClick={() => generate('image')}
                          disabled={launching !== null}
                          className="text-xs px-3 py-2 rounded-lg border border-[#2e2e42] text-[#cbd5e1] flex items-center gap-1.5 hover:border-[#3b82f6]/50 disabled:opacity-50"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Otra versión (≈ {fmtUsd(est.imageUsd)})
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Paso 3: animar */}
                  {!video && (
                    <button
                      onClick={() => generate('video')}
                      disabled={launching !== null || kieMissing}
                      className="w-full py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#8b5cf6] to-[#d946ef] text-white shadow-lg shadow-purple-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {launching === 'video' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Film className="w-4 h-4" />
                      )}
                      Paso 3 · Animar con voz ({plan.duration_seconds}s) · ≈ {fmtUsd(videoCost)}
                    </button>
                  )}

                  {video && video.status !== 'success' && video.status !== 'failed' && (
                    <div className="flex items-center gap-3 rounded-xl border border-[#8b5cf6]/25 bg-[#8b5cf6]/5 p-4">
                      <Loader2 className="w-5 h-5 text-[#8b5cf6] animate-spin shrink-0" />
                      <p className="text-sm text-[#cbd5e1]">
                        Generando el video con voz… tarda 3-8 minutos. Puedes salir y volver: quedará
                        guardado aquí abajo.
                      </p>
                    </div>
                  )}

                  {video?.status === 'failed' && (
                    <div className="rounded-xl border border-[#f43f5e]/25 bg-[#f43f5e]/10 p-3 space-y-2">
                      <p className="text-xs text-[#fb7185]">
                        El video falló: {video.error || 'error en Kie'}.
                      </p>
                      <button
                        onClick={() => generate('video')}
                        className="text-xs px-3 py-1.5 rounded-lg border border-[#f43f5e]/40 text-[#fb7185] flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3 h-3" /> Reintentar (≈ {fmtUsd(videoCost)})
                      </button>
                    </div>
                  )}

                  {video?.status === 'success' && video.result_url && (
                    <div className="space-y-2">
                      <p className="text-xs text-[#4ade80]">✓ Tu variante UGC está lista</p>
                      <video
                        src={video.result_url}
                        controls
                        className="w-full max-w-[260px] rounded-xl border border-[#1e1e2e]"
                      />
                      <a
                        href={video.result_url}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex text-xs px-3 py-2 rounded-lg gradient-blue text-white items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" /> Descargar video
                      </a>
                      <p className="text-[11px] text-[#64748b] leading-relaxed">
                        Tip del sistema: para máximo realismo al publicar, expórtalo desde CapCut a
                        24 fps con contraste −7, exposición +3 y motion blur 20%.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Galería de generaciones previas de este creativo */}
          {successGallery.length > 0 && (
            <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4">
              <p className="text-xs font-semibold text-[#f1f5f9] mb-3">
                Generaciones anteriores de este anuncio
              </p>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {successGallery.map((g) =>
                  g.kind === 'video' ? (
                    <video
                      key={g.id}
                      src={g.result_url!}
                      controls
                      className="h-40 rounded-lg border border-[#1e1e2e] shrink-0"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={g.id}
                      src={g.result_url!}
                      alt={g.variant_label ?? 'Generación'}
                      className="h-40 rounded-lg border border-[#1e1e2e] shrink-0"
                    />
                  )
                )}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-[#f43f5e]">{error}</p>}
        </motion.div>
      )}
    </section>
  );
}
