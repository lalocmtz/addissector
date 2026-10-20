'use client';

// Puerta "Iterar ganador": los anuncios que el semáforo marcó para escalar o
// iterar. De cada uno sale un lote que cambia UNA capa: guiones (video),
// adaptación (estático) o a mano.

import { ArrowRight, TrendingDown } from 'lucide-react';
import { type Ganador, num, money } from './comun';

export default function Iterar({ ganadores, marcado, onGuiones, onEstatico, onManual }: {
  ganadores: Ganador[]; marcado?: string;
  onGuiones: (g: Ganador) => void; onEstatico: (g: Ganador) => void; onManual: (g: Ganador) => void;
}) {
  if (!ganadores.length) {
    return <p className="rounded-lg bg-surface p-4 text-sm text-ink-3">Todavía no hay anuncios en verde (escalar o iterar). Mientras tanto, la cuenta necesita conceptos nuevos: usa Guiones o Adaptar referencia.</p>;
  }
  const orden = [...ganadores].sort((a, b) => Number(b.ad_id === marcado) - Number(a.ad_id === marcado));
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {orden.map((g) => {
        const video = g.kind !== 'image';
        return (
          <div key={g.ad_id} className={`flex gap-3 rounded-xl bg-surface p-3 ${g.ad_id === marcado ? 'ring-2 ring-accent' : ''}`}>
            <div className="h-24 w-16 shrink-0 overflow-hidden rounded bg-surface-2">
              {g.thumbnail_url && <img src={g.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
            </div>
            <div className="min-w-0 flex-1 text-xs">
              <div className="truncate text-sm font-medium" title={g.nombre ?? ''}>{g.nombre ?? g.ad_id}</div>
              <div className="mt-0.5 text-ok">
                {g.luz === 'escalar' ? 'Escalar' : 'Foco: iterar'} · ROAS 14 d {num(g.roas14)}{g.roasIncr14 != null ? ` · incr ${num(g.roasIncr14)}` : ''}
              </div>
              <div className="text-ink-3">Gasto 14 d {money(g.gasto14)}{g.hook14 != null ? ` · hook ${Math.round(g.hook14)}%` : ''}{g.analizado ? ' · analizado' : ' · sin análisis (corre el barrido)'}</div>
              {g.cayendo && <div className="mt-0.5 inline-flex items-center gap-1 text-warn"><TrendingDown className="h-3 w-3" /> Cayendo: prepara el reemplazo ya</div>}
              <div className="mt-2 flex flex-wrap gap-1">
                <button onClick={() => (video ? onGuiones(g) : onEstatico(g))} className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 font-medium text-on-accent">
                  {video ? 'Guiones de iteración' : 'Adaptar este estático'} <ArrowRight className="h-3 w-3" />
                </button>
                <button onClick={() => (video ? onEstatico(g) : onGuiones(g))} className="rounded bg-surface-2 px-2 py-1 text-ink-2">{video ? 'Pasarlo a estático' : 'Pasarlo a video'}</button>
                <button onClick={() => onManual(g)} className="rounded bg-surface-2 px-2 py-1 text-ink-2">A mano</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
