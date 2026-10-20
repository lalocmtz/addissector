'use client';

// Puerta "Guiones": guiones para grabar con justificación, por talento.
// Cada guion = 3 hooks sobre el mismo cuerpo = un lote de 3 anuncios.

import { useState } from 'react';
import { Loader2, Wand2, ArrowRight } from 'lucide-react';
import {
  type LoteBorrador, type Persona, type Semilla, type Trabajo, type Capa,
  TRABAJOS, BORRADOR_VACIO, inputCls, labelCls, Chip, CopyBtn,
} from './comun';

interface Hook { dice: string; se_ve: string; texto_pantalla: string }
interface Beat { seg: string; bloque: string; dice: string; se_ve: string }
export interface Guion {
  titulo: string; tipo: 'iteracion' | 'concepto'; origen_ad_id: string; origen_nombre: string; capa: Capa | '';
  persona_id: string; avatar: string; angulo: string; objecion: string; trabajo: Trabajo; concepto: string; concepto_corto: string;
  formato: string; duracion_seg: number; hooks: Hook[]; cuerpo: Beat[]; cta: string; textos: string[]; titulares: string[];
  notas_toma: string; justificacion: string; evidencia: string; metrica: string; alertas: string[];
}

const TALENTOS = [
  { id: 'founder', label: 'Founder', ayuda: 'Óscar a cámara: confianza, mecanismo, responder comentarios' },
  { id: 'modelo', label: 'Modelos', ayuda: 'Demostración, aplicación, revelación 24 h' },
  { id: 'creador', label: 'Creadores', ayuda: 'UGC, testimonio, diario de días' },
] as const;

function textoGuion(g: Guion, h: Hook): string {
  return [`HOOK (0-3 s): ${h.dice}`, `  Se ve: ${h.se_ve}`, `  Texto: ${h.texto_pantalla}`,
    ...g.cuerpo.map((b) => `${b.seg} s · ${b.bloque}: ${b.dice}\n  Se ve: ${b.se_ve}`), `CTA: ${g.cta}`].join('\n');
}

export function guionABorrador(g: Guion, talento: string): LoteBorrador {
  return {
    ...BORRADOR_VACIO, fuente: 'guion', talento,
    tipo: g.tipo, origenAdId: g.origen_ad_id, origenNombre: g.origen_nombre, capa: g.tipo === 'iteracion' ? g.capa : '',
    personaId: g.persona_id, avatar: g.avatar, angulo: g.angulo, objecion: g.objecion, trabajo: g.trabajo,
    concepto: g.concepto, conceptoCorto: g.concepto_corto, mensaje: g.titulo, formato: 'video',
    ejecuciones: g.hooks.map((h) => ({ hook: h.dice, guion: textoGuion(g, h), visual: `${h.se_ve} · Texto: ${h.texto_pantalla}`, imagen: '' })),
    textos: g.textos.slice(0, 2), titulares: g.titulares.slice(0, 2),
    justificacion: `${g.justificacion} Evidencia: ${g.evidencia} Se valida con: ${g.metrica}`,
  };
}

