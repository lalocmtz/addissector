'use client';

// Puerta "Adaptar referencia": subes un estático que te gustó (otra marca,
// Trend Track o un ganador), Claude lo desarma con las reglas del Director de
// estáticos y propone 3 variantes; Kie.ai (Nano Banana) genera cada una con
// las fotos REALES de Feel Ink para que no invente el producto.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Upload, Wand2, ImagePlus, ArrowRight, X, RefreshCw, KeyRound } from 'lucide-react';
import {
  type LoteBorrador, type Semilla, type Trabajo, type Capa,
  TRABAJOS, BORRADOR_VACIO, inputCls, labelCls, subirImagen, CopyBtn,
} from './comun';

interface Variante { etiqueta: 'A' | 'B' | 'C'; que_cambia: string; copy_en_imagen: string[]; prompt: string; fotos_usar: number[] }
interface Analisis {
  analisis: { formato: string; para_el_scroll: string; esqueleto: string[]; mecanismo: string; etapa: string; estilo: string; hipotesis: string };
  encaje: { tipo: 'iteracion' | 'concepto'; origen_ad_id: string; capa: Capa | ''; persona_id: string; avatar: string; trabajo: Trabajo; necesidad: string; porque: string };
  adaptacion: { viaja: string[]; se_reemplaza: string[] };
  concepto: string; concepto_corto: string; variantes: Variante[]; textos: string[]; titulares: string[]; bloqueos: string[]; fotos: string[];
}
interface Gen { estado: 'esperando' | 'generando' | 'listo' | 'fallo'; url?: string; error?: string | null; taskId?: string }

const ASPECTOS = ['9:16', '4:5', '1:1'] as const;

