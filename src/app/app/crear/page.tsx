'use client';

// =============================================================================
// AdDNA — "Crear de 0": de una foto de producto + descripción breve a un
// paquete de escenas b-roll de 5s (imagen Nano Banana → animación Seedance).
// Método del curso: clips cortos apilados esconden la IA. Sin voz = barato.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Loader2, Sparkles, Image as ImageIcon, Film, RefreshCw, Download,
  Wallet, AlertTriangle, Clapperboard,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import type { GenerationPlan } from '@/lib/replication-prompts';

interface GenerationRow {
  id: string;
  kind: 'image' | 'video';
  status: 'pending' | 'processing' | 'success' | 'failed';
  result_url: string | null;
  error: string | null;
}

interface SceneState {
  plan: GenerationPlan;
  image: GenerationRow | null;
  video: GenerationRow | null;
  busy: boolean;
}

const IMG_COST = 0.09;
const CLIP_COST = 0.09; // 5s · 720p sin voz

export default function CrearPage() {
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(25); // total; cada escena = 5s
  const [planning, setPlanning] = useState(false);
  const [scenes, setScenes] = useState<SceneState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [productPhotos, setProductPhotos] = useState<number | null>(null);
  const [allowGeneric, setAllowGeneric] = useState(false);
  const pollers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    fetch('/api/replicate/credits')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCredits(d.credits))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeBrandId) return;
    fetch(`/api/brands/${activeBrandId}/assets`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setProductPhotos((d?.assets ?? []).length))
      .catch(() => {});
  }, [activeBrandId]);

  useEffect(() => {
    const map = pollers.current;
    return () => {
      map.forEach((i) => clearInterval(i));
      map.clear();
    };
  }, []);

  const track = useCallback(
    (gen: GenerationRow, sceneIdx: number, field: 'image' | 'video') => {
      const apply = (g: GenerationRow) =>
        setScenes((prev) =>
          prev.map((s, i) => (i === sceneIdx ? { ...s, [field]: g } : s))
        );
      apply(gen);
      if (gen.status === 'success' || gen.status === 'failed') return;
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/replicate/status/${gen.id}`);
          if (!res.ok) return;
          const data = await res.json();
          apply(data.generation);
          if (data.generation.status === 'success' || data.generation.status === 'failed') {
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

  const buildScenes = async () => {
    setPlanning(true);
    setError(null);
    setScenes([]);
    try {
      const res = await fetch('/api/replicate/scratch-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, brandId: activeBrandId, durationSeconds: duration }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudieron crear las escenas');
      setScenes(
        (data.scenes as GenerationPlan[]).map((plan) => ({
          plan,
          image: null,
          video: null,
          busy: false,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron crear las escenas');
    } finally {
      setPlanning(false);
    }
  };

  const generate = async (sceneIdx: number, kind: 'image' | 'video') => {
    const scene = scenes[sceneIdx];
    if (!scene) return;
    setScenes((prev) => prev.map((s, i) => (i === sceneIdx ? { ...s, busy: true } : s)));
    setError(null);
    try {
      const res = await fetch('/api/replicate/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          plan: scene.plan,
          brandId: activeBrandId,
          count: kind === 'image' ? 1 : undefined,
          allowGenericProduct: allowGeneric,
          parentGenerationId: kind === 'video' ? scene.image?.id : undefined,
          quality: kind === 'video' ? 'broll' : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo generar');
        return;
      }
      const gen: GenerationRow = kind === 'image' ? data.generations[0] : data.generation;
      if (kind === 'video') {
        setScenes((prev) => prev.map((s, i) => (i === sceneIdx ? { ...s, video: null } : s)));
      }
      track(gen, sceneIdx, kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar');
    } finally {
      setScenes((prev) => prev.map((s, i) => (i === sceneIdx ? { ...s, busy: false } : s)));
    }
  };

  const noPhotos = productPhotos === 0;

  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-6 py-8">
        <div className="max-w-3xl mx-auto space-y-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Clapperboard className="w-6 h-6 text-[#f59e0b]" />
              B-roll · Cuenta una historia
            </h1>
            <p className="text-sm text-[#64748b] mt-1">
              Describe la HISTORIA de tu anuncio (dolor → descubrimiento → uso → resolución) y el
              sistema la divide en escenas b-roll de 5 segundos con arco narrativo. Generas la
              imagen de cada beat, apruebas y animas. Luego las ensamblas en CapCut sobre tu guion.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0d0d14] border border-[#1e1e2e] text-[#cbd5e1]">
              <Wallet className="w-3.5 h-3.5 text-[#f59e0b]" />
              {credits === null ? 'Saldo…' : `Saldo Kie: ${credits} créditos`}
            </span>
            <span className="text-[#64748b]">
              Imagen ≈ ${IMG_COST.toFixed(2)} · clip de 5s sin voz ≈ ${CLIP_COST.toFixed(2)}
            </span>
          </div>

          {noPhotos && (
            <div className="rounded-xl border border-[#f43f5e]/30 bg-[#f43f5e]/10 p-4 space-y-2">
              <p className="text-sm text-[#fb7185] font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Primero sube fotos de tu producto
              </p>
              <p className="text-xs text-[#fda4af] leading-relaxed">
                Este flujo vive de las fotos reales del producto: son la referencia para que en
                cada escena salga TU empaque exacto. Súbelas en{' '}
                <Link href="/app/marcas" className="underline font-semibold">
                  Marcas → Fotos de producto
                </Link>
                {' '}(1-3 fotos, fondo simple).
              </p>
              <label className="flex items-center gap-2 text-xs text-[#fda4af] pt-1">
                <input
                  type="checkbox"
                  checked={allowGeneric}
                  onChange={(e) => setAllowGeneric(e.target.checked)}
                  className="accent-[#f43f5e]"
                />
                Continuar de todos modos con producto genérico
              </label>
            </div>
          )}

          {/* Paso 1: descripción */}
          <div className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5 space-y-3">
            <p className="text-xs font-semibold text-[#f1f5f9]">
              Paso 1 · Cuenta la historia y elige la duración
            </p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Ej: Historia de una rutina de baño con la crema Skinglow (bote rosa). Una chica normal de 25-30: sale de bañarse con toalla puesta, se ve las manchas de las axilas en el espejo y se frustra… descubre el bote en su tocador, se la aplica con calma, y cierra viéndose segura con los brazos arriba frente al espejo."
              className="w-full px-3 py-2.5 rounded-xl bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-[#e2e8f0] placeholder:text-[#475569] focus:border-[#f59e0b]/60 focus:outline-none resize-y"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Duración total:</span>
              {[15, 25, 30, 45].map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                    duration === d
                      ? 'border-[#f59e0b] text-[#fbbf24] bg-[#f59e0b]/10'
                      : 'border-[#1e1e2e] text-[#94a3b8] hover:border-[#2e2e42]'
                  }`}
                >
                  {d}s · {d / 5} escenas
                </button>
              ))}
            </div>
            <button
              onClick={buildScenes}
              disabled={planning || !description.trim()}
              className="w-full py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#f59e0b] to-[#f97316] text-white shadow-lg shadow-orange-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {planning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {scenes.length ? 'Rearmar escenas (gratis)' : 'Armar escenas (gratis)'}
            </button>
          </div>

          {/* Paso 2: escenas */}
          {scenes.map((scene, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-semibold text-[#f1f5f9]">{scene.plan.variant_label}</p>
                  <p className="text-xs text-[#94a3b8] mt-0.5">{scene.plan.rationale}</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 mt-3">
                {/* Imagen */}
                <div className="w-full sm:w-40 shrink-0">
                  {scene.image?.status === 'success' && scene.image.result_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={scene.image.result_url}
                      alt={scene.plan.variant_label}
                      className="w-full rounded-xl border border-[#1e1e2e]"
                    />
                  ) : (
                    <div className="aspect-[9/16] rounded-xl border border-dashed border-[#2e2e42] flex flex-col items-center justify-center gap-2 text-[#64748b]">
                      {scene.image && scene.image.status === 'processing' ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span className="text-[10px]">Generando…</span>
                        </>
                      ) : scene.image?.status === 'failed' ? (
                        <span className="text-[10px] text-[#fb7185] px-2 text-center">
                          Falló: {scene.image.error?.slice(0, 50)}
                        </span>
                      ) : (
                        <ImageIcon className="w-6 h-6" />
                      )}
                    </div>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex-1 space-y-2">
                  {(!scene.image || scene.image.status === 'failed') && (
                    <button
                      onClick={() => generate(idx, 'image')}
                      disabled={scene.busy || (noPhotos && !allowGeneric)}
                      className="w-full py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#3b82f6] to-[#6366f1] text-white disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {scene.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
                      Generar imagen · ≈ ${IMG_COST.toFixed(2)}
                    </button>
                  )}

                  {scene.image?.status === 'success' && (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => generate(idx, 'image')}
                          disabled={scene.busy}
                          className="text-xs px-3 py-2 rounded-lg border border-[#2e2e42] text-[#cbd5e1] flex items-center gap-1.5 hover:border-[#3b82f6]/50 disabled:opacity-50"
                        >
                          <RefreshCw className="w-3 h-3" /> Otra imagen
                        </button>
                        {!scene.video && (
                          <button
                            onClick={() => generate(idx, 'video')}
                            disabled={scene.busy}
                            className="text-xs px-3 py-2 rounded-lg bg-gradient-to-r from-[#22c55e] to-[#10b981] text-white font-semibold flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <Film className="w-3 h-3" /> Animar 5s · ≈ ${CLIP_COST.toFixed(2)}
                          </button>
                        )}
                      </div>

                      {scene.video && scene.video.status === 'processing' && (
                        <p className="text-xs text-[#94a3b8] flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4ade80]" />
                          Animando… 2-5 minutos. Puedes seguir con otras escenas.
                        </p>
                      )}
                      {scene.video?.status === 'failed' && (
                        <p className="text-xs text-[#fb7185]">
                          Falló: {scene.video.error?.slice(0, 80)}{' '}
                          <button onClick={() => generate(idx, 'video')} className="underline">
                            Reintentar
                          </button>
                        </p>
                      )}
                      {scene.video?.status === 'success' && scene.video.result_url && (
                        <div className="space-y-2">
                          <video
                            src={scene.video.result_url}
                            controls
                            className="w-full max-w-[200px] rounded-xl border border-[#1e1e2e]"
                          />
                          <a
                            href={scene.video.result_url}
                            download
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex text-xs px-3 py-2 rounded-lg gradient-blue text-white items-center gap-1.5"
                          >
                            <Download className="w-3.5 h-3.5" /> Descargar clip
                          </a>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          ))}

          {scenes.some((s) => s.video?.status === 'success') && (
            <div className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4">
              <p className="text-xs text-[#94a3b8] leading-relaxed">
                🎬 <span className="text-[#f1f5f9] font-medium">Armado final (receta del curso):</span>{' '}
                junta los clips en CapCut sobre el audio viral que quieras, acelera ligeramente los
                clips (salen lentos por diseño), exporta a 24 fps con contraste −7, exposición +3,
                motion blur 20% y partículas 10%.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-[#f43f5e]">{error}</p>}
        </div>
      </section>
    </main>
  );
}
