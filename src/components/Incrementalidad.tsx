'use client';

// =============================================================================
// Incrementalidad — el panel que contesta las dos preguntas que la tabla de
// anuncios no puede contestar, por construcción:
//
//   · ¿El dinero que Meta se apunta existe en la tienda?
//   · ¿Qué devolvió el gasto que AGREGUÉ? (no el promedio: el último peso)
//
// El ROAS por anuncio siempre se lee sobre lo ya gastado, y sumarlo da un
// promedio que puede verse sano mientras cada peso nuevo se pierde. Aquí se
// comparan tramos completos de la misma duración: cuánto se movió el gasto,
// cuánto se movieron las ventas reales, y la división entre los dos.
//
// El panel NO inventa datos: si Triple Whale no está conectado o no hay dos
// tramos completos, lo dice y se calla.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, TrendingUp, Info } from 'lucide-react';
import { useT, useFormatters } from '@/lib/i18n';
import { SCALE_VERDICT, type Bucket, type MarginalStep, type ScaleVerdictId } from '@/lib/incrementality';

interface Respuesta {
  currency: string | null;
  fx: number | null;
  hasStore: boolean;
  triple: { lastSyncedAt: string | null; error: string | null; shop: string | null } | null;
  window: { size: number; buckets: number; from: string | null; to: string | null };
  headline: {
    spend: number; sales: number; mer: number | null;
    metaSpend: number; metaRevenue: number | null; metaRoas: number | null;
    gap: number | null; breakeven: number;
  };
  buckets: Bucket[];
  marginal: MarginalStep[];
  verdict: { id: ScaleVerdictId; why: string };
  error?: string;
}

const TONE: Record<'ok' | 'warn' | 'danger' | 'muted', string> = {
  ok: 'border-ok/40 bg-ok-soft text-ok',
  warn: 'border-warn/40 bg-warn-soft text-warn',
  danger: 'border-danger/40 bg-danger-soft text-danger',
  muted: 'border-line bg-surface-2 text-ink-3',
};

const SIZES = [7, 14] as const;

