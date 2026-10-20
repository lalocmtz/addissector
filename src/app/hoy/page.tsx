'use client';

// =============================================================================
// /hoy — lo primero que se ve al entrar. Tres preguntas, en este orden:
//   1. ¿Cómo va la cuenta? (hoy · ayer · 3 · 7 · 14 días, con margen real)
//   2. ¿Puedo subir presupuesto? (sí / no y por qué)
//   3. ¿Qué hago con cada creativo? (semáforo con una sola acción por luz)
// Las reglas viven en src/lib/semaforo.ts y salen de la economía de la marca.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw, TrendingUp, TrendingDown, Sparkles, Film, ImageIcon } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import type { Luz, Rol } from '@/lib/semaforo';

interface Ventana {
  id: string; label: string; desde: string; hasta: string;
  spend: number; revenue: number | null; purchases: number | null; roas: number | null; cpa: number | null;
  cpm: number | null; freq: number | null; aov: number | null; gpt: number | null; margen: number | null; margenPct: number | null;
}
interface Mini { spend: number; purchases: number | null; roas: number | null; cpa?: number | null; cpm?: number | null; freq?: number | null; hook?: number | null }
interface Anuncio {
  ad_id: string; nombre: string; campana: string | null; conjunto: string | null; thumbnail_url: string | null; kind: string | null;
  analizado: boolean; luz: Luz; color: 'verde' | 'ambar' | 'rojo' | 'gris'; titulo: string; porque: string; accion: string; cayendo: boolean;
  share14: number; gastaHoy: boolean; sinGasto3d: boolean; hoy: Mini | null; d3: Mini | null; d7: Mini | null; d14: Mini | null;
  gpt14: number | null; vidaGasto: number; vidaCompras: number | null; rol: Rol | null;
}
interface HoyData {
  empty?: boolean; marca: string; anchor: string; currency: string | null; lastSyncedAt: string | null; syncError: string | null;
  economics: { breakeven: number; target: number; targetCpa: number | null; contribucion: number | null; aov: number | null; unitCost: number | null };
  umbrales: { cpa: number; juicio: number; corte: number; killRoas: number; limitRoas: number };
  cuenta: Ventana[]; presupuesto: { subir: boolean; porque: string };
  anuncios: Anuncio[]; conteo: Record<Luz, number>;
  estructura: { anuncios7: number; anunciosConVenta7: number; conjuntos7: number; campanas7: number; porConjunto: number | null; topNombre: string | null; topShare: number | null };
  roles: Record<Rol, number>;
}

const ORDEN: Luz[] = ['escalar', 'iterar', 'apagar', 'limitar', 'debajo', 'mantener', 'sin_juicio'];
const LUZ_TXT: Record<Luz, string> = {
  escalar: 'Escalar', iterar: 'Foco: iterar', apagar: 'Apagar', limitar: 'Limitar',
  debajo: 'Debajo del equilibrio', mantener: 'Mantener', sin_juicio: 'Sin juicio',
};
const COLOR_CLS: Record<string, string> = {
  verde: 'bg-ok-soft text-ok', ambar: 'bg-warn-soft text-warn', rojo: 'bg-danger-soft text-danger', gris: 'bg-surface-2 text-ink-3',
};
const DOT: Record<string, string> = { verde: 'bg-ok', ambar: 'bg-warn', rojo: 'bg-danger', gris: 'bg-ink-4' };
const ROL_TXT: Record<Rol, string> = { arriba: 'Arriba', medio: 'Medio', abajo: 'Abajo', retargeting: 'Retargeting' };