export default function Guiones({ brandId, personas, semilla, onLote }: {
  brandId: string; personas: Persona[]; semilla: Semilla; onLote: (b: LoteBorrador) => void;
}) {
  const [talento, setTalento] = useState<string>('creador');
  const [cantidad, setCantidad] = useState(3);
  const [enfoque, setEnfoque] = useState<'auto' | 'iterar' | 'explorar'>(semilla.enfoque ?? (semilla.adId ? 'iterar' : 'auto'));
  const [personaId, setPersonaId] = useState(semilla.personaId ?? '');
  const [trabajo, setTrabajo] = useState<Trabajo | ''>(semilla.trabajo ?? '');
  const [tema, setTema] = useState(semilla.tema ?? '');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ lectura: string; guiones: Guion[]; talento: string } | null>(null);

  async function escribir() {
    setCargando(true); setError(null); setRes(null);
    try {
      const r = await fetch('/api/guiones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, talento, cantidad, enfoque, personaId: personaId || undefined, adId: semilla.adId, tema: tema || undefined, trabajo: trabajo || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Respondió ${r.status}`);
      setRes(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron escribir');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div>
      {semilla.adId && <p className="mb-3 rounded-lg bg-ok-soft px-3 py-2 text-xs text-ok">Iterando: {semilla.adNombre ?? semilla.adId}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className={labelCls}>Quién graba</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {TALENTOS.map((t) => <Chip key={t.id} activo={talento === t.id} title={t.ayuda} onClick={() => setTalento(t.id)}>{t.label}</Chip>)}
          </div>
          <p className="mt-1 text-xs text-ink-4">{TALENTOS.find((t) => t.id === talento)?.ayuda}</p>
        </div>
        <div>
          <div className={labelCls}>Balance</div>
          <div className="mt-1 flex flex-wrap gap-2">
            <Chip activo={enfoque === 'auto'} onClick={() => setEnfoque('auto')} title="~2/3 iterar ganadores, ~1/3 conceptos nuevos">Lo que pida la cuenta</Chip>
            <Chip activo={enfoque === 'iterar'} onClick={() => setEnfoque('iterar')}>Solo iterar</Chip>
            <Chip activo={enfoque === 'explorar'} onClick={() => setEnfoque('explorar')}>Solo explorar</Chip>
          </div>
        </div>
        <div>
          <div className={labelCls}>Avatar (opcional)</div>
          <select value={personaId} onChange={(e) => setPersonaId(e.target.value)} className={`${inputCls} mt-1`}>
            <option value="">Que lo elija según la cuenta</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <div className={labelCls}>Trabajo (opcional) · cuántos guiones</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {(Object.keys(TRABAJOS) as Trabajo[]).map((t) => <Chip key={t} activo={trabajo === t} onClick={() => setTrabajo(trabajo === t ? '' : t)}>{TRABAJOS[t].corto}</Chip>)}
            <select value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs">
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} guion{n > 1 ? 'es' : ''}</option>)}
            </select>
          </div>
        </div>
        <div className="md:col-span-2">
          <div className={labelCls}>Idea o tema (opcional)</div>
          <textarea value={tema} onChange={(e) => setTema(e.target.value)} className={`${inputCls} mt-1 h-16`} placeholder="ej. responder el comentario 'se ve falso'; grabar en la playa; el pack de pareja…" />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button onClick={() => void escribir()} disabled={cargando} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50">
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {cargando ? 'Leyendo la cuenta y escribiendo…' : 'Escribir guiones'}
        </button>
      </div>
      {error && <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

      {res && (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-ink-2">{res.lectura}</p>
          {res.guiones.map((g, i) => (
            <article key={i} className="rounded-xl bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-ink-3">
                    <span className={`mr-2 rounded px-1.5 py-0.5 ${g.tipo === 'iteracion' ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent'}`}>{g.tipo === 'iteracion' ? `Iterar · ${g.capa}` : 'Concepto nuevo'}</span>
                    {g.formato} · {g.duracion_seg} s · {TRABAJOS[g.trabajo]?.corto}
                  </div>
                  <h3 className="mt-1 font-semibold">{g.titulo}</h3>
                  <div className="text-xs text-ink-3">{g.avatar}{g.objecion ? ` · objeción: ${g.objecion}` : ''}{g.origen_nombre ? ` · de ${g.origen_nombre}` : ''}</div>
                </div>
                <button onClick={() => onLote(guionABorrador(g, res.talento))} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent">
                  Crear lote <ArrowRight className="h-3 w-3" />
                </button>
              </div>
              <p className="mt-2 rounded-lg bg-surface-2 p-2 text-xs text-ink-2"><span className="font-medium">Por qué: </span>{g.justificacion} <span className="text-ink-3">· {g.evidencia}</span></p>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {g.hooks.map((h, k) => (
                  <div key={k} className="rounded-lg border border-line p-2 text-xs">
                    <div className="font-mono text-ink-4">Hook {k + 1} · A{k + 1}</div>
                    <div className="mt-1 font-medium">“{h.dice}”</div>
                    <div className="mt-1 text-ink-3">Se ve: {h.se_ve}</div>
                    <div className="text-ink-3">Texto: {h.texto_pantalla}</div>
                  </div>
                ))}
              </div>
              <table className="mt-3 w-full text-left text-xs">
                <thead className="text-ink-4"><tr><th className="w-14 py-1">Seg</th><th className="w-24">Bloque</th><th>Se dice</th><th>Se ve</th></tr></thead>
                <tbody>
                  {g.cuerpo.map((b, k) => (
                    <tr key={k} className="border-t border-line align-top">
                      <td className="py-1 font-mono text-ink-4">{b.seg}</td><td className="text-ink-3">{b.bloque}</td><td className="pr-2">{b.dice}</td><td className="text-ink-3">{b.se_ve}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line"><td className="py-1 font-mono text-ink-4">CTA</td><td /><td colSpan={2} className="font-medium">{g.cta}</td></tr>
                </tbody>
              </table>
              <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                <div><span className="text-ink-4">Notas de toma: </span>{g.notas_toma}</div>
                <div><span className="text-ink-4">Se valida con: </span>{g.metrica}</div>
              </div>
              {g.alertas?.length > 0 && <div className="mt-2 text-xs text-warn">Falta: {g.alertas.join(' · ')}</div>}
              <div className="mt-2 flex flex-wrap gap-1">
                <CopyBtn label="Copiar guion" text={`${g.titulo}\n\n${g.hooks.map((h, k) => `--- Versión A${k + 1} ---\n${textoGuion(g, h)}`).join('\n\n')}\n\nNotas: ${g.notas_toma}`} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
