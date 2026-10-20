'use client';

// =============================================================================
// Cerebro → "Qué funciona". Lo que está ganando en 7, 15 y 30 días con su hook
// verbal, hook visual, texto en pantalla, estructura, guion y receta (todo lo
// que el barrido extrajo de cada creativo), y el archivo semanal para el
// proyecto de Claude: cada martes se genera solo; aquí también a mano.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Copy, CheckCircle2, Download, Wand2, AlertTriangle, ChevronDown, ChevronRight, FileText } from 'lucide-react';

interface Pieza {
  ad_id: string; nombre: string; formato: 'video' | 'estatico' | null;
  gasto: number; compras: number | null; roas: number | null; roasIncr: number | null; cpa: number | null;
  hookRate: number | null; holdRate: number | null; frecuencia: number | null; rol: string | null;
  analizado: boolean; thumbnail: string | null;
  hookVerbal: string | null; hookVisual: string | null; textoPantalla: string | null; tipoHook: string | null;
  estructura: string | null; desarrollo: string | null; guion: string | null; cta: string | null;
  titular: string | null; copyImagen: string | null; composicion: string | null; anguloCopy: string | null;
  receta: string[]; conservar: string[]; veredicto: string | null;
}
interface Ventana {
  dias: number; desde: string; hasta: string; gasto: number; ingreso: number; roas: number | null; roasIncr: number | null;
  ganadores: number; perdedores: number; analizados: number; piezasGanadoras: Pieza[]; piezasPerdedoras: Pieza[]; prompt: string;
}
interface Semanal { nombre: string; fecha: string | null; url: string }
interface Data { marca: string; currency: string | null; anchor: string; ventanas: Ventana[]; semanales: Semanal[]; economics: { breakeven: number; target: number } }

const r2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(2));
const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-MX')}`);

