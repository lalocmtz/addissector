'use client';

// Arriba de Lanzar: qué necesita la cuenta (de Hoy + los lotes) y qué hay
// pendiente. Cada necesidad abre la puerta que la resuelve, ya armada.

import Link from 'next/link';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { Semilla, Trabajo } from './comun';

export interface Necesidad {
  id: string; prioridad: 1 | 2 | 3; titulo: string; porque: string;
  puerta: 'iterar' | 'guiones' | 'adaptar' | 'decidir' | 'hoy'; datos?: Record<string, unknown>;
}
export interface Pendientes { idea: number; produccion: number; prueba: number; semana: number; cuota: number }

const BOTON: Record<Necesidad['puerta'], string> = { iterar: 'Iterar', guiones: 'Escribir guiones', adaptar: 'Adaptar', decidir: 'Decidir', hoy: 'Ir a Hoy' };
const COLOR = { 1: 'border-l-danger', 2: 'border-l-accent', 3: 'border-l-line-strong' };

export default function Necesidades({ necesidades, pendientes, cargando, onAccion }: {
  necesidades: Necesidad[] | null; pendientes: Pendientes | null; cargando: boolean;
  onAccion: (puerta: 'iterar' | 'guiones' | 'adaptar' | 'decidir', s: Semilla & { loteId?: string }) => void;
}) {
  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="rounded-xl bg-surface-2 p-4">
        <h2 className="text-sm font-semibold">Qué necesita la cuenta <span className="font-normal text-ink-3">· de la lectura de Hoy</span></h2>
        {cargando && !necesidades && <div className="mt-3 flex items-center gap-2 text-xs text-ink-3"><Loader2 className="h-4 w-4 animate-spin" /> Leyendo la cuenta…</div>}
        {necesidades && necesidades.length === 0 && <p className="mt-3 text-sm text-ink-3">Nada urgente. Sigue con la cuota de la semana.</p>}
        <div className="mt-3 space-y-2">
          {(necesidades ?? []).slice(0, 6).map((n) => {
            const d = n.datos ?? {};
            const accion = () => {
              if (n.puerta === 'hoy') return;
              onAccion(n.puerta, {
                adId: d.ad_id as string | undefined, adNombre: d.nombre as string | undefined,
                personaId: d.personaId as string | undefined, trabajo: d.trabajo as Trabajo | undefined,
                enfoque: n.puerta === 'guiones' && d.personaId ? 'explorar' : undefined, loteId: d.id as string | undefined,
              });
            };
            return (
              <div key={n.id} className={`flex items-start justify-between gap-3 rounded-lg border-l-4 bg-surface p-3 ${COLOR[n.prioridad]}`}>
                <div className="min-w-0 text-xs">
                  <div className="text-sm font-medium">{n.titulo}</div>
                  <div className="mt-0.5 text-ink-3">{n.porque}</div>
                </div>
                {n.puerta === 'hoy'
                  ? <Link href="/hoy" className="inline-flex shrink-0 items-center gap-1 rounded bg-surface-2 px-2 py-1 text-xs text-ink-2">{BOTON.hoy} <ArrowRight className="h-3 w-3" /></Link>
                  : <button onClick={accion} className="inline-flex shrink-0 items-center gap-1 rounded bg-accent-soft px-2 py-1 text-xs font-medium text-accent">{BOTON[n.puerta]} <ArrowRight className="h-3 w-3" /></button>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="rounded-xl bg-surface-2 p-4 text-sm">
        <h2 className="text-sm font-semibold">Qué hay pendiente</h2>
        {pendientes ? (
          <dl className="mt-3 space-y-2">
            <div className="flex justify-between"><dt className="text-ink-3">Lotes esta semana</dt><dd className={`font-semibold ${pendientes.semana >= pendientes.cuota ? 'text-ok' : 'text-warn'}`}>{pendientes.semana} de {pendientes.cuota}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-3">Ideas listas</dt><dd className="font-semibold">{pendientes.idea}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-3">En producción</dt><dd className="font-semibold">{pendientes.produccion}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-3">En prueba</dt><dd className="font-semibold">{pendientes.prueba}</dd></div>
          </dl>
        ) : <div className="mt-3 h-24 animate-pulse rounded bg-surface" />}
        <p className="mt-3 text-xs text-ink-4">Un lote se lee completo a los 7 días y se decide el día 8.</p>
      </div>
    </section>
  );
}
