'use client';

// =============================================================================
// /lanzar — de "qué hago" a "qué subo". Reemplaza a Producción en el menú.
//
//   1. Cola de iteración: lo que el semáforo marcó como Foco/Escalar.
//   2. La tarjeta 3:2:2: 7 decisiones (avatar, ángulo, trabajo, concepto,
//      formato, 3 ejecuciones + 2 textos + 2 titulares, hipótesis).
//   3. Tablero de 4 columnas: Idea → En producción → En prueba → Decidido.
//
// Una tarjeta se sube a Meta como UN conjunto con 3 anuncios (uno por
// ejecución), cada uno con los 2 textos y los 2 titulares. El código de la
// tarjeta va en el nombre: así los resultados se leen solos.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Copy, Check, X, ArrowRight, Sparkles, Trash2 } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';

type Etapa = 'idea' | 'produccion' | 'prueba' | 'decidido';
type Trabajo = 'atencion' | 'valor' | 'confianza';
type Formato = 'video' | 'estatico';
type Capa = 'mensaje' | 'mecanismo' | 'avatar' | 'educacion' | 'oferta' | 'visual';

interface Ejec { id: string; variant: string; ad_name: string; hook: string | null; script: string | null; visual_notes: string | null }
interface Resultado { anuncios: number; spend: number; purchases: number | null; roas: number | null; cpa: number | null; hook: number | null; diasConGasto: number; primerDia: string | null }
interface Tarjeta {
  id: string; code: string; name: string; hypothesis: string | null; persona_id: string | null; etapa: Etapa;
  started_at: string | null; created_at: string; closed_note: string | null;
  result: { decision?: 'gano' | 'perdio'; nota?: string | null } | null;
  brief: { tipo: 'concepto' | 'iteracion'; capa: Capa | null; origen: { ad_id: string | null; nombre: string | null } | null; angulo: string; trabajo: Trabajo; formato: Formato; mensaje: string; objecion: string; textos: string[]; titulares: string[] };
  ejecuciones: Ejec[]; resultado: Resultado | null;
}
interface LanzarData {
  economics: { breakeven: number; target: number; targetCpa: number | null };
  prefijo: string; tarjetas: Tarjeta[];
  personas: { id: string; name: string; callout: string | null }[];
  angulos: { id: string; code: string; name: string }[];
}
interface Candidato { ad_id: string; nombre: string; luz: string; titulo: string; porque: string; thumbnail_url: string | null; d14: { roas: number | null; purchases: number | null; spend: number } | null }

const ETAPAS: { id: Etapa; label: string; ayuda: string }[] = [
  { id: 'idea', label: 'Idea', ayuda: 'Tarjeta lista para producir' },
  { id: 'produccion', label: 'En producción', ayuda: 'El equipo la está grabando o diseñando' },
  { id: 'prueba', label: 'En prueba', ayuda: '7 días con mínimo de gasto' },
  { id: 'decidido', label: 'Decidido', ayuda: 'Ganó o perdió' },
];
const TRABAJOS: Record<Trabajo, { label: string; ayuda: string; video: string; estatico: string }> = {
  atencion: { label: 'Captar atención', ayuda: 'Gente nueva. Debe salir con frecuencia diaria < 1.15 y CPM bajo.', video: 'Talking head o UGC que abre con el problema', estatico: 'Foto limpia del tatuaje puesto' },
  valor: { label: 'Aclarar el valor', ayuda: 'Ya le interesa; falta entender. Frecuencia 1.15–1.25.', video: 'Demostración (estilo HOW IT WORKS)', estatico: 'Recordatorio: VS, antes y después, razones' },
  confianza: { label: 'Convertir confianza', ayuda: 'Ya casi compra. Frecuencia > 1.25, CPA bajo.', video: 'Reseñas reales o explicativo largo', estatico: 'Respuesta directa: pack, precio, garantía' },
};
const CAPAS: Record<Capa, string> = {
  mensaje: 'Mensaje: otro hook, titular o emoción',
  mecanismo: 'Mecanismo: explicar distinto por qué se ve real',
  avatar: 'Avatar: el mismo anuncio hablado a otro avatar',
  educacion: 'Educación: atacar otra objeción',
  oferta: 'Oferta: pack, garantía, regalo, urgencia real',
  visual: 'Visual: otro creador, escena o ritmo',
};

const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-MX')}`);
const num = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));