async function descargar(url: string, nombre: string) {
  const r = await fetch(url, { cache: 'no-store' });
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([blob], { type: 'text/markdown' }));
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function Ficha({ p }: { p: Pieza }) {
  const [guion, setGuion] = useState(false);
  return (
    <article className="flex gap-3 rounded-xl border border-line bg-surface p-3 text-xs">
      <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.thumbnail && <img src={p.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="truncate text-sm font-medium text-ink" title={p.nombre}>{p.nombre}</div>
          <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">{p.formato === 'estatico' ? 'Estático' : p.formato === 'video' ? 'Video' : '—'}</span>
        </div>
        <div className="font-[family-name:var(--font-mono)] tabular-nums text-[11px] text-ink-3">
          <span className="text-ok">ROAS {r2(p.roas)}</span>{p.roasIncr != null ? ` · incr ${r2(p.roasIncr)}` : ''} · {money(p.gasto)} · {p.compras ?? 0} compras
          {p.hookRate != null ? ` · hook ${p.hookRate.toFixed(0)}%` : ''}{p.frecuencia != null ? ` · frec ${r2(p.frecuencia)}${p.rol ? ` (${p.rol})` : ''}` : ''}
        </div>
        {!p.analizado && <p className="text-warn">Sin análisis: no entró al barrido. Solo hay números.</p>}
        {p.formato === 'estatico' ? (
          <>
            {p.titular && <p><span className="text-ink-4">Titular: </span><span className="font-medium">“{p.titular}”</span></p>}
            {p.copyImagen && <p><span className="text-ink-4">Copy: </span>{p.copyImagen}</p>}
            {p.composicion && <p><span className="text-ink-4">Composición: </span>{p.composicion}</p>}
          </>
        ) : (
          <>
            {p.hookVerbal && <p><span className="text-ink-4">Hook verbal{p.tipoHook ? ` (${p.tipoHook})` : ''}: </span><span className="font-medium">“{p.hookVerbal}”</span></p>}
            {p.hookVisual && <p><span className="text-ink-4">Hook visual: </span>{p.hookVisual}</p>}
            {p.textoPantalla && <p><span className="text-ink-4">Texto en pantalla: </span>“{p.textoPantalla}”</p>}
            {p.estructura && <p><span className="text-ink-4">Estructura: </span>{p.estructura}</p>}
          </>
        )}
        {p.receta.length > 0 && <p><span className="text-ink-4">Por qué funciona: </span>{p.receta.join(' · ')}</p>}
        {p.guion && (
          <button onClick={() => setGuion((x) => !x)} className="flex items-center gap-1 text-[11px] text-ink-4 hover:text-ink-2">
            {guion ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Guion
          </button>
        )}
        {guion && p.guion && <p className="rounded bg-canvas p-2 text-ink-2">{p.guion}</p>}
      </div>
    </article>
  );
}

export default function CerebroQueFunciona({ brandId }: { brandId: string | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dias, setDias] = useState(7);
  const [copiado, setCopiado] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [gen, setGen] = useState<{ url: string; path: string; sintesis: string | null; markdown: string; aviso: string | null } | null>(null);

  const cargar = useCallback(async () => {
    if (!brandId) { setData(null); setCargando(false); return; }
    setCargando(true); setError(null);
    try {
      const r = await fetch(`/api/brain/digest?brand=${brandId}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Respondió ${r.status}`);
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    } finally {
      setCargando(false);
    }
  }, [brandId]);
  useEffect(() => { void Promise.resolve().then(cargar); }, [cargar]);

  async function generar() {
    if (!brandId) return;
    setGenerando(true); setError(null);
    try {
      const r = await fetch('/api/brain/digest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandId }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Respondió ${r.status}`);
      setGen(j);
      void cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar');
    } finally {
      setGenerando(false);
    }
  }

  const v = data?.ventanas.find((x) => x.dias === dias) ?? null;
  const nombreArchivo = (path: string) => path.split('/').pop() ?? 'cerebro.md';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Qué está funcionando</h2>
          <p className="text-xs text-ink-4">Ganadores y perdedores con su hook verbal, hook visual, guion y receta. Cada martes se genera solo el archivo para tu proyecto de Claude.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-line">
            {[7, 15, 30].map((d) => (
              <button key={d} onClick={() => setDias(d)} className={`px-2.5 py-1.5 text-xs ${dias === d ? 'bg-surface-2 font-medium text-ink' : 'text-ink-3 hover:text-ink'}`}>{d} días</button>
            ))}
          </div>
          <button disabled={!v} onClick={() => { if (v) { void navigator.clipboard.writeText(v.prompt); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } }}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-ink-2 disabled:opacity-50">
            {copiado ? <CheckCircle2 className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />} {copiado ? 'Copiado' : `Copiar ${dias} días`}
          </button>
          <button onClick={() => void generar()} disabled={generando || !brandId} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-on-accent disabled:opacity-50">
            {generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} {generando ? 'Claude está leyendo…' : 'Generar archivo de hoy'}
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

      {gen && (
        <div className="mb-5 rounded-xl border border-accent bg-surface p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-ink">Archivo listo: {nombreArchivo(gen.path)}</p>
            <div className="flex gap-2">
              <button onClick={() => void descargar(gen.url, nombreArchivo(gen.path))} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent"><Download className="h-3.5 w-3.5" /> Descargar .md</button>
              <button onClick={() => void navigator.clipboard.writeText(gen.markdown)} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2"><Copy className="h-3.5 w-3.5" /> Copiar todo</button>
            </div>
          </div>
          <p className="mt-1 text-xs text-ink-4">Súbelo a Contexto del proyecto Creative Feel ink y borra el de la semana anterior.</p>
          {gen.aviso && <p className="mt-2 text-xs text-warn">{gen.aviso}</p>}
          {gen.sintesis && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-canvas p-3 font-sans text-xs leading-relaxed text-ink-2">{gen.sintesis}</pre>}
        </div>
      )}

      {cargando && !data ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-ink-4" /></div> : !v ? (
        <p className="text-sm text-ink-4">Sin datos todavía.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 font-[family-name:var(--font-mono)] text-[11px] tabular-nums text-ink-3">
            <span>{v.desde} → {v.hasta}</span>
            <span>gasto {money(v.gasto)}</span>
            <span>ROAS {r2(v.roas)}{v.roasIncr != null ? ` · incr ${r2(v.roasIncr)}` : ''}</span>
            <span className="text-ok">{v.ganadores} ganaron</span>
            <span className="text-danger">{v.perdedores} perdieron</span>
          </div>
          {v.analizados < v.ganadores && (
            <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {v.ganadores - v.analizados} de {v.ganadores} ganadores no tienen análisis de hook y guion. <Link href="/meta/barrido" className="underline">Corre el barrido</Link> para completarlos.
            </p>
          )}
          {v.piezasGanadoras.length === 0 ? (
            <p className="text-sm text-ink-4">Ningún anuncio llegó a ROAS {r2(data?.economics.target)} con gasto suficiente en {dias} días.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">{v.piezasGanadoras.map((p) => <Ficha key={p.ad_id} p={p} />)}</div>
          )}
          {v.piezasPerdedoras.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold text-ink">Lo que perdió <span className="font-normal text-ink-4">· gastó 2 CPA o más debajo del equilibrio</span></h3>
              <ul className="space-y-1 text-xs text-ink-2">
                {v.piezasPerdedoras.map((p) => (
                  <li key={p.ad_id}><span className="font-medium">{p.nombre}</span> · ROAS {r2(p.roas)} · {money(p.gasto)}{(p.formato === 'estatico' ? p.titular : p.hookVerbal) ? ` · “${p.formato === 'estatico' ? p.titular : p.hookVerbal}”` : ''}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {data && (
        <div className="mt-6 rounded-xl border border-line bg-surface p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink"><FileText className="h-4 w-4" /> Archivos semanales</h3>
          {data.semanales.length === 0
            ? <p className="text-xs text-ink-4">El primero se genera el próximo martes a las 8 am, o ahora con “Generar archivo de hoy”.</p>
            : (
              <ul className="space-y-1 text-xs">
                {data.semanales.map((s) => (
                  <li key={s.nombre} className="flex items-center justify-between gap-2">
                    <span className="truncate text-ink-2">{s.nombre}</span>
                    <button onClick={() => void descargar(s.url, s.nombre)} className="flex items-center gap-1 text-accent"><Download className="h-3 w-3" /> Descargar</button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}