/** dd mmm, sin año: los tramos son cortos y el año solo estorba. */
function corto(iso: string, locale: 'es' | 'en'): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(locale === 'es' ? 'es-MX' : 'en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export default function Incrementalidad({ brandId, breakeven }: { brandId: string | null; breakeven: number }) {
  const t = useT();
  const f = useFormatters();
  const [abierto, setAbierto] = useState(true);
  const [size, setSize] = useState<number>(7);
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    // El await de entrada saca el primer setState del cuerpo del efecto: sin
    // esto React encadena un render extra en cada carga.
    await Promise.resolve();
    if (!brandId) { setData(null); return; }
    setCargando(true);
    try {
      const r = await fetch(`/api/incrementality?brand=${brandId}&size=${size}&buckets=8`);
      setData((await r.json()) as Respuesta);
    } catch {
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [brandId, size]);

  useEffect(() => { void Promise.resolve().then(cargar); }, [cargar]);

  const cur = data?.currency ?? null;

  if (!brandId) return null;

  const h = data?.headline;
  const merTone = h?.mer == null ? '' : h.mer >= h.breakeven ? 'text-ok' : 'text-danger';
  const ver = data?.verdict ? SCALE_VERDICT[data.verdict.id] : null;

  return (
    <div className="mb-5 rounded-md border border-line bg-surface">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
      >
        {abierto ? <ChevronDown className="w-4 h-4 text-ink-3" /> : <ChevronRight className="w-4 h-4 text-ink-3" />}
        <TrendingUp className="w-4 h-4 text-accent" />
        <span className="text-sm font-medium text-ink">{t('incr.title')}</span>
        {ver && data?.verdict && (
          <span className={`ml-1 text-[11px] px-2 py-0.5 rounded border ${TONE[ver.tone]}`}>{t(`incr.scale.${data.verdict.id}`)}</span>
        )}
        {cargando && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-4" />}
        <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {SIZES.map((s) => (
            <span
              key={s}
              role="button"
              tabIndex={0}
              onClick={() => setSize(s)}
              onKeyDown={(e) => { if (e.key === 'Enter') setSize(s); }}
              className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${size === s ? 'bg-surface-2 text-ink' : 'text-ink-4 hover:text-ink-2'}`}
            >
              {t('incr.size', { n: s })}
            </span>
          ))}
        </span>
      </button>

      {abierto && (
        <div className="px-4 pb-4 border-t border-line pt-3">
          <p className="text-xs text-ink-3 mb-3 max-w-3xl">{t('incr.intro')}</p>

          {!data?.hasStore ? (
            <p className="text-xs text-ink-3 flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              {t('incr.noStore')}
            </p>
          ) : (
            <>
              {/* Los tres números de cabecera */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <Celda
                  label={t('incr.mer')}
                  value={h?.mer != null ? h.mer.toFixed(2) : '—'}
                  cls={merTone}
                  hint={t('incr.mer.hint', { be: breakeven.toFixed(2) })}
                />
                <Celda
                  label={t('incr.metaRoas')}
                  value={h?.metaRoas != null ? h.metaRoas.toFixed(2) : '—'}
                  hint={t('incr.metaRoas.hint')}
                />
                <Celda
                  label={t('incr.gap')}
                  value={h?.gap != null ? `×${h.gap.toFixed(2)}` : '—'}
                  cls={h?.gap != null && h.gap > 1.15 ? 'text-danger' : ''}
                  hint={t('incr.gap.hint')}
                />
                <Celda
                  label={t('incr.spend')}
                  value={f.money(h?.spend ?? null, cur)}
                  hint={t('incr.spend.hint')}
                />
              </div>

              {/* El veredicto de escalamiento, en una línea que se puede actuar */}
              {data?.verdict && ver && (
                <div className={`rounded-md border px-3 py-2 mb-4 text-xs ${TONE[ver.tone]}`}>
                  <span className="font-medium">{t(`incr.scale.${data.verdict.id}`)}</span>
                  <span className="ml-2 opacity-90">{data.verdict.why}</span>
                </div>
              )}

              {/* La serie: es donde se ve la historia, no en un solo número */}
              {data && data.buckets.length > 0 && (
                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full text-xs tabular-nums whitespace-nowrap">
                    <thead>
                      <tr className="text-ink-3 border-b border-line">
                        <th className="text-left font-medium py-1.5 pr-3">{t('incr.col.period')}</th>
                        <th className="text-right font-medium py-1.5 px-2">{t('incr.col.spend')}</th>
                        <th className="text-right font-medium py-1.5 px-2">{t('incr.col.sales')}</th>
                        <th className="text-right font-medium py-1.5 px-2" title={t('incr.mer.hint', { be: breakeven.toFixed(2) })}>{t('incr.col.mer')}</th>
                        <th className="text-right font-medium py-1.5 px-2">{t('incr.col.dspend')}</th>
                        <th className="text-right font-medium py-1.5 px-2">{t('incr.col.dsales')}</th>
                        <th className="text-right font-medium py-1.5 pl-2" title={t('incr.col.marginal.tip')}>{t('incr.col.marginal')}</th>
                      </tr>
                    </thead>
                    <tbody className="font-[family-name:var(--font-mono)]">
                      {data.buckets.map((b, i) => {
                        const m = data.marginal.find((x) => x.from === b.from);
                        const parcial = b.days < data.window.size;
                        return (
                          <tr key={b.from} className={`border-b border-line/50 ${i === data.buckets.length - 1 ? 'text-ink' : 'text-ink-2'}`}>
                            <td className="py-1.5 pr-3 text-left font-[family-name:var(--font-sans)]">
                              {corto(b.from, 'es')}–{corto(b.to, 'es')}
                              {parcial && <span className="ml-1.5 text-[10px] text-ink-4">{t('incr.partial', { n: b.days })}</span>}
                            </td>
                            <td className="text-right px-2">{f.money(b.spend, cur)}</td>
                            <td className="text-right px-2">{f.money(b.sales, cur)}</td>
                            <td className={`text-right px-2 ${b.mer == null ? '' : b.mer >= breakeven ? 'text-ok' : 'text-danger'}`}>
                              {b.mer?.toFixed(2) ?? '—'}
                            </td>
                            <td className={`text-right px-2 ${m ? (m.dSpend >= 0 ? 'text-ink-3' : 'text-ink-4') : ''}`}>
                              {m ? `${m.dSpend >= 0 ? '+' : '−'}${f.money(Math.abs(m.dSpend), cur)}` : '—'}
                            </td>
                            <td className="text-right px-2 text-ink-3">
                              {m ? `${m.dSales >= 0 ? '+' : '−'}${f.money(Math.abs(m.dSales), cur)}` : '—'}
                            </td>
                            <td className={`text-right pl-2 font-semibold ${
                              m?.mroas == null ? 'text-ink-4'
                                : m.mroas >= breakeven ? 'text-ok'
                                : m.mroas >= 0 ? 'text-warn'
                                : 'text-danger'
                            }`}>
                              {m?.mroas != null ? m.mroas.toFixed(2) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-[10px] text-ink-4 mt-3 leading-relaxed max-w-3xl">
                {t('incr.footnote')}
                {data?.fx != null && data.fx > 1.05 && ` ${t('incr.fx', { fx: data.fx.toFixed(2), cur: cur ?? '' })}`}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Celda({ label, value, hint, cls }: { label: string; value: string; hint: string; cls?: string }) {
  return (
    <div className="rounded-md border border-line bg-canvas px-3 py-2" title={hint}>
      <p className="text-[10px] uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`text-lg font-semibold font-[family-name:var(--font-mono)] tabular-nums ${cls ?? 'text-ink'}`}>{value}</p>
      <p className="text-[10px] text-ink-4 mt-0.5 leading-snug">{hint}</p>
    </div>
  );
}
