'use client';

// =============================================================================
// SyncBanner — la franja que aparece cuando los números que estás viendo no son
// los de hoy, o cuando los archivos de los creativos siguen colgando de Meta.
//
// POR QUÉ: las ventanas del panel se anclan al último día sincronizado. Con el
// sync roto, "Hoy" mostraba un día de la semana pasada sin decirlo, y la única
// pista era una línea gris de "Memoria:". Una semana entera de decisiones se
// tomó sobre datos viejos por no tener esta franja.
//
// No renderiza nada cuando todo está sano. Dos avisos posibles:
//   · rojo   — el último sync falló, o la cuenta lleva más de un día sin datos.
//   · ámbar  — hay creativos cuyo archivo todavía vive en la CDN de Meta; el
//              botón los copia al bucket por lotes hasta terminar.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, HardDriveDownload, RefreshCw } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface AccountState {
  check?: { account?: { ok: boolean; error: string | null } | null } | null;
  sync?: { last_synced_at: string | null; last_sync_error: string | null } | null;
}

const STALE_HOURS = 26;

export default function SyncBanner({ brandId }: { brandId: string | null }) {
  const t = useT();
  const [state, setState] = useState<AccountState | null>(null);
  const [pendientes, setPendientes] = useState(0);
  /** Horas desde el último sync, medidas al cargar: Date.now() en render no es puro. */
  const [horas, setHoras] = useState<number | null>(null);
  const [copiando, setCopiando] = useState(false);
  const [nota, setNota] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!brandId) return;
    try {
      const [a, m] = await Promise.all([
        fetch(`/api/meta/account?brand=${brandId}`).then((r) => r.json() as Promise<AccountState>),
        fetch(`/api/meta/mirror?brand=${brandId}`).then((r) => r.json() as Promise<{ restantes?: number }>),
      ]);
      setState(a);
      const last = a?.sync?.last_synced_at ? new Date(a.sync.last_synced_at).getTime() : null;
      setHoras(last ? (Date.now() - last) / 3_600_000 : null);
      setPendientes(Number(m?.restantes ?? 0));
    } catch { /* la franja es informativa: si falla, no estorba */ }
  }, [brandId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const copiar = useCallback(async () => {
    if (!brandId || copiando) return;
    setCopiando(true);
    setNota(null);
    let restantes = pendientes;
    let fallos = 0;
    try {
      // Lotes chicos en bucle: cada POST descarga de verdad y tiene techo de
      // tiempo. Se corta si una vuelta completa no avanza nada.
      for (let vuelta = 0; vuelta < 60 && restantes > 0; vuelta += 1) {
        const r = (await (await fetch('/api/meta/mirror', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandId, limit: 6 }),
        })).json()) as { guardados?: number; restantes?: number; fallidos?: { name: string }[] };
        const antes = restantes;
        restantes = Number(r?.restantes ?? 0);
        fallos += (r?.fallidos ?? []).length;
        setPendientes(restantes);
        if (!r?.guardados && restantes >= antes) break;
      }
      setNota(fallos > 0 ? t('sync.mirror.partial', { n: fallos }) : t('sync.mirror.done'));
    } catch {
      setNota(t('sync.mirror.failed'));
    } finally {
      setCopiando(false);
      void cargar();
    }
  }, [brandId, copiando, pendientes, t, cargar]);

  if (!brandId) return null;

  const err = state?.sync?.last_sync_error ?? null;
  const cuenta = state?.check?.account ?? null;
  const atrasado = horas != null && horas > STALE_HOURS;
  const roto = Boolean(err) || cuenta?.ok === false || atrasado;

  if (!roto && pendientes === 0 && !nota) return null;

  return (
    <div className="flex flex-col gap-2 mb-4">
      {roto && (
        <div className="flex items-start gap-2 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-danger shrink-0" />
          <div className="min-w-0">
            <p className="text-danger font-medium">
              {atrasado && !err
                ? t('sync.stale', { h: Math.round(horas ?? 0) })
                : t('sync.broken')}
            </p>
            <p className="text-ink-4 break-words">
              {err ?? cuenta?.error ?? t('sync.stale.hint')}
            </p>
          </div>
          <button
            onClick={() => void cargar()}
            className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs text-ink-4 hover:text-ink-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> {t('sync.recheck')}
          </button>
        </div>
      )}

      {pendientes > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warn bg-warn-soft px-3 py-2 text-sm">
          <HardDriveDownload className="w-4 h-4 text-warn shrink-0" />
          <p className="text-ink-2 min-w-0">{t('sync.mirror.pending', { n: pendientes })}</p>
          <button
            onClick={() => void copiar()}
            disabled={copiando}
            className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-on-accent disabled:opacity-60"
          >
            {copiando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HardDriveDownload className="w-3.5 h-3.5" />}
            {copiando ? t('sync.mirror.working') : t('sync.mirror.cta')}
          </button>
        </div>
      )}

      {nota && <p className="text-xs text-ink-4">{nota}</p>}
    </div>
  );
}