export default function Adaptador({ brandId, semilla, onLote }: { brandId: string; semilla: Semilla; onLote: (b: LoteBorrador) => void }) {
  const [ref, setRef] = useState(semilla.referenciaUrl ?? '');
  const [nota, setNota] = useState(semilla.nota ?? '');
  const [fotos, setFotos] = useState<{ path: string; url: string }[]>([]);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [subiendo, setSubiendo] = useState<'ref' | 'foto' | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [res, setRes] = useState<Analisis | null>(null);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [gens, setGens] = useState<Record<number, Gen>>({});
  const [aspect, setAspect] = useState<(typeof ASPECTOS)[number]>('9:16');
  const [usarRef, setUsarRef] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kie, setKie] = useState<{ has_key: boolean; tail: string | null } | null>(null);
  const [kieKey, setKieKey] = useState('');
  const refInput = useRef<HTMLInputElement>(null);
  const fotoInput = useRef<HTMLInputElement>(null);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  const cargarFotos = useCallback(async () => {
    const r = await fetch(`/api/marca/fotos?brand=${brandId}`, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setFotos(j.fotos ?? []);
  }, [brandId]);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      await cargarFotos();
      const r = await fetch(`/api/meta/account?brand=${brandId}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      setKie(j.kie ?? { has_key: false, tail: null });
    });
  }, [brandId, cargarFotos]);

  async function subir(file: File, que: 'ref' | 'foto') {
    setSubiendo(que); setError(null);
    try {
      const url = await subirImagen(brandId, file, que === 'ref' ? 'referencias' : 'marca');
      if (que === 'ref') { setRef(url); setRes(null); setGens({}); }
      else { await cargarFotos(); setElegidas((x) => [...x, url].slice(-6)); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falló la subida');
    } finally {
      setSubiendo(null);
    }
  }

  async function quitarFoto(path: string, url: string) {
    await fetch(`/api/marca/fotos?brand=${brandId}&path=${encodeURIComponent(path)}`, { method: 'DELETE' });
    setElegidas((x) => x.filter((u) => u !== url));
    await cargarFotos();
  }

  async function analizar() {
    setAnalizando(true); setError(null); setRes(null); setGens({});
    try {
      const r = await fetch('/api/estaticos/analizar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, referenciaUrl: ref, fotos: elegidas, nota: nota || undefined, adId: semilla.adId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Respondió ${r.status}`);
      setRes(j); setPrompts((j as Analisis).variantes.map((v) => v.prompt));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo analizar');
    } finally {
      setAnalizando(false);
    }
  }

  async function guardarKie() {
    const r = await fetch('/api/meta/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kieKey: kieKey.trim() }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? 'No se guardó la clave'); return; }
    setKie(j.kie); setKieKey('');
  }

  async function generar(i: number) {
    if (!res) return;
    const v = res.variantes[i];
    const imgs = (v.fotos_usar?.length ? v.fotos_usar.map((k) => res.fotos[k]).filter(Boolean) : res.fotos);
    setGens((g) => ({ ...g, [i]: { estado: 'esperando' } }));
    try {
      const r = await fetch('/api/estaticos/generar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, prompt: prompts[i], imagenes: [...imgs, ...(usarRef ? [ref] : [])], aspect }),
      });
      const j = await r.json();
      if (!r.ok) { if (j.sinClave) setKie({ has_key: false, tail: null }); throw new Error(j.error ?? `Respondió ${r.status}`); }
      const taskId = j.taskId as string;
      for (let n = 0; n < 75 && vivo.current; n++) {
        await new Promise((ok) => setTimeout(ok, 4000));
        const s = await fetch(`/api/estaticos/generar?brand=${brandId}&taskId=${taskId}`, { cache: 'no-store' }).then((x) => x.json());
        if (s.estado === 'listo') { setGens((g) => ({ ...g, [i]: { estado: 'listo', url: s.url, taskId } })); return; }
        if (s.estado === 'fallo' || s.error) { setGens((g) => ({ ...g, [i]: { estado: 'fallo', error: s.error ?? 'Kie.ai no pudo generarla', taskId } })); return; }
        setGens((g) => ({ ...g, [i]: { estado: 'generando', taskId } }));
      }
      setGens((g) => ({ ...g, [i]: { estado: 'fallo', error: 'Tardó demasiado; vuelve a intentar', taskId } }));
    } catch (e) {
      setGens((g) => ({ ...g, [i]: { estado: 'fallo', error: e instanceof Error ? e.message : 'Falló' } }));
    }
  }

  function crearLote() {
    if (!res) return;
    const e = res.encaje;
    onLote({
      ...BORRADOR_VACIO, fuente: 'estatico', formato: 'estatico', referencia: ref,
      tipo: e.tipo, origenAdId: e.origen_ad_id || semilla.adId || '', origenNombre: semilla.adNombre ?? '', capa: e.tipo === 'iteracion' ? e.capa : '',
      personaId: e.persona_id, avatar: e.avatar, trabajo: e.trabajo, concepto: res.concepto, conceptoCorto: res.concepto_corto,
      mensaje: res.analisis.hipotesis,
      ejecuciones: res.variantes.map((v, i) => ({
        hook: v.copy_en_imagen[0] ?? v.que_cambia, guion: v.copy_en_imagen.join(' / '),
        visual: `${v.etiqueta}: ${v.que_cambia}`, imagen: gens[i]?.url ?? '',
      })),
      textos: res.textos.slice(0, 2), titulares: res.titulares.slice(0, 2),
      justificacion: `${e.porque} Cubre: ${e.necesidad}.`,
    });
  }

  const listo = Boolean(ref);
  return (
    <div>
      {semilla.adId && <p className="mb-3 rounded-lg bg-ok-soft px-3 py-2 text-xs text-ok">Iterando el estático: {semilla.adNombre ?? semilla.adId}</p>}
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div>
          <div className={labelCls}>1 · La referencia</div>
          <button onClick={() => refInput.current?.click()} className="mt-1 flex aspect-[4/5] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-line bg-surface text-xs text-ink-3 hover:border-accent">
            {subiendo === 'ref' ? <Loader2 className="h-5 w-5 animate-spin" /> : ref ? <img src={ref} alt="" className="h-full w-full object-contain" /> : <span className="flex flex-col items-center gap-1"><Upload className="h-5 w-5" /> Sube el estático que te gustó</span>}
          </button>
          <input ref={refInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f, 'ref'); e.target.value = ''; }} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <div className={labelCls}>2 · Fotos reales de Feel Ink que debe usar (elige hasta 6)</div>
            <button onClick={() => fotoInput.current?.click()} className="inline-flex items-center gap-1 text-xs text-accent">
              {subiendo === 'foto' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />} Subir fotos
            </button>
            <input ref={fotoInput} type="file" accept="image/*" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); void (async () => { for (const f of fs) await subir(f, 'foto'); })(); e.target.value = ''; }} />
          </div>
          {fotos.length === 0 && <p className="mt-2 rounded-lg bg-warn-soft p-3 text-xs text-warn">Sube tu biblioteca: tatuaje puesto (varias zonas y tonos de piel), packs, empaque, el lápiz. Sin fotos reales la IA inventa el diseño.</p>}
          <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {fotos.map((f) => {
              const on = elegidas.includes(f.url);
              return (
                <div key={f.path} className={`group relative aspect-square overflow-hidden rounded-lg border-2 ${on ? 'border-accent' : 'border-transparent'}`}>
                  <button onClick={() => setElegidas((x) => on ? x.filter((u) => u !== f.url) : [...x, f.url].slice(-6))} className="h-full w-full">
                    <img src={f.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </button>
                  <button onClick={() => void quitarFoto(f.path, f.url)} title="Quitar de la biblioteca" className="absolute right-1 top-1 hidden rounded bg-overlay/70 p-0.5 text-white group-hover:block"><X className="h-3 w-3" /></button>
                </div>
              );
            })}
          </div>
          <div className={`${labelCls} mt-3`}>3 · Qué te gustó o qué quieres (opcional)</div>
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} className={`${inputCls} mt-1 h-14`} placeholder="ej. el layout de reseña con la foto grande; quiero meter el lápiz; para el avatar de los que tienen miedo a las agujas" />
          <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
            <button onClick={() => void analizar()} disabled={!listo || analizando} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50">
              {analizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {analizando ? 'Desarmando la referencia…' : 'Analizar y adaptar'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

      {res && (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-surface p-4 text-xs">
              <h3 className="text-sm font-semibold">Qué es la referencia</h3>
              <dl className="mt-2 space-y-1">
                <div><dt className="inline text-ink-4">Formato: </dt><dd className="inline">{res.analisis.formato}</dd></div>
                <div><dt className="inline text-ink-4">Para el scroll: </dt><dd className="inline">{res.analisis.para_el_scroll}</dd></div>
                <div><dt className="inline text-ink-4">Mecanismo: </dt><dd className="inline">{res.analisis.mecanismo}</dd></div>
                <div><dt className="inline text-ink-4">Etapa · estilo: </dt><dd className="inline">{res.analisis.etapa} · {res.analisis.estilo}</dd></div>
                <div><dt className="inline text-ink-4">Esqueleto: </dt><dd className="inline">{res.analisis.esqueleto.join(' → ')}</dd></div>
                <div><dt className="inline text-ink-4">Hipótesis: </dt><dd className="inline">{res.analisis.hipotesis}</dd></div>
              </dl>
            </div>
            <div className="rounded-xl bg-surface p-4 text-xs">
              <h3 className="text-sm font-semibold">Cómo encaja en Feel Ink</h3>
              <p className="mt-2">{res.encaje.porque}</p>
              <p className="mt-1 text-ink-3">{res.encaje.tipo === 'iteracion' ? `Iteración · capa ${res.encaje.capa}` : 'Concepto nuevo'} · {res.encaje.avatar} · {TRABAJOS[res.encaje.trabajo]?.label} · cubre: {res.encaje.necesidad}</p>
              <p className="mt-2"><span className="text-ink-4">Viaja: </span>{res.adaptacion.viaja.join(' · ')}</p>
              <p className="mt-1"><span className="text-ink-4">Se reemplaza: </span>{res.adaptacion.se_reemplaza.join(' · ')}</p>
              {res.bloqueos.length > 0 && <p className="mt-2 text-warn">Falta dato real: {res.bloqueos.join(' · ')}</p>}
            </div>
          </div>

          {kie && !kie.has_key && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft p-3 text-xs text-warn">
              <KeyRound className="h-4 w-4" /> Para generar imágenes pega tu clave de Kie.ai (kie.ai → API Key):
              <input value={kieKey} onChange={(e) => setKieKey(e.target.value)} className="min-w-64 flex-1 rounded border border-line bg-surface px-2 py-1 text-ink" placeholder="clave de Kie.ai" />
              <button onClick={() => void guardarKie()} className="rounded bg-accent px-3 py-1 font-medium text-on-accent">Guardar</button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-ink-4">Proporción:</span>
            {ASPECTOS.map((a) => <button key={a} onClick={() => setAspect(a)} className={`rounded px-2 py-1 ${aspect === a ? 'bg-accent text-on-accent' : 'bg-surface text-ink-2'}`}>{a}</button>)}
            <label className="ml-2 inline-flex items-center gap-1 text-ink-3" title="Por defecto la referencia NO se manda al modelo de imagen: su composición se describe con palabras, para no copiar caras, marcas o reseñas ajenas.">
              <input type="checkbox" checked={usarRef} onChange={(e) => setUsarRef(e.target.checked)} /> Mandar también la referencia como guía de composición
            </label>
            <button onClick={() => res.variantes.forEach((_, i) => void generar(i))} disabled={!kie?.has_key} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 font-medium text-on-accent disabled:opacity-50">
              <Wand2 className="h-3.5 w-3.5" /> Generar las 3
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {res.variantes.map((v, i) => {
              const g = gens[i];
              return (
                <div key={i} className="flex flex-col rounded-xl bg-surface p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Variante {v.etiqueta}</span>
                    <button onClick={() => void generar(i)} disabled={!kie?.has_key || g?.estado === 'esperando' || g?.estado === 'generando'} className="inline-flex items-center gap-1 text-accent disabled:opacity-50">
                      {g?.estado === 'esperando' || g?.estado === 'generando' ? <Loader2 className="h-3 w-3 animate-spin" /> : g ? <RefreshCw className="h-3 w-3" /> : <Wand2 className="h-3 w-3" />}
                      {g ? (g.estado === 'listo' || g.estado === 'fallo' ? 'Otra vez' : 'Generando…') : 'Generar'}
                    </button>
                  </div>
                  <p className="mt-1 text-ink-3">{v.que_cambia}</p>
                  <div className="mt-2 flex aspect-[9/16] max-h-80 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                    {g?.estado === 'listo' && g.url ? <a href={g.url} target="_blank" rel="noreferrer"><img src={g.url} alt="" className="h-full w-full object-contain" /></a>
                      : g?.estado === 'fallo' ? <span className="p-3 text-danger">{g.error}</span>
                      : g ? <Loader2 className="h-5 w-5 animate-spin text-ink-3" /> : <span className="p-3 text-center text-ink-4">{v.copy_en_imagen.map((c) => `«${c}»`).join(' ')}</span>}
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-ink-4">Prompt (editable)</summary>
                    <textarea value={prompts[i] ?? ''} onChange={(e) => setPrompts((p) => p.map((x, j) => j === i ? e.target.value : x))} className={`${inputCls} mt-1 h-48 font-mono text-[11px]`} />
                    <CopyBtn label="Copiar prompt" text={prompts[i] ?? ''} />
                  </details>
                </div>
              );
            })}
          </div>

          <div className="grid gap-3 text-xs md:grid-cols-2">
            <div className="rounded-xl bg-surface p-3"><div className="text-ink-4">Textos principales</div>{res.textos.map((t, i) => <p key={i} className="mt-1 whitespace-pre-line">{t}</p>)}</div>
            <div className="rounded-xl bg-surface p-3"><div className="text-ink-4">Titulares</div>{res.titulares.map((t, i) => <p key={i} className="mt-1 font-medium">{t}</p>)}</div>
          </div>
          <div className="flex justify-end">
            <button onClick={crearLote} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent">
              Crear lote con estas 3 <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
