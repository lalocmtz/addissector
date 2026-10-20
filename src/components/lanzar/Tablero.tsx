'use client';

// El tablero de lotes: Idea → En producción → En prueba → Decidido.
// En producción y prueba muestra los nombres exactos para Meta (copiar/pegar).

import { useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { type Etapa, type Trabajo, type Formato, type Capa, type Persona, TRABAJOS, CopyBtn, money, num, inputCls } from './comun';

interface Ejec { id: string; variant: string; ad_name: string; hook: string | null; script: string | null; visual_notes: string | null; beats: { imagen?: string | null } | null }
interface Resultado { anuncios: number; spend: number; purchases: number | null; roas: number | null; cpa: number | null; hook: number | null; roasIncr: number | null; freq: number | null; diasConGasto: number; primerDia: string | null }
export interface Tarjeta {
  id: string; code: string; name: string; hypothesis: string | null; persona_id: string | null; etapa: Etapa;
  started_at: string | null; created_at: string; closed_note: string | null;
  result: { decision?: 'gano' | 'perdio'; nota?: string | null } | null;
  brief: {
    tipo: 'concepto' | 'iteracion'; capa: Capa | null; origen: { ad_id: string | null; nombre: string | null } | null; angulo: string;
    trabajo: Trabajo; formato: Formato; mensaje: string; objecion: string; textos: string[]; titulares: string[];
    lote?: string; avatar?: string | null; fuente?: string; justificacion?: string | null; talento?: string | null;
  };
  ejecuciones: Ejec[]; resultado: Resultado | null;
}

const ETAPAS: { id: Etapa; label: string; ayuda: string }[] = [
  { id: 'idea', label: 'Idea', ayuda: 'Lote armado, falta producir' },
  { id: 'produccion', label: 'En producción', ayuda: 'Se está grabando o diseñando' },
  { id: 'prueba', label: 'En prueba', ayuda: '7 días con mínimo de gasto' },
  { id: 'decidido', label: 'Decidido', ayuda: 'Ganó o perdió' },
];

export default function Tablero({ tarjetas, personas, targetCpa, ahora, resaltar, onMover, onArchivar }: {
  tarjetas: Tarjeta[]; personas: Persona[]; targetCpa: number | null; ahora: number; resaltar?: string | null;
  onMover: (id: string, etapa: Etapa, decision?: 'gano' | 'perdio', nota?: string) => Promise<void>;
  onArchivar: (id: string) => Promise<void>;
}) {
  const [decidiendo, setDecidiendo] = useState<string | null>(resaltar ?? null);
  const [nota, setNota] = useState('');

  return (
    <section id="tablero" className="mt-8 grid gap-4 lg:grid-cols-4">
      {ETAPAS.map((et) => {
        const xs = tarjetas.filter((t) => t.etapa === et.id);
        return (
          <div key={et.id} className="rounded-xl bg-surface-2 p-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">{et.label}</h3>
              <span className="text-xs text-ink-4">{xs.length}</span>
            </div>
            <p className="text-xs text-ink-4">{et.ayuda}</p>
            <div className="mt-3 space-y-3">
              {xs.length === 0 && <div className="rounded-lg border border-dashed border-line p-3 text-center text-xs text-ink-4">Vacío</div>}
              {xs.map((t) => {
                const dias = t.started_at && ahora ? Math.floor((ahora - Date.parse(t.started_at)) / 86_400_000) + 1 : null;
                const r = t.resultado;
                const lote = t.brief.lote ?? `${t.code} | ${t.name}`;
                const avatar = t.brief.avatar ?? personas.find((p) => p.id === t.persona_id)?.name;
                const imgs = t.ejecuciones.map((e) => e.beats?.imagen).filter(Boolean) as string[];
                return (
                  <div key={t.id} id={`lote-${t.id}`} className={`rounded-lg bg-surface p-3 text-xs ${resaltar === t.id ? 'ring-2 ring-accent' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-ink-4">{t.code} · {t.brief.tipo === 'iteracion' ? `iteración (${t.brief.capa})` : 'concepto nuevo'}</div>
                        <div className="mt-0.5 text-sm font-medium">{t.name}</div>
                      </div>
                      <button onClick={() => void onArchivar(t.id)} title="Archivar" className="text-ink-4 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="rounded bg-surface-2 px-1.5 py-0.5">{TRABAJOS[t.brief.trabajo]?.corto}</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5">{t.brief.formato === 'video' ? 'Video' : 'Estático'}</span>
                      {avatar && <span className="rounded bg-surface-2 px-1.5 py-0.5">{avatar.split(' ')[0]}</span>}
                      <span className="rounded bg-surface-2 px-1.5 py-0.5">{t.ejecuciones.length} anuncios</span>
                    </div>
                    {imgs.length > 0 && (
                      <div className="mt-2 flex gap-1">{imgs.slice(0, 6).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-14 w-10 rounded object-cover" /></a>)}</div>
                    )}
                    <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-ink-3">
                      {t.ejecuciones.map((e) => <li key={e.id}>{e.hook}</li>)}
                    </ol>
                    {t.brief.justificacion && et.id === 'idea' && <p className="mt-2 line-clamp-3 text-ink-4">{t.brief.justificacion}</p>}

                    {(et.id === 'idea' || et.id === 'produccion' || et.id === 'prueba') && (
                      <details className="mt-2 rounded bg-surface-2 p-2" open={et.id === 'produccion'}>
                        <summary className="cursor-pointer text-ink-4">Para subir a Meta</summary>
                        <div className="mt-1 space-y-1">
                          <div className="text-ink-4">Conjunto</div>
                          <CopyBtn text={lote} />
                          <div className="text-ink-4">Anuncios</div>
                          <div className="flex flex-wrap gap-1">{t.ejecuciones.map((e) => <CopyBtn key={e.id} text={e.ad_name} />)}</div>
                          {t.brief.textos?.filter(Boolean).map((x, i) => <CopyBtn key={`t${i}`} label={`Texto ${i + 1}`} text={x} />)}
                          {t.brief.titulares?.filter(Boolean).map((x, i) => <CopyBtn key={`h${i}`} label={`Titular ${i + 1}: ${x}`} text={x} />)}
                          {t.ejecuciones.some((e) => e.script) && <CopyBtn label="Guiones / copy" text={t.ejecuciones.map((e) => `${e.ad_name}\n${e.script ?? e.hook ?? ''}`).join('\n\n')} />}
                        </div>
                      </details>
                    )}

                    {r && (
                      <div className="mt-2 grid grid-cols-3 gap-1 rounded bg-surface-2 p-2 tabular-nums">
                        <div><div className="text-ink-4">Gasto</div>{money(r.spend)}</div>
                        <div><div className="text-ink-4">Compras</div>{r.purchases ?? 0}</div>
                        <div><div className="text-ink-4">CPA</div><span className={r.cpa != null && targetCpa != null ? (r.cpa <= targetCpa ? 'text-ok' : 'text-danger') : ''}>{money(r.cpa)}</span></div>
                        <div><div className="text-ink-4">ROAS</div>{num(r.roas)}</div>
                        <div><div className="text-ink-4">ROAS inc.</div>{num(r.roasIncr)}</div>
                        <div><div className="text-ink-4">Frec. diaria</div>{num(r.freq)}</div>
                        <div><div className="text-ink-4">Días</div>{r.diasConGasto}</div>
                        <div><div className="text-ink-4">Hook</div>{r.hook != null ? `${Math.round(r.hook)}%` : '—'}</div>
                        <div><div className="text-ink-4">Anuncios</div>{r.anuncios}</div>
                      </div>
                    )}
                    {et.id === 'prueba' && !r && <p className="mt-2 text-ink-4">Aún no hay anuncios en Meta con el código {t.code}.</p>}
                    {et.id === 'prueba' && dias != null && (
                      <p className={`mt-2 ${dias >= 8 ? 'font-medium text-accent' : 'text-ink-3'}`}>
                        {dias >= 8 ? `Día ${dias}: toca decidir el lote completo.` : `Día ${dias} de 7 con mínimo de gasto.`}
                      </p>
                    )}
                    {et.id === 'decidido' && t.result?.decision && (
                      <p className={`mt-2 font-medium ${t.result.decision === 'gano' ? 'text-ok' : 'text-danger'}`}>
                        {t.result.decision === 'gano' ? 'Ganó' : 'Perdió'}{t.closed_note ? ` · ${t.closed_note}` : ''}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-1">
                      {et.id === 'idea' && <button onClick={() => void onMover(t.id, 'produccion')} className="rounded bg-accent-soft px-2 py-1 text-accent">A producción →</button>}
                      {et.id === 'produccion' && <button onClick={() => void onMover(t.id, 'prueba')} className="rounded bg-accent-soft px-2 py-1 text-accent">Ya está en Meta →</button>}
                      {et.id === 'prueba' && decidiendo !== t.id && <button onClick={() => setDecidiendo(t.id)} className="rounded bg-accent-soft px-2 py-1 text-accent">Decidir</button>}
                    </div>
                    {decidiendo === t.id && et.id === 'prueba' && (
                      <div className="mt-2 space-y-2">
                        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Qué aprendimos (una línea)" className={inputCls} />
                        <div className="flex gap-2">
                          <button onClick={() => void onMover(t.id, 'decidido', 'gano', nota).then(() => { setDecidiendo(null); setNota(''); })} className="flex-1 rounded bg-ok-soft px-2 py-1.5 font-medium text-ok">Ganó</button>
                          <button onClick={() => void onMover(t.id, 'decidido', 'perdio', nota).then(() => { setDecidiendo(null); setNota(''); })} className="flex-1 rounded bg-danger-soft px-2 py-1.5 font-medium text-danger">Perdió</button>
                          <button onClick={() => { setDecidiendo(null); setNota(''); }} className="rounded px-2 text-ink-4"><X className="h-4 w-4" /></button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
