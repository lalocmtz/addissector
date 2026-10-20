'use client';

// "Tengo una idea": se escribe suelta (y opcionalmente con una imagen) y la
// plataforma dice dónde encaja: qué puerta, si es iteración o concepto, para
// qué avatar y trabajo, qué necesidad cubre y el siguiente paso.

import { useRef, useState } from 'react';
import { Loader2, Lightbulb, ImagePlus, ArrowRight, X } from 'lucide-react';
import { type Capa, type Trabajo, type Semilla, type LoteBorrador, TRABAJOS, BORRADOR_VACIO, inputCls, subirImagen } from './comun';

interface Encaje {
  veredicto: 'lanzala' | 'ajustala' | 'despues'; puerta: 'adaptar' | 'guiones' | 'iterar'; tipo: 'iteracion' | 'concepto';
  origen_ad_id: string; capa: Capa | ''; persona_id: string; avatar: string; trabajo: Trabajo; concepto: string;
  necesidad: string; como_encaja: string; ajuste: string; siguiente_paso: string;
}
const VEREDICTO = {
  lanzala: { t: 'Encaja: lánzala', c: 'bg-ok-soft text-ok' },
  ajustala: { t: 'Sirve con un ajuste', c: 'bg-warn-soft text-warn' },
  despues: { t: 'No es prioridad ahora', c: 'bg-surface-2 text-ink-3' },
};
const PUERTA = { adaptar: 'Adaptar referencia', guiones: 'Guiones', iterar: 'Iterar ganador' };

export default function EncajeIdea({ brandId, onPuerta, onManual }: {
  brandId: string;
  onPuerta: (p: 'adaptar' | 'guiones' | 'iterar', s: Semilla) => void;
  onManual: (b: LoteBorrador) => void;
}) {
  const [texto, setTexto] = useState('');
  const [img, setImg] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Encaje | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function encajar() {
    setCargando(true); setError(null); setRes(null);
    try {
      const r = await fetch('/api/lanzar/encaje', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandId, texto, imagenUrl: img || undefined }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Respondió ${r.status}`);
      setRes(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo');
    } finally {
      setCargando(false);
    }
  }

  function seguir() {
    if (!res) return;
    const s: Semilla = { personaId: res.persona_id || undefined, trabajo: res.trabajo, tema: `${res.concepto}${res.ajuste ? `. Ajuste: ${res.ajuste}` : ''}`, nota: texto, referenciaUrl: img || undefined };
    if (res.puerta === 'iterar' && res.origen_ad_id) onPuerta('iterar', { ...s, adId: res.origen_ad_id });
    else onPuerta(res.puerta === 'iterar' ? 'guiones' : res.puerta, s);
  }

  return (
    <div>
      <div className="flex gap-2">
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} className={`${inputCls} h-20`}
          placeholder="Escríbela como te salga: 'un video de alguien en la regadera tallándose el tatuaje y no se quita', 'el estático de reseña de Ridge pero con el pack de pareja'…" />
        <button onClick={() => input.current?.click()} title="Adjuntar imagen" className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-line bg-surface text-ink-3">
          {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-4 w-4" />}
        </button>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          setSubiendo(true);
          void subirImagen(brandId, f, 'referencias').then(setImg).catch((er) => setError(er instanceof Error ? er.message : 'Falló')).finally(() => setSubiendo(false));
        }} />
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {img && <button onClick={() => setImg('')} className="inline-flex items-center gap-1 text-xs text-ink-4"><X className="h-3 w-3" /> quitar imagen</button>}
        <button onClick={() => void encajar()} disabled={cargando || (!texto.trim() && !img)} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50">
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />} ¿Dónde encaja?
        </button>
      </div>
      {error && <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}
      {res && (
        <div className="mt-4 rounded-xl bg-surface p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${VEREDICTO[res.veredicto].c}`}>{VEREDICTO[res.veredicto].t}</span>
            <span className="text-xs text-ink-3">{res.tipo === 'iteracion' ? `Iteración · capa ${res.capa}` : 'Concepto nuevo'} · {res.avatar} · {TRABAJOS[res.trabajo]?.label}</span>
          </div>
          <p className="mt-2 font-medium">{res.concepto}</p>
          <p className="mt-1 text-ink-2">{res.como_encaja}</p>
          <p className="mt-1 text-xs text-ink-3">Cubre: {res.necesidad}</p>
          {res.ajuste && <p className="mt-1 text-xs text-warn">Ajuste: {res.ajuste}</p>}
          <p className="mt-2 text-xs"><span className="text-ink-4">Siguiente paso: </span>{res.siguiente_paso}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={seguir} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent">
              Seguir en {PUERTA[res.puerta]} <ArrowRight className="h-3 w-3" />
            </button>
            <button onClick={() => onManual({
              ...BORRADOR_VACIO, fuente: 'manual', tipo: res.tipo, origenAdId: res.origen_ad_id, capa: res.tipo === 'iteracion' ? res.capa : '',
              personaId: res.persona_id, avatar: res.avatar, trabajo: res.trabajo, concepto: res.concepto, justificacion: res.como_encaja, referencia: img,
            })} className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-ink-2">Armar el lote a mano</button>
          </div>
        </div>
      )}
    </div>
  );
}
