// =============================================================================
// AdDNA — Gating de uso: verifica el límite mensual del plan antes de analizar
// e incrementa el contador solo cuando el análisis fue exitoso.
// =============================================================================

import { NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import {
  currentPeriodStart,
  resolveEffectivePlan,
  type EffectivePlan,
  type SubscriptionRow,
} from '@/lib/plans';

export interface UsageSnapshot {
  used: number;
  limit: number;
  remaining: number;
  periodStart: string;
  plan: EffectivePlan;
}

/** Lee suscripción + contador del mes para un usuario. */
export async function getUsageSnapshot(userId: string): Promise<UsageSnapshot> {
  const sb = getSupabase();
  const period = currentPeriodStart();

  const [{ data: sub }, { data: counter }] = await Promise.all([
    sb.from('subscriptions').select('*').eq('user_id', userId).maybeSingle(),
    sb
      .from('usage_counters')
      .select('analyses_used')
      .eq('user_id', userId)
      .eq('period_start', period)
      .maybeSingle(),
  ]);

  const plan = resolveEffectivePlan((sub as SubscriptionRow | null) ?? null);
  const used = counter?.analyses_used ?? 0;
  const limit = plan.limits.analysesPerMonth;
  return { used, limit, remaining: Math.max(0, limit - used), periodStart: period, plan };
}

export type GateResult =
  | { ok: true; userId: string; snapshot: UsageSnapshot }
  | { ok: false; response: NextResponse };

/**
 * Verifica sesión + límite del plan. Devuelve 401 sin sesión y 402 si excede.
 * Si Supabase/Auth no están configurados (dev local), deja pasar sin gating.
 */
export async function gateAnalysis(): Promise<GateResult> {
  if (!isSupabaseConfigured() || !isAuthConfigured()) {
    return { ok: true, userId: '', snapshot: emptySnapshot() };
  }

  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Inicia sesión para analizar creativos.' },
        { status: 401 }
      ),
    };
  }

  // Plataforma personal: sin planes ni límites de uso.
  return { ok: true, userId: user.id, snapshot: emptySnapshot() };
}

/** Incrementa el contador del mes. Llamar SOLO tras un análisis exitoso. */
export async function recordAnalysisUsage(userId: string): Promise<void> {
  if (!userId || !isSupabaseConfigured()) return;
  try {
    const sb = getSupabase();
    const { error } = await sb.rpc('increment_usage', {
      p_user_id: userId,
      p_period: currentPeriodStart(),
    });
    if (error) throw error;
  } catch (err) {
    // El contador nunca debe tirar un análisis ya exitoso.
    console.error('[usage] No se pudo incrementar el contador:', err);
  }
}

function emptySnapshot(): UsageSnapshot {
  return {
    used: 0,
    limit: Infinity,
    remaining: Infinity,
    periodStart: currentPeriodStart(),
    plan: {
      plan: 'trial',
      status: 'trialing',
      limits: { analysesPerMonth: Infinity, maxBrands: Infinity, label: 'Dev' },
      expired: false,
      currentPeriodEnd: null,
    },
  };
}