const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-MX')}`);
const num = (n: number | null | undefined, d = 2) => (n == null ? '—' : n.toFixed(d));
const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`);

export default function HoyPage() {
  const { me, activeBrandId, activeBrand, setActiveBrandId } = useMe();
  const [data, setData] = useState<HoyData | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Luz | 'todos'>('todos');

  const cargar = useCallback(async () => {
    if (!activeBrandId) return;
    setCargando(true); setError(null);
    try {
      const r = await fetch(`/api/hoy?brand=${activeBrandId}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `Respondió ${r.status}`);
      setData(j as HoyData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    } finally {
      setCargando(false);
    }
  }, [activeBrandId]);

  useEffect(() => { void Promise.resolve().then(cargar); }, [cargar]);

  const lista = useMemo(() => {
    const xs = data?.anuncios ?? [];
    return filtro === 'todos' ? xs.filter((x) => x.luz !== 'sin_juicio') : xs.filter((x) => x.luz === filtro);
  }, [data, filtro]);

  const eco = data?.economics;
  const roasCls = (r: number | null | undefined) => {
    if (r == null || !eco) return 'text-ink';
    if (r >= eco.target) return 'text-ok font-semibold';
    if (r < eco.breakeven) return 'text-danger font-semibold';
    return 'text-warn';
  };

  return (
    <div className="min-h-screen bg-surface text-ink">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Hoy</h1>
            <p className="mt-1 text-sm text-ink-3">
              {data && !data.empty
                ? <>Datos al {data.anchor} (hoy es parcial). Equilibrio ROAS {num(eco?.breakeven)} · King Goal {num(eco?.target)} · CPA objetivo {money(eco?.targetCpa)}.</>
                : 'La cuenta, el presupuesto y qué hacer con cada creativo.'}
            </p>
          </div>
          <button onClick={() => void cargar()} disabled={cargando}
            className="inline-flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2 hover:text-ink disabled:opacity-50">
            {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Actualizar
          </button>
        </div>

        {error && <div className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
        {data?.syncError && <div className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">La sincronización con Meta falló: {data.syncError}</div>}
        {data?.empty && <div className="mt-6 rounded-xl bg-surface-2 p-6 text-sm text-ink-3">Esta marca todavía no tiene datos de Meta.</div>}

        {data && !data.empty && eco && (
          <>
            {/* 1 · La cuenta */}
            <section className="mt-6 overflow-x-auto rounded-xl border border-surface-2">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-surface-2 text-xs text-ink-3">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Cuenta</th>
                    {data.cuenta.map((c) => <th key={c.id} className="px-4 py-2 text-right font-medium">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-2">
                  {([
                    ['Gasto', (c: Ventana) => money(c.spend), null],
                    ['Compras', (c: Ventana) => (c.purchases ?? 0).toLocaleString('es-MX'), null],
                    ['ROAS', (c: Ventana) => num(c.roas), (c: Ventana) => roasCls(c.roas)],
                    ['CPA', (c: Ventana) => money(c.cpa), null],
                    ['Ticket (AOV)', (c: Ventana) => money(c.aov), null],
                    ['GPT (AOV − CPA)', (c: Ventana) => money(c.gpt), null],
                    ['Margen antes de fijos', (c: Ventana) => c.margen == null ? '—' : `${money(c.margen)} · ${pct(c.margenPct)}`, (c: Ventana) => (c.margen ?? 0) < 0 ? 'text-danger' : ''],
                    ['CPM', (c: Ventana) => money(c.cpm), null],
                    ['Frecuencia diaria', (c: Ventana) => num(c.freq), null],
                  ] as const).map(([label, f, cls]) => (
                    <tr key={label}>
                      <td className="px-4 py-2 text-ink-3">{label}</td>
                      {data.cuenta.map((c) => <td key={c.id} className={`px-4 py-2 text-right tabular-nums ${cls ? cls(c) : ''}`}>{f(c)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* 2 · Presupuesto */}
            <section className={`mt-4 flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${data.presupuesto.subir ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>
              {data.presupuesto.subir ? <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" /> : <TrendingDown className="mt-0.5 h-4 w-4 shrink-0" />}
              <div><span className="font-semibold">¿Subo presupuesto? {data.presupuesto.subir ? 'Sí.' : 'No.'}</span> {data.presupuesto.porque}</div>
            </section>

            {/* 3 · Estructura */}
            <section className="mt-4 grid gap-3 sm:grid-cols-4">
              {[
                ['Anuncios con gasto (7 d)', `${data.estructura.anuncios7}`, `${data.estructura.anunciosConVenta7} con venta`],
                ['Anuncios por conjunto', num(data.estructura.porConjunto, 1), 'Meta: 4 a 8', (data.estructura.porConjunto ?? 0) > 8],
                ['El anuncio más grande', pct(data.estructura.topShare), data.estructura.topNombre ?? '', (data.estructura.topShare ?? 0) > 0.15],
                ['Reparto por rol (14 d)', `${pct(data.roles.arriba)} arriba`, `${pct(data.roles.medio)} medio · ${pct(data.roles.abajo)} abajo · ${pct(data.roles.retargeting)} RTG`],
              ].map(([t, v, s, alerta]) => (
                <div key={t as string} className="rounded-xl bg-surface-2 p-4">
                  <div className="text-xs text-ink-4">{t as string}</div>
                  <div className={`mt-1 text-lg font-semibold ${alerta ? 'text-danger' : ''}`}>{v as string}</div>
                  <div className="truncate text-xs text-ink-3" title={s as string}>{s as string}</div>
                </div>
              ))}
            </section>

            {/* 4 · Semáforo */}
            <section className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Semáforo de creativos</h2>
                <Link href="/lanzar" className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent">
                  <Sparkles className="h-4 w-4" /> Ir a Lanzar
                </Link>
              </div>
              <p className="mt-1 text-xs text-ink-3">
                Anuncios con gasto en los últimos 7 días. Se juzga desde {money(data.umbrales.juicio)} de gasto en 14 días; se apaga con {money(data.umbrales.juicio)} sin compras o {money(data.umbrales.corte)} con ROAS menor a {num(data.umbrales.killRoas)}; se limita si se lleva 10% o más del gasto con ROAS menor a {num(data.umbrales.limitRoas)}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setFiltro('todos')}
                  className={`rounded-full px-3 py-1 text-xs ${filtro === 'todos' ? 'bg-ink text-surface' : 'bg-surface-2 text-ink-2'}`}>
                  Con juicio ({data.anuncios.filter((a) => a.luz !== 'sin_juicio').length})
                </button>
                {ORDEN.map((l) => (
                  <button key={l} onClick={() => setFiltro(l)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${filtro === l ? 'bg-ink text-surface' : 'bg-surface-2 text-ink-2'}`}>
                    <span className={`h-2 w-2 rounded-full ${DOT[l === 'escalar' || l === 'iterar' ? 'verde' : l === 'mantener' ? 'ambar' : l === 'sin_juicio' ? 'gris' : 'rojo']}`} />
                    {LUZ_TXT[l]} ({data.conteo[l] ?? 0})
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-2">
                {lista.length === 0 && <div className="rounded-xl bg-surface-2 p-6 text-sm text-ink-3">Nada en esta luz.</div>}
                {lista.map((a) => (
                  <div key={a.ad_id} className="flex gap-3 rounded-xl border border-surface-2 p-3">
                    <div className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                      {a.thumbnail_url
                        ? <img src={a.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        : <div className="flex h-full items-center justify-center text-ink-4">{a.kind === 'image' ? <ImageIcon className="h-5 w-5" /> : <Film className="h-5 w-5" />}</div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_CLS[a.color]}`}>{a.titulo}</span>
                        {a.cayendo && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs text-warn">Cayendo en 7 d</span>}
                        {a.rol && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-3">{ROL_TXT[a.rol]}</span>}
                        {a.sinGasto3d && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-4">Sin gasto en 3 d</span>}
                        {!a.analizado && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-4">Sin analizar</span>}
                      </div>
                      <div className="mt-1 truncate text-sm font-medium" title={a.nombre}>{a.nombre}</div>
                      <div className="truncate text-xs text-ink-4">{a.campana}{a.conjunto ? ` · ${a.conjunto}` : ''}</div>
                      <div className="mt-1 text-xs text-ink-2">{a.porque} <span className="text-ink-3">→ {a.accion}</span></div>
                    </div>
                    <div className="hidden shrink-0 grid-cols-4 gap-x-4 gap-y-1 text-right text-xs tabular-nums sm:grid">
                      <div className="text-ink-4">Hoy</div><div className="text-ink-4">3 d</div><div className="text-ink-4">7 d</div><div className="text-ink-4">14 d</div>
                      {[a.hoy, a.d3, a.d7, a.d14].map((w, i) => <div key={`r${i}`} className={roasCls(w?.roas)}>{num(w?.roas)}</div>)}
                      {[a.hoy, a.d3, a.d7, a.d14].map((w, i) => <div key={`s${i}`} className="text-ink-3">{money(w?.spend)}</div>)}
                      {[a.hoy, a.d3, a.d7, a.d14].map((w, i) => <div key={`p${i}`} className="text-ink-3">{w?.purchases ?? 0} c</div>)}
                    </div>
                    <div className="hidden w-28 shrink-0 text-right text-xs tabular-nums md:block">
                      <div className="text-ink-4">CPA 14 d</div><div>{money(a.d14?.cpa)}</div>
                      <div className="mt-1 text-ink-4">GPT · gasto</div><div>{money(a.gpt14)} · {pct(a.share14)}</div>
                      <div className="mt-1 text-ink-4">Hook · frec.</div><div>{a.d14?.hook != null ? `${num(a.d14.hook, 0)}%` : '—'} · {num(a.d14?.freq)}</div>
                    </div>
                    {(a.luz === 'iterar' || a.luz === 'escalar') && (
                      <Link href={`/lanzar?iterar=${a.ad_id}`} className="self-center rounded-lg bg-ok-soft px-3 py-2 text-xs font-medium text-ok">Iterar</Link>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {!data && cargando && <div className="mt-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-ink-3" /></div>}
      </main>
    </div>
  );
}
