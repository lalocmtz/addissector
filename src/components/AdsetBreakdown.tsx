'use client';

// =============================================================================
// Desglose por campaña / conjunto.
//
// La tabla de anuncios contesta "¿qué anuncio apago?". No contesta la pregunta
// de arriba: "¿de qué conjunto viene el problema?". Un conjunto puede tener
// quince anuncios decentes y aun así quemar la mitad del presupuesto porque
// Meta le está dando el gasto a los dos peores.
//
// Cada renglón es un conjunto (o una campaña) con TRES cosas juntas:
//   · lo que gastó y lo que devolvió en la ventana de 7 días,
//   · cuánto de ese gasto está en anuncios que ya deberían estar apagados,
//   · qué tan concentrado está: el % del gasto que se llevó su anuncio top.
//
// Clic en un renglón filtra la tabla de abajo a ese conjunto. Ese es el punto:
// ver el problema arriba y aterrizar en los anuncios que lo causan sin buscar.
// =============================================================================

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Layers, X } from 'lucide-react';
import { useT, useFormatters } from '@/lib/i18n';
import type { Economics } from '@/lib/meta';
import type { VerdictResult } from '@/lib/verdict';
import { SCALE_META, type Scalability, type ScaleId } from '@/lib/scalability';

export interface GroupableAd {
  ad_id: string;
  campaign_id?: string | null;
  campaign_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  status: string | null;
  verdict: VerdictResult;
  d7: { spend: number; revenue: number | null; purchases: number | null; roas: number | null } | null;
}

export type GroupBy = 'adset' | 'campaign';

/** Mismo lenguaje visual que la tabla de anuncios. */
const SCALE_STYLE: Record<ScaleId, string> = {
  aguanta: 'bg-ok-soft text-ok border-ok/40 font-semibold',
  aguanta_justo: 'bg-warn-soft text-warn border-warn/40',
  se_cae: 'bg-danger-soft text-danger border-danger/40',
  colapsa: 'bg-danger-soft text-danger border-danger/40 font-semibold',
  plano: 'bg-surface-2 text-ink-3 border-line border-dashed',
  sin_datos: 'bg-surface-2 text-ink-4 border-line',
};

interface Row {
  key: string;
  name: string;
  campaign: string | null;
  ads: number;
  activos: number;
  spend: number;
  revenue: number;
  purchases: number;
  roas: number | null;
  cpa: number | null;
  /** Gasto en anuncios cuyo veredicto es "apagar". Es el número accionable. */
  wasted: number;
  /** Proporción del gasto que se llevó el anuncio más caro del grupo. */
  top: number | null;
  /** Qué pasó con el grupo cuando le subieron el gasto. La calcula el servidor
   *  sobre la serie diaria del conjunto: no se puede promediar la de sus
   *  anuncios, porque el gasto del grupo se mueve cuando Meta lo redistribuye. */
  scale: Scalability | null;
}

function agrupa(ads: GroupableAd[], by: GroupBy, scales: Record<string, Scalability>): Row[] {
  const map = new Map<string, { row: Row; spends: number[] }>();
  for (const a of ads) {
    const key = (by === 'adset' ? a.adset_id ?? a.adset_name : a.campaign_id ?? a.campaign_name) ?? '—';
    const name = (by === 'adset' ? a.adset_name : a.campaign_name) ?? '(sin nombre)';
    const cur = map.get(key) ?? {
      row: {
        key, name, campaign: a.campaign_name ?? null,
        ads: 0, activos: 0, spend: 0, revenue: 0, purchases: 0,
        roas: null, cpa: null, wasted: 0, top: null,
        scale: scales[key] ?? null,
      },
      spends: [],
    };
    const s = a.d7?.spend ?? 0;
    cur.row.ads += 1;
    if (a.status?.toLowerCase().includes('active')) cur.row.activos += 1;
    cur.row.spend += s;
    cur.row.revenue += a.d7?.revenue ?? 0;
    cur.row.purchases += a.d7?.purchases ?? 0;
    if (a.verdict?.id === 'apagar') cur.row.wasted += s;
    cur.spends.push(s);
    map.set(key, cur);
  }
  const out: Row[] = [];
  for (const { row, spends } of map.values()) {
    row.roas = row.spend > 0 ? row.revenue / row.spend : null;
    row.cpa = row.purchases > 0 ? row.spend / row.purchases : null;
    row.top = row.spend > 0 ? Math.max(...spends) / row.spend : null;
    out.push(row);
  }
  return out.sort((a, b) => b.spend - a.spend);
}

