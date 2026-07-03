'use client';

// =============================================================================
// AdDNA — /app/marcas: CRUD de marcas/workspaces (nombre + contexto de marca).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, Plus, Pencil, Trash2, Check, X, ArrowRight, Store, Camera, ImagePlus, FileText,
} from 'lucide-react';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import { useMe, type BrandRow } from '@/lib/use-me';

interface BrandAsset {
  id: string;
  kind: string;
  url: string;
  created_at: string;
}

/** Reduce la foto a 1024px máx y la convierte a JPEG dataURL. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas no disponible'));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

/** Documentos de la marca (PDF/TXT): se destilan con IA y alimentan todos los planners. */
function BrandDocsSection({ brand }: { brand: BrandRow }) {
  const [docs, setDocs] = useState<Array<{ id: string; filename: string; created_at: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch(`/api/brands/${brand.id}/docs`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.docs && setDocs(d.docs))
      .catch(() => {});
  }, [brand.id]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      setError('El archivo supera 8 MB');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const res = await fetch(`/api/brands/${brand.id}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          dataBase64: btoa(binary),
          mime: file.type || 'text/plain',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo procesar');
      setDocs((p) => [data.doc, ...p]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar el documento');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (docId: string) => {
    setDocs((p) => p.filter((d) => d.id !== docId));
    await fetch(`/api/brands/${brand.id}/docs?doc=${docId}`, { method: 'DELETE' });
  };

  return (
    <div className="mt-6 rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5">
      <div className="flex items-center gap-2 mb-1">
        <FileText className="w-4 h-4 text-[#8b5cf6]" />
        <h2 className="text-sm font-semibold">Documentos de contexto · {brand.name}</h2>
      </div>
      <p className="text-xs text-[#94a3b8] mb-4 leading-relaxed">
        Sube PDFs o textos con el contexto de tu marca (brief, avatar, dolores, ofertas, tono).
        La IA los destila y ese contexto alimenta TODO lo creativo: clonaciones, b-roll y planes.
      </p>

      <div className="space-y-2">
        {docs.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-3 rounded-lg bg-[#0a0a0f] border border-[#1e1e2e] px-3 py-2"
          >
            <FileText className="w-4 h-4 text-[#64748b] shrink-0" />
            <span className="flex-1 text-xs text-[#e2e8f0] truncate">{d.filename}</span>
            <span className="text-[10px] text-[#475569]">
              {new Date(d.created_at).toLocaleDateString('es-MX')}
            </span>
            <button
              onClick={() => remove(d.id)}
              className="text-[#475569] hover:text-[#f43f5e]"
              aria-label="Eliminar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-dashed border-[#2e2e42] text-[#94a3b8] hover:text-[#8b5cf6] hover:border-[#8b5cf6]/50 disabled:opacity-50"
      >
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        {uploading ? 'Destilando con IA…' : 'Subir documento (PDF, TXT, MD)'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      {error && <p className="text-xs text-[#f43f5e] mt-2">{error}</p>}
    </div>
  );
}

/** Fotos de producto de la marca activa (referencias para la clonación con IA). */
function BrandAssetsSection({ brand }: { brand: BrandRow }) {
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch(`/api/brands/${brand.id}/assets`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.assets && setAssets(d.assets))
      .catch(() => {});
  }, [brand.id]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch(`/api/brands/${brand.id}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, kind: 'product' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo subir');
      setAssets((prev) => [data.asset, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir la foto');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (asset: BrandAsset) => {
    setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    try {
      await fetch(`/api/brands/${brand.id}/assets?asset=${asset.id}`, { method: 'DELETE' });
    } catch {
      load();
    }
  };

  return (
    <div className="mt-8 rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5">
      <div className="flex items-center gap-2 mb-1">
        <Camera className="w-4 h-4 text-[#f59e0b]" />
        <h2 className="text-sm font-semibold">Fotos de producto · {brand.name}</h2>
      </div>
      <p className="text-xs text-[#94a3b8] mb-4 leading-relaxed">
        Sube 1-3 fotos claras de tu producto (fondo simple, empaque legible). El estudio de
        clonación las usa para que en las imágenes y videos generados salga TU producto exacto,
        no uno inventado.
      </p>

      <div className="flex flex-wrap gap-3">
        {assets.map((a) => (
          <div key={a.id} className="relative group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.url}
              alt="Producto"
              className="w-24 h-24 object-cover rounded-xl border border-[#1e1e2e]"
            />
            <button
              onClick={() => remove(a)}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[#0a0a0f] border border-[#1e1e2e] text-[#94a3b8] hover:text-[#f43f5e] opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
              aria-label="Eliminar foto"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {assets.length < 3 && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-24 h-24 rounded-xl border border-dashed border-[#2e2e42] text-[#64748b] hover:border-[#f59e0b]/50 hover:text-[#f59e0b] transition flex flex-col items-center justify-center gap-1 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <ImagePlus className="w-5 h-5" />
            )}
            <span className="text-[10px]">Subir foto</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      {error && <p className="text-xs text-[#f43f5e] mt-2">{error}</p>}
    </div>
  );
}

interface BrandFormState {
  name: string;
  tone: string;
  palette: string;
  product: string;
}

const emptyForm: BrandFormState = { name: '', tone: '', palette: '', product: '' };

export default function MarcasPage() {
  const { me, loading, refresh, activeBrand, activeBrandId, setActiveBrandId } = useMe();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BrandFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeNeeded, setUpgradeNeeded] = useState(false);

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  };

  const startEdit = (b: BrandRow) => {
    setEditingId(b.id);
    setCreating(false);
    setForm({
      name: b.name,
      tone: b.tone ?? '',
      palette: b.palette ?? '',
      product: b.product ?? '',
    });
    setError(null);
  };

  const cancel = () => {
    setCreating(false);
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setUpgradeNeeded(false);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setError('La marca necesita un nombre.');
      return;
    }
    setSaving(true);
    setError(null);
    setUpgradeNeeded(false);
    try {
      const res = creating
        ? await fetch('/api/brands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
          })
        : await fetch(`/api/brands/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 402) setUpgradeNeeded(true);
        throw new Error(data.error || 'No se pudo guardar la marca');
      }
      if (creating && data.brand?.id) setActiveBrandId(data.brand.id);
      await refresh();
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la marca');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (b: BrandRow) => {
    if (!confirm(`¿Borrar la marca "${b.name}"? Sus creativos quedarán sin marca.`)) return;
    try {
      const res = await fetch(`/api/brands/${b.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo borrar');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar la marca');
    }
  };

  const formFields = (
    <div className="space-y-3">
      <input
        type="text"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Nombre de la marca *"
        className="w-full px-3 py-2.5 rounded-xl bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-[#f1f5f9] placeholder:text-[#475569] focus:border-[#3b82f6]/60 focus:outline-none"
      />
      <input
        type="text"
        value={form.product}
        onChange={(e) => setForm({ ...form, product: e.target.value })}
        placeholder="Producto / oferta (ej. sérum facial de vitamina C, $399 MXN)"
        className="w-full px-3 py-2.5 rounded-xl bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-[#f1f5f9] placeholder:text-[#475569] focus:border-[#3b82f6]/60 focus:outline-none"
      />
      <input
        type="text"
        value={form.tone}
        onChange={(e) => setForm({ ...form, tone: e.target.value })}
        placeholder="Tono (ej. cercano y directo, tuteo, sin tecnicismos)"
        className="w-full px-3 py-2.5 rounded-xl bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-[#f1f5f9] placeholder:text-[#475569] focus:border-[#3b82f6]/60 focus:outline-none"
      />
      <input
        type="text"
        value={form.palette}
        onChange={(e) => setForm({ ...form, palette: e.target.value })}
        placeholder="Paleta / estética (ej. rosa pastel + crema, luz natural, UGC casero)"
        className="w-full px-3 py-2.5 rounded-xl bg-[#0a0a0f] border border-[#1e1e2e] text-sm text-[#f1f5f9] placeholder:text-[#475569] focus:border-[#3b82f6]/60 focus:outline-none"
      />
      {error && <p className="text-xs text-[#f43f5e]">{error}</p>}
      {upgradeNeeded && (
        <Link
          href="/#precios"
          className="inline-flex items-center gap-2 text-sm text-[#3b82f6] hover:underline"
        >
          Ver planes con más marcas
          <ArrowRight className="w-4 h-4" />
        </Link>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold gradient-blue text-white disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Guardar
        </button>
        <button
          onClick={cancel}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-[#94a3b8] border border-[#1e1e2e] hover:text-[#f1f5f9]"
        >
          <X className="w-4 h-4" />
          Cancelar
        </button>
      </div>
    </div>
  );

  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-6 py-8">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Tus marcas</h1>
              <p className="text-sm text-[#64748b] mt-1">
                Cada marca es un espacio: su biblioteca, su contexto y sus variantes.
                {me?.plan?.max_brands
                  ? ` Tu plan incluye ${me.plan.max_brands} marca${me.plan.max_brands === 1 ? '' : 's'}.`
                  : ''}
              </p>
            </div>
            {!creating && (
              <button
                onClick={startCreate}
                className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg gradient-blue text-white font-medium shrink-0"
              >
                <Plus className="w-4 h-4" />
                Nueva marca
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-8 h-8 text-[#3b82f6] animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {creating && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-[#3b82f6]/40 bg-[#111118] p-5"
                >
                  <h3 className="text-sm font-semibold mb-3">Nueva marca</h3>
                  {formFields}
                </motion.div>
              )}

              {(me?.brands ?? []).map((b) => (
                <div
                  key={b.id}
                  className={`rounded-2xl border bg-[#111118] p-5 ${
                    activeBrandId === b.id ? 'border-[#3b82f6]/40' : 'border-[#1e1e2e]'
                  }`}
                >
                  {editingId === b.id ? (
                    <>
                      <h3 className="text-sm font-semibold mb-3">Editar marca</h3>
                      {formFields}
                    </>
                  ) : (
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl gradient-blue flex items-center justify-center text-sm font-bold text-white shrink-0">
                        {b.name[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate">{b.name}</h3>
                          {activeBrandId === b.id && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#3b82f6]/15 text-[#60a5fa] font-medium shrink-0">
                              Activa
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#94a3b8] mt-1 truncate">
                          {b.product || 'Sin producto definido'}
                          {b.tone ? ` · ${b.tone}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {activeBrandId !== b.id && (
                          <button
                            onClick={() => setActiveBrandId(b.id)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-[#1e1e2e] text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[#3b82f6]/50 transition-colors"
                          >
                            Usar
                          </button>
                        )}
                        <button
                          onClick={() => startEdit(b)}
                          className="p-2 rounded-lg text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#1e1e2e]"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => remove(b)}
                          className="p-2 rounded-lg text-[#94a3b8] hover:text-[#f43f5e] hover:bg-[#1e1e2e]"
                          title="Borrar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {(me?.brands ?? []).length === 0 && !creating && (
                <div className="rounded-xl border border-dashed border-[#1e1e2e] bg-[#0d0d14] p-12 text-center">
                  <Store className="w-10 h-10 text-[#334155] mx-auto mb-4" />
                  <p className="text-[#f1f5f9] font-medium">Aún no tienes marcas</p>
                  <button
                    onClick={startCreate}
                    className="mt-4 inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg gradient-blue text-white font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Crear mi primera marca
                  </button>
                </div>
              )}

              {error && !creating && !editingId && (
                <p className="text-xs text-[#f43f5e]">{error}</p>
              )}
            </div>
          )}

          {activeBrand && <BrandAssetsSection brand={activeBrand} />}
          {activeBrand && <BrandDocsSection brand={activeBrand} />}

          <div className="mt-8 rounded-xl border border-[#1e1e2e] bg-[#0d0d14] p-4">
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              💡 El <span className="text-[#f1f5f9]">producto, tono y paleta</span> de la marca se
              usan para que las variantes que genera AdDNA suenen y se vean como tu marca — no
              genéricas.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
