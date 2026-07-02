'use client';

// =============================================================================
// AdDNA — Estudio de Clonación (flujo por aprobaciones):
//   Paso 1: elegir variante → plan (gratis)
//   Paso 2: lote de 3 imágenes → APRUEBAS una (o regeneras el lote)
//   Paso 3: revisas/edita el guion, eliges calidad → animar la imagen aprobada
// Nada se genera sin clic explícito y sin ver el costo. Sin fotos del producto
// real, el sistema bloquea el gasto y avisa (foco rojo).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Clapperboard, Loader2, Sparkles, Image as ImageIcon, Film, RefreshCw,
  Download, Wallet, AlertTriangle, ChevronDown, Wand2, Check,
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

type VideoQuality = 'sora_pro' | 'sora' | 'seedance';

interface CreditsInfo {
  configured: boolean;
  credits: number | null;
  estimates: {
    imageUsd: number;
    video: Record<VideoQuality, { per10s: number; per15s: number; label: string }>;
  };
}

const QUALITY_ORDER: VideoQuality[] = ['sora_pro', 'sora', 'seedance'];
const QUALITY_HINT: Record<VideoQuality, string> = {
  sora_pro: 'El realismo del curso. Recomendado para anuncios que vas a pautar.',
  sora: 'Muy buena calidad a bajo costo. Ideal para probar ángulos.',
  seedance: 'Animación económica del frame. Para borradores rápidos.',
};

