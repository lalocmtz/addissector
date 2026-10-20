'use client';

// =============================================================================
// /lanzar — de "qué necesita la cuenta" a "qué subo".
//
//   1. Qué necesita la cuenta + qué hay pendiente (de Hoy y de los lotes).
//   2. Tengo una idea: 4 pestañas — ¿Dónde encaja? · Adaptar referencia
//      (estáticos con Kie.ai) · Guiones (video, por talento) · Iterar ganador.
//      Todas terminan en un lote ya armado que solo se revisa.
//   3. El tablero: Idea → En producción → En prueba → Decidido.
//
// Un lote = 1 concepto × 1 avatar × 1 trabajo, 3 a 6 anuncios con 2 textos y
// 2 titulares. Conjunto "FI-012 | RUBEN | VS-CALCOMANIA | ATENCION", anuncios
// "FI-012-A1…": el código une Meta con la plataforma y los resultados se leen
// solos. Se lee a los 7 días y se decide el día 8.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Lightbulb, ImageIcon, Clapperboard, Repeat } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { type Etapa, type Persona, type Puerta, type Semilla, type LoteBorrador, type Ganador, BORRADOR_VACIO, money } from '@/components/lanzar/comun';
import Necesidades, { type Necesidad, type Pendientes } from '@/components/lanzar/Necesidades';
import EncajeIdea from '@/components/lanzar/Encaje';
import Adaptador from '@/components/lanzar/Adaptador';
import Guiones from '@/components/lanzar/Guiones';
import Iterar from '@/components/lanzar/Iterar';
import LoteEditor from '@/components/lanzar/LoteEditor';
import Tablero, { type Tarjeta } from '@/components/lanzar/Tablero';

interface LanzarData {
  economics: { breakeven: number; target: number; targetCpa: number | null };
  prefijo: string; tarjetas: Tarjeta[];
  personas: (Persona & { callout: string | null })[];
}

const PUERTAS: { id: Puerta; label: string; icon: typeof Lightbulb; ayuda: string }[] = [
  { id: 'idea', label: '¿Dónde encaja?', icon: Lightbulb, ayuda: 'Escribe la idea suelta y te digo a qué puerta va' },
  { id: 'adaptar', label: 'Adaptar referencia', icon: ImageIcon, ayuda: 'Un estático que te gustó → 3 versiones Feel Ink' },
  { id: 'guiones', label: 'Guiones', icon: Clapperboard, ayuda: 'Para grabar: founder, modelos o creadores' },
  { id: 'iterar', label: 'Iterar ganador', icon: Repeat, ayuda: 'Lo que el semáforo marcó en verde' },
];

