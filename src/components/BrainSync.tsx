'use client';

// =============================================================================
// BrainSync — el puente entre los analisis y el Cerebro.
//
// Cada creativo analizado deja un `creatives.analysis`; de ahi salen personas,
// angulos, hooks y aprendizajes. La ingesta corre sola al terminar cada
// analisis, pero si algo se cae a media corrida los analisis quedan leidos a
// medias y no habia forma manual de ponerse al dia.
//
// Este componente muestra SIEMPRE el estado (al dia / N sin leer) y deja un
// boton que fuerza la puesta al dia llamando /api/brain/ingest/backfill en
// bucle hasta que no quede nada. Se monta en Cerebro y en Meta - Barrido.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Brain, Loader2 } from 'lucide-react';

interface Counts { personas: number; angles: number; hooks: number; learnings: number }

export default function BrainSync({ brandId }: { brandId: string | null }) {
  const [pending, setPending] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    await Promise.resolve();
    if (!brandId) { setPending(0); return; }
    try {
      const r = await fetch(`/api/brain/ingest?brand=${brandId}`);
      const d = await r.json();
      setPending(Number(d.pending) || 0);
    } catch {
      setPending(0);
    }
  }, [brandId]);

  // La carga va dentro de un microtask: así el efecto nunca hace setState síncrono.
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const run = async () => {
    if (!brandId || running) return;
    setRunning(true);
    setResult(null);
    const acc: Counts = { personas: 0, angles: 0, hooks: 0, learnings: 0 };
    // Relee el pendiente REAL antes de empezar: el boton debe servir aunque el
    // contador en pantalla diga 0 porque acabas de analizar en otra pestana.
    let left = pending;
    try {
      const r0 = await fetch(`/api/brain/ingest?brand=${brandId}`);
      left = Number(((await r0.json()) as { pending?: number }).pending) || 0;
    } catch { /* nos quedamos con lo que ya teniamos */ }
    setPending(left);
    setTotal(left);
    setDone(0);
    if (left === 0) {
      setResult('El cerebro ya habia leido todos los analisis. No habia nada nuevo.');
      setRunning(false);
      return;
    }
    try {
      // Se llama en bucle hasta que no quede nada. El backfill procesa de 8 en 8
      // para no pasarse del tiempo de la función.
      for (let i = 0; i < 40 && left > 0; i++) {
        const res = await fetch('/api/brain/ingest/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandId }),
        });
        const d = (await res.json()) as {
          processed?: number; remaining?: number; created?: Counts;
        };
        for (const k of ['personas', 'angles', 'hooks', 'learnings'] as const) {
          acc[k] += d.created?.[k] ?? 0;
        }
        const remaining = Number(d.remaining) || 0;
        setDone((v) => v + (Number(d.processed) || 0));
        setPending(remaining);
        // Si no avanzó, no tiene caso seguir dándole vueltas.
        if (!d.processed || remaining >= left) { left = 0; break; }
        left = remaining;
      }
      const parts: string[] = [];
      if (acc.personas) parts.push(`${acc.personas} persona${acc.personas > 1 ? 's' : ''}`);
      if (acc.angles) parts.push(`${acc.angles} ángulo${acc.angles > 1 ? 's' : ''}`);
      if (acc.hooks) parts.push(`${acc.hooks} hook${acc.hooks > 1 ? 's' : ''}`);
      if (acc.learnings) parts.push(`${acc.learnings} aprendizaje${acc.learnings > 1 ? 's' : ''}`);
      setResult(parts.length ? `El cerebro guardó ${parts.join(', ')}.` : 'El cerebro leyó todo: no había nada nuevo que guardar.');
    } catch {
      setResult('Algo falló leyendo los análisis. Vuelve a intentarlo.');
    } finally {
      setRunning(false);
      await load();
    }
  };

  // Antes se escondia cuando no habia pendientes, y por eso parecia que el
  // boton no existia. Ahora siempre esta a la vista: saber que el Cerebro esta
  // al dia es tan util como saber que le falta leer algo.
  if (!brandId) return null;

  return (
    <div className="mb-4 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <p className="text-xs text-ink flex items-center gap-2 break-words">
          <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
          {running
            ? `Leyendo tus anuncios ganadores… ${done}${total ? ` de ${total}` : ''}`
            : pending > 0
              ? `Tienes ${pending} análisis que el cerebro todavía no ha leído`
              : 'El cerebro está al día'}
        </p>
        <p className="text-[10px] text-ink-4 mt-0.5 break-words">
          {result ?? 'De los análisis de tus anuncios salen las personas, los ángulos, los hooks y los aprendizajes.'}
        </p>
      </div>
      <button
        onClick={run}
        disabled={running}
        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg gradient-blue text-on-accent disabled:opacity-60 shrink-0"
      >
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
        {running ? 'Leyendo…' : pending > 0 ? 'Alimentar el cerebro' : 'Revisar y alimentar'}
      </button>
    </div>
  );
}