interface Form {
  tipo: 'concepto' | 'iteracion'; origenAdId: string; origenNombre: string; capa: Capa | '';
  personaId: string; angulo: string; trabajo: Trabajo | ''; concepto: string; mensaje: string; objecion: string;
  formato: Formato | ''; ejecuciones: { hook: string; guion: string }[]; textos: string[]; titulares: string[]; hipotesis: string;
}
const VACIO: Form = {
  tipo: 'concepto', origenAdId: '', origenNombre: '', capa: '', personaId: '', angulo: '', trabajo: '', concepto: '', mensaje: '', objecion: '',
  formato: '', ejecuciones: [{ hook: '', guion: '' }, { hook: '', guion: '' }, { hook: '', guion: '' }], textos: ['', ''], titulares: ['', ''], hipotesis: '',
};

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" title="Copiar" onClick={() => { void navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}
      className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:text-ink">
      {ok ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />} {text}
    </button>
  );
}

export default function LanzarPage() {
  const { me, activeBrandId, activeBrand, setActiveBrandId } = useMe();
  const [data, setData] = useState<LanzarData | null>(null);
  const [cola, setCola] = useState<Candidato[]>([]);
  const [ahora, setAhora] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState<Form>(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [decidiendo, setDecidiendo] = useState<string | null>(null);
  const [nota, setNota] = useState('');

  const cargar = useCallback(async () => {
    if (!activeBrandId) return;
    setCargando(true); setError(null);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/lanzar?brand=${activeBrandId}`, { cache: 'no-store' }),
        fetch(`/api/hoy?brand=${activeBrandId}`, { cache: 'no-store' }),
      ]);
      const j1 = await r1.json();
      if (!r1.ok) throw new Error(j1.error ?? `Respondió ${r1.status}`);
      setData(j1 as LanzarData);
      const j2 = await r2.json().catch(() => ({}));
      const xs = ((j2?.anuncios ?? []) as Candidato[]).filter((a) => a.luz === 'iterar' || a.luz === 'escalar');
      setCola(xs);
      setAhora(Date.now());
      // ?iterar=<ad_id> llega desde Hoy: abre la tarjeta ya armada como iteración.
      const q = new URLSearchParams(window.location.search).get('iterar');
      if (q) {
        const a = xs.find((x) => x.ad_id === q) ?? ((j2?.anuncios ?? []) as Candidato[]).find((x) => x.ad_id === q);
        if (a) {
          setF({ ...VACIO, tipo: 'iteracion', origenAdId: a.ad_id, origenNombre: a.nombre, concepto: a.nombre });
          setAbierto(true);
        }
        window.history.replaceState(null, '', '/lanzar');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    } finally {
      setCargando(false);
    }
  }, [activeBrandId]);

  useEffect(() => { void Promise.resolve().then(cargar); }, [cargar]);

  const avatar = data?.personas.find((p) => p.id === f.personaId)?.name ?? '';
  const hipotesisSugerida = useMemo(() => {
    const cpa = data?.economics.targetCpa ? Math.round(data.economics.targetCpa) : 'el objetivo';
    const que = f.tipo === 'iteracion' && f.capa ? `cambiar ${CAPAS[f.capa as Capa].split(':')[0].toLowerCase()} de "${f.origenNombre}"` : `el concepto "${f.concepto || '[concepto]'}"`;
    return `Si "${f.angulo || '[razón de compra]'}" es cierto para ${avatar || '[avatar]'}, ${que} va a traer compras a CPA de ${cpa} o menos, porque ${f.mensaje || '[mecanismo]'}. Si pierde, concluimos que el problema es el concepto, no el producto.`;
  }, [f, avatar, data]);

  const semana = useMemo(() => (data?.tarjetas ?? []).filter((t) => ahora - Date.parse(t.created_at) < 7 * 86_400_000).length, [data, ahora]);

  const set = <K extends keyof Form>(k: K, val: Form[K]) => setF((x) => ({ ...x, [k]: val }));

  async function guardar() {
    if (!activeBrandId) return;
    setGuardando(true); setError(null);
    try {
      const r = await fetch('/api/lanzar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: activeBrandId, ...f, hipotesis: f.hipotesis || hipotesisSugerida }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Respondió ${r.status}`);
      setF(VACIO); setAbierto(false);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function mover(id: string, etapa: Etapa, decision?: 'gano' | 'perdio') {
    setError(null);
    const r = await fetch('/api/lanzar', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, etapa, decision, nota: nota || undefined }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? 'No se pudo mover'); return; }
    setDecidiendo(null); setNota('');
    await cargar();
  }

  async function archivar(id: string) {
    await fetch(`/api/lanzar?id=${id}`, { method: 'DELETE' });
    await cargar();
  }

  const input = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent';
  const label = 'text-xs font-medium text-ink-3';

  return (
    <div className="min-h-screen bg-surface text-ink">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Lanzar</h1>
            <p className="mt-1 text-sm text-ink-3">Una tarjeta = una prueba 3:2:2 = un conjunto con 3 anuncios, cada uno con 2 textos y 2 titulares.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-xs ${semana >= 3 ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>Esta semana: {semana} de 3 tarjetas</span>
            <button onClick={() => { setF(VACIO); setAbierto(true); }} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent">
              <Plus className="h-4 w-4" /> Concepto nuevo
            </button>
          </div>
        </div>

        {error && <div className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
        {cargando && !data && <div className="mt-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-ink-3" /></div>}

        {/* 1 · Cola de iteración */}
        {cola.length > 0 && !abierto && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold">Para iterar <span className="font-normal text-ink-3">· lo que el semáforo marcó en verde</span></h2>
            <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
              {cola.map((a) => (
                <button key={a.ad_id} onClick={() => { setF({ ...VACIO, tipo: 'iteracion', origenAdId: a.ad_id, origenNombre: a.nombre, concepto: a.nombre }); setAbierto(true); }}
                  className="flex w-64 shrink-0 gap-3 rounded-xl border border-surface-2 p-2 text-left hover:border-ok">
                  <div className="h-16 w-12 shrink-0 overflow-hidden rounded bg-surface-2">
                    {a.thumbnail_url && <img src={a.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium" title={a.nombre}>{a.nombre}</div>
                    <div className="text-xs text-ok">ROAS 14 d {num(a.d14?.roas)} · {a.d14?.purchases ?? 0} compras</div>
                    <div className="mt-1 inline-flex items-center gap-1 text-xs text-accent">Crear iteración <ArrowRight className="h-3 w-3" /></div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 2 · La tarjeta */}
        {abierto && data && (
          <section className="mt-6 rounded-xl border border-accent-strong bg-surface-2 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{f.tipo === 'iteracion' ? `Iteración de: ${f.origenNombre}` : 'Concepto nuevo'}</h2>
              <button onClick={() => setAbierto(false)} className="text-ink-3 hover:text-ink"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-4 grid gap-5 md:grid-cols-2">
              {f.tipo === 'iteracion' && (
                <div className="md:col-span-2">
                  <div className={label}>0 · Qué capa cambia (una sola)</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(Object.keys(CAPAS) as Capa[]).map((c) => (
                      <button key={c} type="button" onClick={() => set('capa', c)}
                        className={`rounded-lg px-3 py-1.5 text-xs ${f.capa === c ? 'bg-accent text-on-accent' : 'bg-surface text-ink-2'}`}>{CAPAS[c]}</button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className={label}>1 · Avatar: para quién</div>
                <select value={f.personaId} onChange={(e) => set('personaId', e.target.value)} className={`${input} mt-1`}>
                  <option value="">Elige un avatar</option>
                  {data.personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {f.personaId && <p className="mt-1 text-xs text-ink-3">{data.personas.find((p) => p.id === f.personaId)?.callout}</p>}
              </div>
              <div>
                <div className={label}>2 · Ángulo: por qué compra, en sus palabras</div>
                <input list="angulos" value={f.angulo} onChange={(e) => set('angulo', e.target.value)} className={`${input} mt-1`} placeholder="quiero ver cómo se ve antes del para siempre" />
                <datalist id="angulos">{data.angulos.map((a) => <option key={a.id} value={a.name} />)}</datalist>
              </div>

              <div className="md:col-span-2">
                <div className={label}>3 · Trabajo: qué tiene que lograr (uno solo)</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {(Object.keys(TRABAJOS) as Trabajo[]).map((t) => (
                    <button key={t} type="button" onClick={() => set('trabajo', t)}
                      className={`rounded-lg p-3 text-left text-xs ${f.trabajo === t ? 'bg-accent text-on-accent' : 'bg-surface text-ink-2'}`}>
                      <div className="text-sm font-medium">{TRABAJOS[t].label}</div>
                      <div className="mt-1 opacity-80">{TRABAJOS[t].ayuda}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className={label}>4 · Concepto: cómo se dramatiza (repetible)</div>
                <input value={f.concepto} onChange={(e) => set('concepto', e.target.value)} className={`${input} mt-1`} placeholder="VS calcomanía · HOW IT WORKS · reseña en carro…" />
                <input value={f.mensaje} onChange={(e) => set('mensaje', e.target.value)} className={`${input} mt-2`} placeholder="Mensaje central en una frase" />
                <input value={f.objecion} onChange={(e) => set('objecion', e.target.value)} className={`${input} mt-2`} placeholder="Objeción que responde (ej. que no se vea falso)" />
              </div>
              <div>
                <div className={label}>5 · Formato (uno solo)</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(['video', 'estatico'] as Formato[]).map((fm) => (
                    <button key={fm} type="button" onClick={() => set('formato', fm)}
                      className={`rounded-lg p-3 text-left text-xs ${f.formato === fm ? 'bg-accent text-on-accent' : 'bg-surface text-ink-2'}`}>
                      <div className="text-sm font-medium">{fm === 'video' ? 'Video' : 'Estático'}</div>
                      {f.trabajo && <div className="mt-1 opacity-80">{TRABAJOS[f.trabajo as Trabajo][fm]}</div>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2">
                <div className={label}>6 · El 3:2:2 — 3 ejecuciones del MISMO concepto (cambia cómo se ve, no lo que significa)</div>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  {f.ejecuciones.map((e, i) => (
                    <div key={i} className="rounded-lg bg-surface p-3">
                      <div className="text-xs font-medium text-ink-3">Ejecución {i + 1}</div>
                      <input value={e.hook} onChange={(ev) => set('ejecuciones', f.ejecuciones.map((x, j) => j === i ? { ...x, hook: ev.target.value } : x))}
                        className={`${input} mt-1`} placeholder="Hook (primeros 3 s o titular de la imagen)" />
                      <textarea value={e.guion} onChange={(ev) => set('ejecuciones', f.ejecuciones.map((x, j) => j === i ? { ...x, guion: ev.target.value } : x))}
                        className={`${input} mt-2 h-20`} placeholder="Guion o notas visuales, creador, escena" />
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-xs text-ink-3">2 textos principales (uno amplio y entretenido, uno directo)</div>
                    {f.textos.map((t, i) => <textarea key={i} value={t} onChange={(e) => set('textos', f.textos.map((x, j) => j === i ? e.target.value : x))} className={`${input} mt-1 h-16`} placeholder={i === 0 ? 'Amplio / entretenido' : 'Directo'} />)}
                  </div>
                  <div>
                    <div className="text-xs text-ink-3">2 titulares muy distintos</div>
                    {f.titulares.map((t, i) => <input key={i} value={t} onChange={(e) => set('titulares', f.titulares.map((x, j) => j === i ? e.target.value : x))} className={`${input} mt-1`} placeholder={`Titular ${i + 1}`} />)}
                  </div>
                </div>
              </div>

              <div className="md:col-span-2">
                <div className={label}>7 · Hipótesis</div>
                <textarea value={f.hipotesis || hipotesisSugerida} onChange={(e) => set('hipotesis', e.target.value)} className={`${input} mt-1 h-20`} />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setAbierto(false)} className="rounded-lg px-4 py-2 text-sm text-ink-3">Cancelar</button>
              <button onClick={() => void guardar()} disabled={guardando} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Crear tarjeta
              </button>
            </div>
          </section>
        )}

        {/* 3 · Tablero */}
        {data && (
          <section className="mt-8 grid gap-4 lg:grid-cols-4">
            {ETAPAS.map((et) => {
              const xs = data.tarjetas.filter((t) => t.etapa === et.id);
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
                      const meta = data.economics.targetCpa;
                      return (
                        <div key={t.id} className="rounded-lg bg-surface p-3 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-mono text-[11px] text-ink-4">{t.code} · {t.brief.tipo === 'iteracion' ? `iteración (${t.brief.capa})` : 'concepto nuevo'}</div>
                              <div className="mt-0.5 text-sm font-medium">{t.name}</div>
                            </div>
                            <button onClick={() => void archivar(t.id)} title="Archivar" className="text-ink-4 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <span className="rounded bg-surface-2 px-1.5 py-0.5">{TRABAJOS[t.brief.trabajo]?.label}</span>
                            <span className="rounded bg-surface-2 px-1.5 py-0.5">{t.brief.formato === 'video' ? 'Video' : 'Estático'}</span>
                            {t.persona_id && <span className="rounded bg-surface-2 px-1.5 py-0.5">{data.personas.find((p) => p.id === t.persona_id)?.name.split(' ')[0]}</span>}
                          </div>
                          {t.brief.mensaje && <p className="mt-2 text-ink-2">{t.brief.mensaje}</p>}
                          <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-ink-3">
                            {t.ejecuciones.map((e) => <li key={e.id}>{e.hook}</li>)}
                          </ol>

                          {(et.id === 'produccion' || et.id === 'prueba') && (
                            <div className="mt-2 space-y-1 rounded bg-surface-2 p-2">
                              <div className="text-ink-4">Nombres para Meta</div>
                              <CopyBtn text={`${t.code} | ${t.name}`} />
                              <div className="flex flex-wrap gap-1">{t.ejecuciones.map((e) => <CopyBtn key={e.id} text={e.ad_name} />)}</div>
                            </div>
                          )}

                          {r && (
                            <div className="mt-2 grid grid-cols-3 gap-1 rounded bg-surface-2 p-2 tabular-nums">
                              <div><div className="text-ink-4">Gasto</div>{money(r.spend)}</div>
                              <div><div className="text-ink-4">Compras</div>{r.purchases ?? 0}</div>
                              <div><div className="text-ink-4">CPA</div><span className={r.cpa != null && meta != null ? (r.cpa <= meta ? 'text-ok' : 'text-danger') : ''}>{money(r.cpa)}</span></div>
                              <div><div className="text-ink-4">ROAS</div>{num(r.roas)}</div>
                              <div><div className="text-ink-4">Días</div>{r.diasConGasto}</div>
                              <div><div className="text-ink-4">Hook</div>{r.hook != null ? `${Math.round(r.hook)}%` : '—'}</div>
                            </div>
                          )}
                          {et.id === 'prueba' && !r && <p className="mt-2 text-ink-4">Aún no hay anuncios en Meta con el código {t.code}.</p>}
                          {et.id === 'prueba' && dias != null && (
                            <p className={`mt-2 ${dias >= 8 ? 'font-medium text-accent' : 'text-ink-3'}`}>
                              {dias >= 8 ? `Día ${dias}: toca decidir. ¿La campaña completa mejoró su CPA?` : `Día ${dias} de 7 con mínimo de gasto.`}
                            </p>
                          )}
                          {et.id === 'decidido' && t.result?.decision && (
                            <p className={`mt-2 font-medium ${t.result.decision === 'gano' ? 'text-ok' : 'text-danger'}`}>
                              {t.result.decision === 'gano' ? 'Ganó' : 'Perdió'}{t.closed_note ? ` · ${t.closed_note}` : ''}
                            </p>
                          )}

                          <div className="mt-3 flex flex-wrap gap-1">
                            {et.id === 'idea' && <button onClick={() => void mover(t.id, 'produccion')} className="rounded bg-accent-soft px-2 py-1 text-accent">A producción →</button>}
                            {et.id === 'produccion' && <button onClick={() => void mover(t.id, 'prueba')} className="rounded bg-accent-soft px-2 py-1 text-accent">Ya está en Meta →</button>}
                            {et.id === 'prueba' && decidiendo !== t.id && <button onClick={() => setDecidiendo(t.id)} className="rounded bg-accent-soft px-2 py-1 text-accent">Decidir</button>}
                          </div>
                          {decidiendo === t.id && (
                            <div className="mt-2 space-y-2">
                              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Qué aprendimos (una línea)" className={input} />
                              <div className="flex gap-2">
                                <button onClick={() => void mover(t.id, 'decidido', 'gano')} className="flex-1 rounded bg-ok-soft px-2 py-1.5 font-medium text-ok">Ganó</button>
                                <button onClick={() => void mover(t.id, 'decidido', 'perdio')} className="flex-1 rounded bg-danger-soft px-2 py-1.5 font-medium text-danger">Perdió</button>
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
        )}

        <p className="mt-6 text-xs text-ink-4">
          Cómo se sube: un conjunto nuevo dentro de Prospecting con el nombre de la tarjeta, mínimo de gasto de {money(data?.economics.targetCpa)} al día durante 7 días, y 3 anuncios (uno por ejecución) con los 2 textos y los 2 titulares. ¿Dudas de qué toca? Revisa <Link href="/hoy" className="text-accent">Hoy</Link>.
        </p>
      </main>
    </div>
  );
}
