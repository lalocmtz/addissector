'use client';

// =============================================================================
// AdDNA — /app/cuenta: plan actual, uso del mes, Customer Portal y perfil.
// =============================================================================

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Loader2, CreditCard, Gauge, User, ExternalLink, Sparkles, AlertTriangle,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

const STATUS_LABEL: Record<string, string> = {
  trialing: 'En prueba',
  active: 'Activa',
  past_due: 'Pago pendiente',
  canceled: 'Cancelada',
};

export default function CuentaPage() {
  const { me, loading, activeBrand, setActiveBrandId } = useMe();
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const openPortal = async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error(data.error || 'No se pudo abrir el portal de facturación.');
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'No se pudo abrir el portal.');
      setPortalLoading(false);
    }
  };

  const usagePct =
    me?.usage && me.usage.limit > 0
      ? Math.min(100, (me.usage.used / me.usage.limit) * 100)
      : 0;

  const isTrial = me?.plan?.id === 'trial';
  const isProblem = me?.plan?.status === 'past_due' || me?.plan?.expired;

  return (
    <main className="flex-1">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />

      <section className="px-6 py-8">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold tracking-tight mb-6">Mi cuenta</h1>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-8 h-8 text-[#3b82f6] animate-spin" />
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {/* Plan */}
              <div className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <CreditCard className="w-4 h-4 text-[#3b82f6]" />
                  <h2 className="text-sm font-semibold">Tu plan</h2>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold">{me?.plan?.label ?? '—'}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          isProblem
                            ? 'bg-[#f43f5e]/15 text-[#fb7185]'
                            : 'bg-[#22c55e]/15 text-[#4ade80]'
                        }`}
                      >
                        {STATUS_LABEL[me?.plan?.status ?? ''] ?? me?.plan?.status}
                      </span>
                    </div>
                    <p className="text-xs text-[#94a3b8] mt-1">
                      {isTrial
                        ? `Tu prueba termina el ${fmtDate(me?.plan?.current_period_end ?? null)}.`
                        : `Se renueva el ${fmtDate(me?.plan?.current_period_end ?? null)}.`}
                    </p>
                  </div>
                  <div className="flex flex-col sm:items-end gap-2">
                    {isTrial ? (
                      <Link
                        href="/#precios"
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold gradient-blue text-white"
                      >
                        <Sparkles className="w-4 h-4" />
                        Elegir plan
                      </Link>
                    ) : (
                      <button
                        onClick={openPortal}
                        disabled={portalLoading}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-[#2e2e42] text-[#f1f5f9] hover:border-[#3b82f6]/50 transition-colors disabled:opacity-60"
                      >
                        {portalLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ExternalLink className="w-4 h-4" />
                        )}
                        Gestionar suscripción
                      </button>
                    )}
                    {portalError && <p className="text-xs text-[#f43f5e]">{portalError}</p>}
                  </div>
                </div>
                {isProblem && (
                  <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#f59e0b]/25 bg-[#f59e0b]/10 p-3">
                    <AlertTriangle className="w-4 h-4 text-[#fbbf24] shrink-0 mt-0.5" />
                    <p className="text-xs text-[#fbbf24] leading-relaxed">
                      {me?.plan?.expired && isTrial
                        ? 'Tu prueba terminó. Elige un plan para seguir analizando creativos.'
                        : 'Hay un problema con tu pago. Actualiza tu método de pago desde “Gestionar suscripción”.'}
                    </p>
                  </div>
                )}
              </div>

              {/* Uso */}
              <div className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Gauge className="w-4 h-4 text-[#8b5cf6]" />
                  <h2 className="text-sm font-semibold">Uso del mes</h2>
                </div>
                <div className="flex items-end justify-between mb-2">
                  <span className="text-2xl font-bold">
                    {me?.usage?.used ?? 0}
                    <span className="text-sm text-[#64748b] font-normal">
                      {' '}/ {me?.usage?.limit ?? '—'} análisis
                    </span>
                  </span>
                  <span className="text-xs text-[#94a3b8] font-[family-name:var(--font-mono)]">
                    quedan {me?.usage?.remaining ?? 0}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-[#1e1e2e] overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      usagePct >= 90 ? 'bg-[#f59e0b]' : 'bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6]'
                    }`}
                    style={{ width: `${usagePct}%` }}
                  />
                </div>
                <p className="text-xs text-[#64748b] mt-2">
                  El contador se reinicia el día 1 de cada mes. Un análisis = un video o una imagen.
                </p>
              </div>

              {/* Perfil */}
              <div className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <User className="w-4 h-4 text-[#22c55e]" />
                  <h2 className="text-sm font-semibold">Perfil</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Nombre</span>
                    <p className="text-sm text-[#f1f5f9] mt-0.5">
                      {me?.user?.full_name || '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Correo</span>
                    <p className="text-sm text-[#f1f5f9] mt-0.5">{me?.user?.email || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Marcas</span>
                    <p className="text-sm text-[#f1f5f9] mt-0.5">
                      {me?.brands?.length ?? 0}
                      {me?.plan?.max_brands ? ` de ${me.plan.max_brands}` : ' (ilimitadas)'}
                      {' · '}
                      <Link href="/app/marcas" className="text-[#3b82f6] hover:underline">
                        gestionar
                      </Link>
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Sesión</span>
                    <p className="text-sm mt-0.5">
                      <Link href="/logout" className="text-[#f43f5e] hover:underline">
                        Cerrar sesión
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </section>
    </main>
  );
}
