'use client';

// El lote ya armado (por una puerta o a mano). Se revisa, se ajusta y se crea.
// 1 concepto × 1 avatar × 1 trabajo, 3 a 6 ejecuciones, 2 textos y 2 titulares.

import { useMemo, useState } from 'react';
import { Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import {
  type LoteBorrador, type Persona, type Trabajo, type Formato, type Capa,
  TRABAJOS, CAPAS, EJEC_VACIA, etiqueta, inputCls, labelCls, Chip,
} from './comun';

export default function LoteEditor({ brandId, prefijo, personas, inicial, targetCpa, onCerrar, onCreado }: {
  brandId: string; prefijo: string; personas: Persona[]; inicial: LoteBorrador; targetCpa: number | null;
  onCerrar: () => void; onCreado: (code: string, lote: string) => void;
}) {
  const [f, setF] = useState<LoteBorrador>(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof LoteBorrador>(k: K, v: LoteBorrador[K]) => setF((x) => ({ ...x, [k]: v }));

  const avatar = personas.find((p) => p.id === f.personaId)?.name || f.avatar || '';
  const nombre = `${prefijo}-### | ${etiqueta(avatar || 'GENERAL', 16)} | ${etiqueta(f.conceptoCorto || f.concepto || 'CONCEPTO')} | ${f.trabajo ? TRABAJOS[f.trabajo].corto.toUpperCase() : 'TRABAJO'}`;
  const hipotesis = useMemo(() => {
    const cpa = targetCpa ? Math.round(targetCpa) : 'el objetivo';
    const que = f.tipo === 'iteracion' && f.capa ? `cambiar ${CAPAS[f.capa].split(':')[0].toLowerCase()} de "${f.origenNombre}"` : `el concepto "${f.concepto || '[concepto]'}"`;
    return `Para ${avatar || '[avatar]'}, ${que} va a traer compras a CPA de ${cpa} o menos${f.objecion ? ` porque responde "${f.objecion}"` : ''}. Si pierde, el problema es el concepto, no el producto.`;
  }, [f, avatar, targetCpa]);

  async function crear() {
    setGuardando(true); setError(null);
    try {
      const r = await fetch('/api/lanzar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, ...f, avatar, hipotesis: f.hipotesis || hipotesis }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Respondió ${r.status}`);
      onCreado(j.code, j.lote);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear');
    } finally {
      setGuardando(false);
    }
  }

  const ej = f.ejecuciones;
  return (
    <section className="mt-6 rounded-xl border border-accent-strong bg-surface-2 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-ink-3">{f.tipo === 'iteracion' ? `Iteración de ${f.origenNombre || 'un ganador'}` : 'Concepto nuevo'} · revisa y crea</div>
          <div className="mt-1 truncate font-mono text-sm font-semibold" title={nombre}>{nombre}</div>
          <div className="text-xs text-ink-4">Así se llamará el conjunto en Meta. Anuncios: {prefijo}-###-A1 … A{ej.length}</div>
        </div>
        <button onClick={onCerrar} className="text-ink-3 hover:text-ink"><X className="h-5 w-5" /></button>
      </div>

      {f.justificacion && <p className="mt-3 rounded-lg bg-surface p-3 text-xs text-ink-2"><span className="font-medium">Por qué: </span>{f.justificacion}</p>}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className={labelCls}>Avatar</div>
          <select value={f.personaId} onChange={(e) => { set('personaId', e.target.value); set('avatar', ''); }} className={`${inputCls} mt-1`}>
            <option value="">{f.avatar ? `"${f.avatar}" (escrito)` : 'Elige un avatar'}</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <div className={labelCls}>Concepto · y cómo se llama en el conjunto</div>
          <div className="mt-1 flex gap-2">
            <input value={f.concepto} onChange={(e) => set('concepto', e.target.value)} className={inputCls} placeholder="El concepto en una frase" />
            <input value={f.conceptoCorto} onChange={(e) => set('conceptoCorto', e.target.value)} className={`${inputCls} w-40`} placeholder="vs calcomanía" />
          </div>
        </div>
        <div>
          <div className={labelCls}>Trabajo (anillo)</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {(Object.keys(TRABAJOS) as Trabajo[]).map((t) => <Chip key={t} activo={f.trabajo === t} title={TRABAJOS[t].ayuda} onClick={() => set('trabajo', t)}>{TRABAJOS[t].label}</Chip>)}
          </div>
        </div>
        <div>
          <div className={labelCls}>Formato</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {(['video', 'estatico'] as Formato[]).map((x) => <Chip key={x} activo={f.formato === x} onClick={() => set('formato', x)}>{x === 'video' ? 'Video' : 'Estático'}</Chip>)}
          </div>
        </div>
        <div className="md:col-span-2">
          <div className={labelCls}>Tipo</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Chip activo={f.tipo === 'concepto'} onClick={() => set('tipo', 'concepto')}>Concepto nuevo</Chip>
            <Chip activo={f.tipo === 'iteracion'} onClick={() => set('tipo', 'iteracion')}>Iteración</Chip>
            {f.tipo === 'iteracion' && <span className="mx-1 text-xs text-ink-4">capa que cambia:</span>}
            {f.tipo === 'iteracion' && (Object.keys(CAPAS) as Capa[]).map((c) => <Chip key={c} activo={f.capa === c} title={CAPAS[c]} onClick={() => set('capa', c)}>{CAPAS[c].split(':')[0]}</Chip>)}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <div className={labelCls}>Ejecuciones · {ej.length} anuncios (3 a 6). Cambia cómo se ve, no lo que significa.</div>
          {ej.length < 6 && <button onClick={() => set('ejecuciones', [...ej, EJEC_VACIA])} className="inline-flex items-center gap-1 text-xs text-accent"><Plus className="h-3 w-3" /> Agregar</button>}
        </div>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          {ej.map((e, i) => (
            <div key={i} className="rounded-lg bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-ink-3">A{i + 1}</span>
                {ej.length > 3 && <button onClick={() => set('ejecuciones', ej.filter((_, j) => j !== i))} className="text-ink-4 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
              {e.imagen && <img src={e.imagen} alt="" className="mt-2 max-h-48 w-full rounded object-contain" />}
              <input value={e.hook} onChange={(ev) => set('ejecuciones', ej.map((x, j) => j === i ? { ...x, hook: ev.target.value } : x))}
                className={`${inputCls} mt-2`} placeholder="Hook o titular de la imagen" />
              <textarea value={e.guion} onChange={(ev) => set('ejecuciones', ej.map((x, j) => j === i ? { ...x, guion: ev.target.value } : x))}
                className={`${inputCls} mt-2 h-24 text-xs`} placeholder="Guion / copy de la imagen" />
              <input value={e.visual} onChange={(ev) => set('ejecuciones', ej.map((x, j) => j === i ? { ...x, visual: ev.target.value } : x))}
                className={`${inputCls} mt-2 text-xs`} placeholder="Qué se ve / quién sale" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <div className={labelCls}>2 textos principales (van en todos los anuncios)</div>
          {f.textos.map((t, i) => <textarea key={i} value={t} onChange={(e) => set('textos', f.textos.map((x, j) => j === i ? e.target.value : x))} className={`${inputCls} mt-1 h-20 text-xs`} placeholder={i === 0 ? 'Amplio / historia' : 'Directo'} />)}
        </div>
        <div>
          <div className={labelCls}>2 titulares muy distintos</div>
          {f.titulares.map((t, i) => <input key={i} value={t} onChange={(e) => set('titulares', f.titulares.map((x, j) => j === i ? e.target.value : x))} className={`${inputCls} mt-1`} placeholder={`Titular ${i + 1}`} />)}
          <div className={`${labelCls} mt-3`}>Hipótesis</div>
          <textarea value={f.hipotesis || hipotesis} onChange={(e) => set('hipotesis', e.target.value)} className={`${inputCls} mt-1 h-20 text-xs`} />
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCerrar} className="rounded-lg px-4 py-2 text-sm text-ink-3">Cancelar</button>
        <button onClick={() => void crear()} disabled={guardando} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50">
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Crear lote
        </button>
      </div>
    </section>
  );
}