export default function AdsetBreakdown({
  ads, eco, currency, groupBy, onGroupBy, selected, onSelect, scales,
}: {
  ads: GroupableAd[];
  /** Escalabilidad por clave de grupo, tal como la manda /api/meta/ads. */
  scales: Record<string, Scalability>;
  eco: Economics;
  currency: string | null;
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const t = useT();
  const f = useFormatters();
  const [abierto, setAbierto] = useState(true);

  const rows = useMemo(() => agrupa(ads, groupBy, scales), [ads, groupBy, scales]);
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalWasted = rows.reduce((s, r) => s + r.wasted, 0);

  if (!rows.length) return null;

  return (
    <div className="mb-5 rounded-md border border-line bg-surface">
      <button onClick={() => setAbierto((v) => !v)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
        {abierto ? <ChevronDown className="w-4 h-4 text-ink-3" /> : <ChevronRight className="w-4 h-4 text-ink-3" />}
        <Layers className="w-4 h-4 text-accent" />
        <span className="text-sm font-medium text-ink">{t(groupBy === 'adset' ? 'grp.title.adset' : 'grp.title.campaign')}</span>
        <span className="text-[11px] text-ink-3">
          {t('grp.subtitle', { n: rows.length, waste: f.money(totalWasted, currency), pct: totalSpend > 0 ? Math.round((totalWasted / totalSpend) * 100) : 0 })}
        </span>
        <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {(['adset', 'campaign'] as const).map((g) => (
            <span
              key={g}
              role="button"
              tabIndex={0}
              onClick={() => { onGroupBy(g); onSelect(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { onGroupBy(g); onSelect(null); } }}
              className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${groupBy === g ? 'bg-surface-2 text-ink' : 'text-ink-4 hover:text-ink-2'}`}
            >
              {t(g === 'adset' ? 'grp.by.adset' : 'grp.by.campaign')}
            </span>
          ))}
        </span>
      </button>

      {abierto && (
        <div className="border-t border-line overflow-x-auto">
          <table className="w-full text-xs tabular-nums whitespace-nowrap">
            <thead>
              <tr className="text-ink-3 border-b border-line">
                <th className="text-left font-medium py-2 px-3">{t(groupBy === 'adset' ? 'grp.col.adset' : 'grp.col.campaign')}</th>
                <th className="text-right font-medium py-2 px-2">{t('grp.col.ads')}</th>
                <th className="text-right font-medium py-2 px-2">{t('meta.col.spend7')}</th>
                <th className="text-right font-medium py-2 px-2">{t('meta.col.roas7')}</th>
                <th className="text-right font-medium py-2 px-2">{t('meta.col.cpa7')}</th>
                <th className="text-left font-medium py-2 px-2" title={t('meta.col.scale.tip')}>{t('meta.col.scale')}</th>
                <th className="text-right font-medium py-2 px-2" title={t('grp.col.wasted.tip')}>{t('grp.col.wasted')}</th>
                <th className="text-right font-medium py-2 px-3" title={t('grp.col.top.tip')}>{t('grp.col.top')}</th>
              </tr>
            </thead>
            <tbody className="font-[family-name:var(--font-mono)]">
              {rows.map((r) => {
                const pctWaste = r.spend > 0 ? r.wasted / r.spend : 0;
                const activo = selected === r.key;
                return (
                  <tr
                    key={r.key}
                    onClick={() => onSelect(activo ? null : r.key)}
                    className={`border-b border-line/50 cursor-pointer transition-colors ${activo ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
                  >
                    <td className="py-1.5 px-3 max-w-[340px] font-[family-name:var(--font-sans)]">
                      <div className="flex items-center gap-1.5">
                        {activo && <X className="w-3 h-3 text-accent shrink-0" />}
                        <span className="truncate text-ink" title={r.name}>{r.name}</span>
                      </div>
                      {groupBy === 'adset' && r.campaign && (
                        <span className="block truncate text-[10px] text-ink-4" title={r.campaign}>{r.campaign}</span>
                      )}
                    </td>
                    <td className="text-right px-2 text-ink-3">
                      {r.activos}<span className="text-ink-4">/{r.ads}</span>
                    </td>
                    <td className="text-right px-2 text-ink-2">{f.money(r.spend, currency)}</td>
                    <td className={`text-right px-2 font-semibold ${
                      r.roas == null ? 'text-ink-4' : r.roas >= eco.target ? 'text-ok' : r.roas < eco.breakeven ? 'text-danger' : 'text-ink-2'
                    }`}>
                      {r.roas?.toFixed(2) ?? '—'}
                    </td>
                    <td className="text-right px-2 text-ink-2">{r.cpa != null ? f.money(r.cpa, currency) : '—'}</td>
                    <td className="px-2 font-[family-name:var(--font-sans)]">
                      {r.scale && (
                        <span title={r.scale.why} className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${SCALE_STYLE[r.scale.id]}`}>
                          {SCALE_META[r.scale.id].short}
                          {r.scale.mroas != null ? ` ${r.scale.mroas.toFixed(2)}` : ''}
                        </span>
                      )}
                    </td>
                    <td
                      className={`text-right px-2 ${pctWaste >= 0.5 ? 'text-danger font-semibold' : pctWaste > 0 ? 'text-warn' : 'text-ink-4'}`}
                      style={pctWaste > 0 ? { background: `color-mix(in oklab, var(--color-danger) ${Math.round(pctWaste * 22)}%, transparent)` } : undefined}
                    >
                      {r.wasted > 0 ? `${f.money(r.wasted, currency)} · ${Math.round(pctWaste * 100)}%` : '—'}
                    </td>
                    <td className={`text-right px-3 ${r.top != null && r.top >= 0.6 ? 'text-warn' : 'text-ink-3'}`}>
                      {r.top != null ? `${Math.round(r.top * 100)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