const fmtUsd = (n: number) => `$${n.toFixed(2)} USD`;
const IMG_BATCH = 3;

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

  const [images, setImages] = useState<GenerationRow[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [launchingImages, setLaunchingImages] = useState(false);

  const [script, setScript] = useState('');
  const [quality, setQuality] = useState<VideoQuality>('sora_pro');
  const [video, setVideo] = useState<GenerationRow | null>(null);
  const [launchingVideo, setLaunchingVideo] = useState(false);

  const [productPhotos, setProductPhotos] = useState<number | null>(null);
  const [allowGeneric, setAllowGeneric] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GenerationRow[]>([]);
  const pollers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const brandId = typeof window !== 'undefined' ? getStoredActiveBrandId() : null;

  // Contexto: saldo, fotos de producto, galería previa
  useEffect(() => {
    if (!open) return;
    fetch('/api/replicate/credits')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCredits(d))
      .catch(() => {});
    if (brandId) {
      fetch(`/api/brands/${brandId}/assets`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setProductPhotos((d?.assets ?? []).length))
        .catch(() => setProductPhotos(null));
    } else {
      setProductPhotos(0);
    }
    if (creativeId) {
      fetch(`/api/replicate/generations?creative=${creativeId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.generations && setGallery(d.generations))
        .catch(() => {});
    }
  }, [open, creativeId, brandId]);

  // Polling genérico de una generación
  const track = useCallback(
    (gen: GenerationRow, apply: (g: GenerationRow) => void) => {
      apply(gen);
      if (gen.status === 'success' || gen.status === 'failed') return;
      const existing = pollers.current.get(gen.id);
      if (existing) clearInterval(existing);
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/replicate/status/${gen.id}`);
          if (!res.ok) return;
          const data = await res.json();
          const updated: GenerationRow = data.generation;
          apply(updated);
          if (updated.status === 'success' || updated.status === 'failed') {
            clearInterval(interval);
            pollers.current.delete(gen.id);
          }
        } catch {
          /* siguiente intento */
        }
      }, 6000);
      pollers.current.set(gen.id, interval);
    },
    []
  );

  useEffect(() => {
    const map = pollers.current;
    return () => {
      map.forEach((i) => clearInterval(i));
      map.clear();
    };
  }, []);

  const applyImageUpdate = useCallback((g: GenerationRow) => {
    setImages((prev) => prev.map((p) => (p.id === g.id ? g : p)));
  }, []);

  // Paso 1 — plan
  const buildPlan = async () => {
    setPlanning(true);
    setError(null);
    setPlan(null);
    setImages([]);
    setSelectedImageId(null);
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
      setScript(data.plan.spoken_script ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo armar el plan');
    } finally {
      setPlanning(false);
    }
  };

  // Paso 2 — lote de imágenes
  const generateImages = async () => {
    if (!plan) return;
    setLaunchingImages(true);
    setError(null);
    setSelectedImageId(null);
    setVideo(null);
    try {
      const res = await fetch('/api/replicate/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'image',
          plan,
          brandId,
          creativeId: creativeId ?? null,
          count: IMG_BATCH,
          allowGenericProduct: allowGeneric,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'no_product_reference') {
          setError(data.error);
        } else {
          throw new Error(data.error || 'No se pudo iniciar la generación');
        }
        return;
      }
      const gens: GenerationRow[] = data.generations;
      setImages(gens);
      gens.forEach((g) => track(g, applyImageUpdate));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar la generación');
    } finally {
      setLaunchingImages(false);
    }
  };

  // Paso 3 — animar la imagen aprobada
  const generateVideo = async () => {
    if (!plan || !selectedImageId) return;
    setLaunchingVideo(true);
    setError(null);
    try {
      const effectivePlan = { ...plan, spoken_script: script };
      // Si el usuario editó el guion, actualiza también el diálogo del motion prompt.
      if (script && plan.spoken_script && script !== plan.spoken_script) {
        effectivePlan.motion_prompt = plan.motion_prompt.includes(plan.spoken_script)
          ? plan.motion_prompt.replace(plan.spoken_script, script)
          : `${plan.motion_prompt}\n\nUpdated dialogue — she says exactly: "${script}"`;
      }
      const res = await fetch('/api/replicate/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'video',
          plan: effectivePlan,
          brandId,
          creativeId: creativeId ?? null,
          parentGenerationId: selectedImageId,
          quality,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar el video');
      track(data.generation, setVideo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el video');
    } finally {
      setLaunchingVideo(false);
    }
  };

  const est = credits?.estimates;
  const imageBatchCost = est ? est.imageUsd * IMG_BATCH : 0.27;
  const dur = plan?.duration_seconds ?? 10;
  const videoCost = (q: VideoQuality) => {
    if (!est) return 0;
    const e = est.video[q];
    return dur <= 10 ? e.per10s : e.per15s;
  };
  const kieMissing = credits !== null && !credits.configured;
  const noProductPhotos = productPhotos === 0;
  const selectedImage = images.find((g) => g.id === selectedImageId);
  const imagesPending = images.some((g) => g.status === 'processing' || g.status === 'pending');
  const successGallery = gallery.filter((g) => g.status === 'success' && g.result_url);

  return (
    <section className="rounded-2xl border border-[#f59e0b]/25 bg-gradient-to-br from-[#241a08] to-[#111118]">
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
              Genera un lote de imágenes, apruebas la mejor y la animamos con voz. Paso por paso.
            </p>
          </div>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-[#f59e0b] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-5 pb-5 space-y-4">
          {/* Saldo */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0d0d14] border border-[#1e1e2e] text-[#cbd5e1]">
              <Wallet className="w-3.5 h-3.5 text-[#f59e0b]" />
              {credits === null
                ? 'Consultando saldo…'
                : kieMissing
                  ? 'Kie.ai sin conectar'
                  : `Saldo Kie: ${credits.credits ?? '—'} créditos`}
            </span>
            <span className="text-[#64748b]">Los costos se muestran antes de cada clic.</span>
          </div>

          {/* FOCO ROJO: producto sin fotos */}
          {noProductPhotos && (
            <div className="rounded-xl border border-[#f43f5e]/30 bg-[#f43f5e]/10 p-4 space-y-2">
              <p className="text-sm text-[#fb7185] font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Sin fotos de tu producto, la IA inventará el empaque
              </p>
              <p className="text-xs text-[#fda4af] leading-relaxed">
                Para que en las imágenes salga TU producto exacto (mismo bote, misma etiqueta),
                sube 1-3 fotos en{' '}
                <Link href="/app/marcas" className="underline font-semibold">
                  Marcas → Fotos de producto
                </Link>{' '}
                y vuelve aquí. Es lo que evita gastar créditos en resultados inservibles.
              </p>
              <label className="flex items-center gap-2 text-xs text-[#fda4af] pt-1">
                <input
                  type="checkbox"
                  checked={allowGeneric}
                  onChange={(e) => setAllowGeneric(e.target.checked)}
                  className="accent-[#f43f5e]"
                />
                Entiendo, quiero generar de todos modos con un producto genérico
              </label>
            </div>
          )}

          {/* Paso 1 */}
          <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4 space-y-3">
            <p className="text-xs font-semibold text-[#f1f5f9] flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-[#f59e0b]" />
              Paso 1 · Elige la versión y arma el plan
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
                  <option
                    key={v.value === null ? 'faithful' : v.value}
                    value={v.value === null ? 'faithful' : v.value}
                  >
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
            {plan && <p className="text-xs text-[#94a3b8] leading-relaxed">{plan.rationale}</p>}
          </div>

          {/* Paso 2 — lote de imágenes con aprobación */}
          {plan && (
            <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4 space-y-3">
              <p className="text-xs font-semibold text-[#f1f5f9] flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-[#f59e0b]" />
                Paso 2 · Genera {IMG_BATCH} opciones y aprueba la mejor
              </p>

              {images.length === 0 ? (
                <button
                  onClick={generateImages}
                  disabled={launchingImages || kieMissing || (noProductPhotos && !allowGeneric)}
                  className="w-full py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#3b82f6] to-[#6366f1] text-white shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {launchingImages ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ImageIcon className="w-4 h-4" />
                  )}
                  Generar {IMG_BATCH} imágenes · ≈ {fmtUsd(imageBatchCost)}
                </button>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    {images.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => g.status === 'success' && setSelectedImageId(g.id)}
                        className={`relative aspect-[9/16] rounded-xl overflow-hidden border-2 transition ${
                          selectedImageId === g.id
                            ? 'border-[#22c55e]'
                            : 'border-[#1e1e2e] hover:border-[#3b82f6]/50'
                        }`}
                      >
                        {g.status === 'success' && g.result_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={g.result_url} alt="Opción" className="w-full h-full object-cover" />
                        ) : g.status === 'failed' ? (
                          <div className="w-full h-full flex items-center justify-center bg-[#111118] text-[#fb7185] text-[10px] p-2 text-center">
                            Falló: {g.error?.slice(0, 60) || 'error'}
                          </div>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[#111118] text-[#64748b]">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span className="text-[10px]">Generando…</span>
                          </div>
                        )}
                        {selectedImageId === g.id && (
                          <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#22c55e] flex items-center justify-center">
                            <Check className="w-4 h-4 text-white" />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={generateImages}
                      disabled={launchingImages || imagesPending}
                      className="text-xs px-3 py-2 rounded-lg border border-[#2e2e42] text-[#cbd5e1] flex items-center gap-1.5 hover:border-[#3b82f6]/50 disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Generar {IMG_BATCH} nuevas · ≈ {fmtUsd(imageBatchCost)}
                    </button>
                    {selectedImage?.result_url && (
                      <a
                        href={selectedImage.result_url}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs px-3 py-2 rounded-lg border border-[#2e2e42] text-[#cbd5e1] flex items-center gap-1.5 hover:border-[#3b82f6]/50"
                      >
                        <Download className="w-3.5 h-3.5" /> Descargar seleccionada
                      </a>
                    )}
                    {!selectedImageId && !imagesPending && (
                      <span className="text-[11px] text-[#94a3b8]">
                        ← Toca la imagen que más te convenza para aprobarla
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Paso 3 — guion + calidad + animar (solo con imagen aprobada) */}
          {plan && selectedImage?.status === 'success' && (
            <div className="rounded-xl border border-[#22c55e]/25 bg-[#0d0d14] p-4 space-y-3">
              <p className="text-xs font-semibold text-[#f1f5f9] flex items-center gap-2">
                <Film className="w-4 h-4 text-[#22c55e]" />
                Paso 3 · Revisa el guion y anima tu imagen aprobada
              </p>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-[#64748b] mb-1">
                  Lo que dirá ({dur}s · puedes editarlo)
                </p>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-xl bg-[#111118] border border-[#1e1e2e] text-sm text-[#e2e8f0] focus:border-[#22c55e]/60 focus:outline-none resize-y"
                />
              </div>

              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Calidad del video</p>
                {est &&
                  QUALITY_ORDER.map((q) => (
                    <label
                      key={q}
                      className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition ${
                        quality === q
                          ? 'border-[#22c55e]/50 bg-[#22c55e]/5'
                          : 'border-[#1e1e2e] hover:border-[#2e2e42]'
                      }`}
                    >
                      <input
                        type="radio"
                        checked={quality === q}
                        onChange={() => setQuality(q)}
                        className="mt-0.5 accent-[#22c55e]"
                      />
                      <span className="flex-1">
                        <span className="text-sm text-[#f1f5f9] font-medium flex items-center justify-between">
                          {est.video[q].label}
                          <span className="text-[#4ade80] font-bold">≈ {fmtUsd(videoCost(q))}</span>
                        </span>
                        <span className="text-[11px] text-[#94a3b8]">{QUALITY_HINT[q]}</span>
                      </span>
                    </label>
                  ))}
              </div>

              {!video && (
                <button
                  onClick={generateVideo}
                  disabled={launchingVideo || kieMissing || !script.trim()}
                  className="w-full py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#22c55e] to-[#10b981] text-white shadow-lg shadow-green-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {launchingVideo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
                  Animar imagen aprobada · ≈ {fmtUsd(videoCost(quality))}
                </button>
              )}

              {video && video.status !== 'success' && video.status !== 'failed' && (
                <div className="flex items-center gap-3 rounded-xl border border-[#22c55e]/25 bg-[#22c55e]/5 p-4">
                  <Loader2 className="w-5 h-5 text-[#4ade80] animate-spin shrink-0" />
                  <p className="text-sm text-[#cbd5e1]">
                    Generando el video… los modelos de máxima calidad tardan 5-15 minutos. Queda
                    guardado en la galería aunque cierres.
                  </p>
                </div>
              )}

              {video?.status === 'failed' && (
                <div className="rounded-xl border border-[#f43f5e]/25 bg-[#f43f5e]/10 p-3 space-y-2">
                  <p className="text-xs text-[#fb7185]">El video falló: {video.error || 'error en Kie'}.</p>
                  <button
                    onClick={() => {
                      setVideo(null);
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-[#f43f5e]/40 text-[#fb7185] flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" /> Ajustar y reintentar
                  </button>
                </div>
              )}

              {video?.status === 'success' && video.result_url && (
                <div className="space-y-2">
                  <p className="text-xs text-[#4ade80]">✓ Tu variante UGC está lista</p>
                  <video
                    src={video.result_url}
                    controls
                    className="w-full max-w-[280px] rounded-xl border border-[#1e1e2e]"
                  />
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={video.result_url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex text-xs px-3 py-2 rounded-lg gradient-blue text-white items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" /> Descargar video
                    </a>
                    <button
                      onClick={() => setVideo(null)}
                      className="text-xs px-3 py-2 rounded-lg border border-[#2e2e42] text-[#cbd5e1] flex items-center gap-1.5 hover:border-[#3b82f6]/50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Otra toma con la misma imagen
                    </button>
                  </div>
                  <p className="text-[11px] text-[#64748b] leading-relaxed">
                    Tip del sistema: al publicar, exporta desde CapCut a 24 fps con contraste −7,
                    exposición +3 y motion blur 20% para máximo realismo.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Galería previa */}
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