export default function LanzarPage() {
  const { me, activeBrandId, activeBrand, setActiveBrandId } = useMe();
  const [data, setData] = useState<LanzarData | null>(null);
  const [nec, setNec] = useState<{ necesidades: Necesidad[]; pendientes: Pendientes; ganadores: Ganador[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [cargandoNec, setCargandoNec] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ahora, setAhora] = useState(0);
  const [puerta, setPuerta] = useState<Puerta>('idea');
  const [semilla, setSemilla] = useState<Semilla>({});
  const [vuelta, setVuelta] = useState(0); // re-monta la puerta con la semilla nueva
  const [borrador, setBorrador] = useState<LoteBorrador | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resaltar, setResaltar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!activeBrandId) return;
    setCargando(true); setError(null);
    try {
      const r = await fetch(`/api/lanzar?brand=${activeBrandId}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Respondió ${r.status}`);
      setData(j as LanzarData);
      setAhora(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    } finally {
      setCargando(false);
    }
  }, [activeBrandId]);

  const cargarNec = useCallback(async () => {
    if (!activeBrandId) return;
    setCargandoNec(true);
    try {
      const r = await fetch(`/api/lanzar/necesidades?brand=${activeBrandId}`, { cache: 'no-store' });
      const j = await r.json();
      if (r.ok) {
        setNec(j);
        // ?iterar=<ad_id> llega desde Hoy: abre la puerta Iterar con ese anuncio.
        const q = new URLSearchParams(window.location.search).get('iterar');
        if (q) {
          const g = (j.ganadores as Ganador[]).find((x) => x.ad_id === q);
          abrir('iterar', { adId: q, adNombre: g?.nombre ?? undefined });
          window.history.replaceState(null, '', '/lanzar');
        }
      }
    } finally {
      setCargandoNec(false);
    }
  }, [activeBrandId]);

  useEffect(() => { void Promise.resolve().then(() => { void cargar(); void cargarNec(); }); }, [cargar, cargarNec]);

  function abrir(p: Puerta, s: Semilla = {}) {
    setPuerta(p); setSemilla(s); setVuelta((v) => v + 1); setBorrador(null);
    setTimeout(() => document.getElementById('puertas')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function aLote(b: LoteBorrador) {
    setBorrador(b);
    setTimeout(() => document.getElementById('lote')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function mover(id: string, etapa: Etapa, decision?: 'gano' | 'perdio', nota?: string) {
    setError(null);
    const r = await fetch('/api/lanzar', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, etapa, decision, nota: nota || undefined }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? 'No se pudo mover'); return; }
    await Promise.all([cargar(), cargarNec()]);
  }

  async function archivar(id: string) {
    await fetch(`/api/lanzar?id=${id}`, { method: 'DELETE' });
    await Promise.all([cargar(), cargarNec()]);
  }

  const personas: Persona[] = data?.personas ?? [];
  const ganadores = nec?.ganadores ?? [];

  return (
    <div className="min-h-screen bg-surface text-ink">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Lanzar</h1>
            <p className="mt-1 text-sm text-ink-3">Qué necesita la cuenta, qué hay pendiente y qué lanzamos. Un lote = 1 concepto × 1 avatar × 1 trabajo, de 3 a 6 anuncios.</p>
          </div>
          <button onClick={() => aLote({ ...BORRADOR_VACIO })} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink-2 hover:text-ink">
            <Plus className="h-4 w-4" /> Lote a mano
          </button>
        </div>

        {error && <div className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
        {aviso && <div className="mt-4 rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">{aviso}</div>}

        <Necesidades
          necesidades={nec?.necesidades ?? null}
          pendientes={nec?.pendientes ?? null}
          cargando={cargandoNec}
          onAccion={(p, s) => {
            if (p === 'decidir') {
              setResaltar(s.loteId ?? null);
              setTimeout(() => document.getElementById(`lote-${s.loteId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
              return;
            }
            abrir(p, s);
          }}
        />

        {/* Tengo una idea: las puertas */}
        <section id="puertas" className="mt-6 rounded-xl bg-surface-2 p-4">
          <h2 className="text-sm font-semibold">Tengo una idea</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {PUERTAS.map((p) => {
              const Icon = p.icon;
              return (
                <button key={p.id} onClick={() => abrir(p.id)} title={p.ayuda}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${puerta === p.id ? 'bg-accent text-on-accent' : 'bg-surface text-ink-2 hover:text-ink'}`}>
                  <Icon className="h-4 w-4" /> {p.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-4">{PUERTAS.find((p) => p.id === puerta)?.ayuda}</p>
          <div className="mt-4">
            {!activeBrandId ? null
              : puerta === 'idea' ? <EncajeIdea key={vuelta} brandId={activeBrandId} onPuerta={(p, s) => abrir(p, s)} onManual={aLote} />
              : puerta === 'adaptar' ? <Adaptador key={vuelta} brandId={activeBrandId} semilla={semilla} onLote={aLote} />
              : puerta === 'guiones' ? <Guiones key={vuelta} brandId={activeBrandId} personas={personas} semilla={semilla} onLote={aLote} />
              : (
                <Iterar ganadores={ganadores} marcado={semilla.adId}
                  onGuiones={(g) => abrir('guiones', { adId: g.ad_id, adNombre: g.nombre ?? undefined, enfoque: 'iterar' })}
                  onEstatico={(g) => abrir('adaptar', { adId: g.ad_id, adNombre: g.nombre ?? undefined, referenciaUrl: g.thumbnail_url ?? undefined })}
                  onManual={(g) => aLote({ ...BORRADOR_VACIO, fuente: 'iterar', tipo: 'iteracion', origenAdId: g.ad_id, origenNombre: g.nombre ?? '', concepto: g.nombre ?? '', formato: g.kind === 'image' ? 'estatico' : 'video' })}
                />
              )}
          </div>
        </section>

        <div id="lote">
          {borrador && data && activeBrandId && (
            <LoteEditor key={JSON.stringify(borrador).length + borrador.concepto} brandId={activeBrandId} prefijo={data.prefijo} personas={personas}
              inicial={borrador} targetCpa={data.economics.targetCpa}
              onCerrar={() => setBorrador(null)}
              onCreado={(code, lote) => {
                setBorrador(null);
                setAviso(`Lote ${code} creado: ${lote}. Está en Idea; pásalo a producción cuando se empiece a grabar o diseñar.`);
                void cargar(); void cargarNec();
              }} />
          )}
        </div>

        {cargando && !data && <div className="mt-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-ink-3" /></div>}
        {data && (
          <Tablero key={resaltar ?? 'tablero'} tarjetas={data.tarjetas} personas={personas} targetCpa={data.economics.targetCpa} ahora={ahora} resaltar={resaltar}
            onMover={mover} onArchivar={archivar} />
        )}

        <p className="mt-6 text-xs text-ink-4">
          Cómo se sube: un conjunto nuevo dentro de Prospecting con el nombre del lote, mínimo de gasto de {money(data?.economics.targetCpa)} al día durante 7 días, y un anuncio por ejecución con los 2 textos y los 2 titulares. Se lee el lote completo a los 7 días y se decide el día 8. ¿Dudas de qué toca? Revisa <Link href="/hoy" className="text-accent">Hoy</Link>.
        </p>
      </main>
    </div>
  );
}
