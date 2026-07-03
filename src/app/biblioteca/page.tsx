'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, Film, Image as ImageIcon, Trash2, Library, Plus } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';

interface CreativeCard {
  id: string;
  name: string;
  type: 'video' | 'image';
  preview_url: string | null;
  created_at: string;
  product: string | null;
  video_type: string | null;
  hook_score: number | null;
  brand_id: string | null;
}

export default function BibliotecaPage() {
  const router = useRouter();
  const { me, activeBrand, activeBrandId, setActiveBrandId } = useMe();
  const [items, setItems] = useState<CreativeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = activeBrandId ? `?brand=${activeBrandId}` : '';
      const res = await fetch(`/api/creatives${qs}`);
      const data = await res.json();
      setConfigured(data.configured !== false);
      setItems(Array.isArray(data.creatives) ? data.creatives : []);
      if (data.error) setError(data.error);
    } catch {
      setError('No se pudo cargar la biblioteca.');
    } finally {
      setLoading(false);
    }
  }, [activeBrandId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar este creativo de la biblioteca?')) return;
    setItems((prev) => prev.filter((c) => c.id !== id));
    try {
      await fetch(`/api/creatives/${id}`, { method: 'DELETE' });
    } catch {
      load();
    }
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold font-[family-name:var(--font-mono)] tracking-tight">
                Biblioteca{activeBrand ? ` · ${activeBrand.name}` : ''}
              </h1>
              <p className="text-sm text-[#64748b] mt-1">
                Los creativos analizados de esta marca, guardados y listos para reabrir.
              </p>
            </div>
            <button
              onClick={() => router.push('/studio')}
              className="hidden sm:flex items-center gap-2 text-sm px-4 py-2 rounded-lg gradient-blue text-white font-medium"
            >
              <Plus className="w-4 h-4" />
              Analizar nuevo
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-8 h-8 text-[#3b82f6] animate-spin" />
            </div>
          ) : !configured ? (
            <div className="rounded-xl border border-[#1e1e2e] bg-[#12121a] p-8 text-center">
              <p className="text-[#f1f5f9] font-medium">La biblioteca aún no está conectada</p>
              <p className="text-sm text-[#64748b] mt-2">
                Falta configurar Supabase (variables de entorno). Una vez configurado, tus análisis se
                guardarán aquí automáticamente.
              </p>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#1e1e2e] bg-[#0d0d14] p-12 text-center">
              <Library className="w-10 h-10 text-[#334155] mx-auto mb-4" />
              <p className="text-[#f1f5f9] font-medium">
                {activeBrand
                  ? `Aún no tienes creativos analizados para ${activeBrand.name}`
                  : 'Aún no tienes creativos guardados'}
              </p>
              <p className="text-sm text-[#64748b] mt-2">
                Analiza tu primer creativo ganador y aparecerá aquí con su vista previa.
              </p>
              <button
                onClick={() => router.push('/studio')}
                className="mt-6 inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg gradient-blue text-white font-medium"
              >
                <Plus className="w-4 h-4" />
                Analizar creativo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {items.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.4) }}
                  onClick={() => router.push(`${c.type === 'image' ? '/analyze-image' : '/analyze'}?id=${c.id}`)}
                  className="group cursor-pointer rounded-xl border border-[#1e1e2e] bg-[#12121a] overflow-hidden hover:border-[#3b82f6]/60 transition-colors"
                >
                  <div className="relative aspect-[9/16] bg-[#0a0a0f] overflow-hidden">
                    {c.preview_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.preview_url}
                        alt={c.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#334155]">
                        {c.type === 'image' ? <ImageIcon className="w-8 h-8" /> : <Film className="w-8 h-8" />}
                      </div>
                    )}
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 backdrop-blur text-[10px] font-medium text-[#cbd5e1]">
                      {c.type === 'image' ? <ImageIcon className="w-3 h-3" /> : <Film className="w-3 h-3" />}
                      {c.type === 'image' ? 'Imagen' : 'Video'}
                    </div>
                    {typeof c.hook_score === 'number' && (
                      <div className={`absolute top-2 right-2 px-2 py-1 rounded-md text-[10px] font-bold text-white ${c.type === 'image' ? 'bg-[#8b5cf6]/80' : 'bg-[#3b82f6]/80'}`}>
                        {c.type === 'image' ? 'Score' : 'Hook'} {c.hook_score}/10
                      </div>
                    )}
                    <button
                      onClick={(e) => handleDelete(e, c.id)}
                      className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/60 text-[#94a3b8] opacity-0 group-hover:opacity-100 hover:text-red-400 transition"
                      aria-label="Eliminar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-[#f1f5f9] truncate" title={c.name}>
                      {c.name}
                    </p>
                    <p className="text-xs text-[#64748b] truncate mt-0.5">
                      {c.product || c.video_type || 'Creativo'}
                    </p>
                    <p className="text-[10px] text-[#475569] mt-1 font-[family-name:var(--font-mono)]">
                      {fmtDate(c.created_at)}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {error && configured && (
            <p className="text-xs text-red-400/80 mt-6">{error}</p>
          )}

          {/* Generaciones IA de esta marca */}
          <GenerationsGallery brandId={activeBrandId} />
        </div>
      </section>
    </main>
  );
}

/** Galería de imágenes y videos generados con IA (estudio de clonación / b-roll). */
function GenerationsGallery({ brandId }: { brandId: string | null }) {
  const [gens, setGens] = useState<
    Array<{ id: string; kind: string; result_url: string | null; variant_label: string | null; status: string; created_at: string }>
  >([]);

  useEffect(() => {
    const qs = brandId ? `?brand=${brandId}` : '';
    fetch(`/api/replicate/generations${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.generations && setGens(d.generations.filter((g: { status: string; result_url: string | null }) => g.status === 'success' && g.result_url)))
      .catch(() => {});
  }, [brandId]);

  if (gens.length === 0) return null;

  return (
    <div className="mt-12">
      <h2 className="text-lg font-bold font-[family-name:var(--font-mono)] tracking-tight mb-1">
        Generaciones con IA
      </h2>
      <p className="text-sm text-[#64748b] mb-5">
        Imágenes y clips creados en el estudio de clonación y B-roll.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {gens.map((g) => (
          <div key={g.id} className="rounded-xl border border-[#1e1e2e] bg-[#12121a] overflow-hidden">
            {g.kind === 'video' ? (
              <video src={g.result_url!} controls className="w-full aspect-[9/16] object-cover bg-black" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={g.result_url!} alt={g.variant_label ?? 'Generación'} className="w-full aspect-[9/16] object-cover" />
            )}
            <div className="p-2.5">
              <p className="text-xs text-[#cbd5e1] truncate">{g.variant_label || (g.kind === 'video' ? 'Video' : 'Imagen')}</p>
              <p className="text-[10px] text-[#475569] mt-0.5">
                {new Date(g.created_at).toLocaleDateString('es-MX')}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
