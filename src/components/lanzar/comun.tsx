'use client';

// Tipos, constantes y piezas chicas que comparten las partes de /lanzar.

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase-browser';

export type Etapa = 'idea' | 'produccion' | 'prueba' | 'decidido';
export type Trabajo = 'atencion' | 'valor' | 'confianza';
export type Formato = 'video' | 'estatico';
export type Capa = 'mensaje' | 'mecanismo' | 'avatar' | 'educacion' | 'oferta' | 'visual';
export type Puerta = 'idea' | 'adaptar' | 'guiones' | 'iterar';

export interface Persona { id: string; name: string; callout?: string | null }

export const TRABAJOS: Record<Trabajo, { label: string; corto: string; ayuda: string }> = {
  atencion: { label: 'Captar atención', corto: 'Atención', ayuda: 'Gente nueva: frecuencia diaria < 1.15 y CPM bajo.' },
  valor: { label: 'Aclarar el valor', corto: 'Valor', ayuda: 'Ya le interesa; falta entender. Frecuencia 1.15–1.25.' },
  confianza: { label: 'Convertir confianza', corto: 'Confianza', ayuda: 'Ya casi compra. Frecuencia > 1.25, CPA bajo.' },
};
export const CAPAS: Record<Capa, string> = {
  mensaje: 'Mensaje: otro hook, titular o emoción',
  mecanismo: 'Mecanismo: explicar distinto por qué se ve real',
  avatar: 'Avatar: el mismo anuncio a otro avatar',
  educacion: 'Educación: atacar otra objeción',
  oferta: 'Oferta: pack, garantía, regalo, urgencia real',
  visual: 'Visual: otro creador, escena o ritmo',
};

export interface EjecBorrador { hook: string; guion: string; visual: string; imagen: string }
export interface LoteBorrador {
  fuente: 'manual' | 'guion' | 'estatico' | 'iterar';
  tipo: 'concepto' | 'iteracion'; origenAdId: string; origenNombre: string; capa: Capa | '';
  personaId: string; avatar: string; angulo: string; trabajo: Trabajo | ''; concepto: string; conceptoCorto: string;
  mensaje: string; objecion: string; formato: Formato | ''; talento: string;
  ejecuciones: EjecBorrador[]; textos: string[]; titulares: string[]; hipotesis: string; justificacion: string; referencia: string;
}
export const EJEC_VACIA: EjecBorrador = { hook: '', guion: '', visual: '', imagen: '' };
export const BORRADOR_VACIO: LoteBorrador = {
  fuente: 'manual', tipo: 'concepto', origenAdId: '', origenNombre: '', capa: '', personaId: '', avatar: '', angulo: '', trabajo: '',
  concepto: '', conceptoCorto: '', mensaje: '', objecion: '', formato: '', talento: '',
  ejecuciones: [EJEC_VACIA, EJEC_VACIA, EJEC_VACIA], textos: ['', ''], titulares: ['', ''], hipotesis: '', justificacion: '', referencia: '',
};

/** Lo que una puerta recibe para arrancar ya armada. */
export interface Semilla { adId?: string; adNombre?: string; personaId?: string; trabajo?: Trabajo; tema?: string; referenciaUrl?: string; nota?: string; enfoque?: 'auto' | 'iterar' | 'explorar' }

export interface Ganador {
  ad_id: string; nombre: string | null; luz: string; thumbnail_url: string | null; kind: string | null;
  roas14: number | null; roasIncr14: number | null; hook14: number | null; gasto14: number; cayendo: boolean; analizado: boolean;
}

export const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-MX')}`);
export const num = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));
export const inputCls = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent';
export const labelCls = 'text-xs font-medium text-ink-3';

/** Igual que src/lib/lote.ts (el servidor manda el nombre final). */
export function etiqueta(t: string, max = 22): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'X';
}

/** Sube una imagen al bucket de la marca y regresa su URL pública. */
export async function subirImagen(brandId: string, file: File, folder: string): Promise<string> {
  const r = await fetch('/api/canvas/upload-url', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brandId, filename: file.name, folder }),
  });
  const j = (await r.json()) as { path?: string; token?: string; url?: string; error?: string };
  if (!r.ok || !j.path || !j.token || !j.url) throw new Error(j.error ?? 'No se pudo preparar la subida');
  const up = await createBrowserClient().storage.from('brand-assets').uploadToSignedUrl(j.path, j.token, file, { contentType: file.type || undefined });
  if (up.error) throw new Error(up.error.message);
  return j.url;
}

export function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" title="Copiar" onClick={() => { void navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}
      className="inline-flex max-w-full items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-left font-mono text-[11px] text-ink-2 hover:text-ink">
      {ok ? <Check className="h-3 w-3 shrink-0 text-ok" /> : <Copy className="h-3 w-3 shrink-0" />} <span className="truncate">{label ?? text}</span>
    </button>
  );
}

export function Chip({ activo, onClick, children, title }: { activo: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" title={title} onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs ${activo ? 'bg-accent text-on-accent' : 'bg-surface text-ink-2 hover:text-ink'}`}>{children}</button>
  );
}
