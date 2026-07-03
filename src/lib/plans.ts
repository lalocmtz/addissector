// =============================================================================
// AdDNA — Planes, límites y resolución del plan efectivo del usuario.
// =============================================================================

export type PlanId = 'trial' | 'starter' | 'growth' | 'scale' | 'founder';

export interface PlanLimits {
  analysesPerMonth: number;
  maxBrands: number; // Infinity = ilimitadas
  label: string;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  trial:   { analysesPerMonth: 3,   maxBrands: 1,        label: 'Prueba gratis' },
  starter: { analysesPerMonth: 30,  maxBrands: 1,        label: 'Starter' },
  growth:  { analysesPerMonth: 150, maxBrands: 3,        label: 'Growth' },
  scale:   { analysesPerMonth: 500, maxBrands: Infinity, label: 'Scale' },
  founder: { analysesPerMonth: Infinity, maxBrands: Infinity, label: 'Founder' },
};

export interface SubscriptionRow {
  user_id: string;
  plan: string;
  status: string;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
}

export interface EffectivePlan {
  plan: PlanId;
  status: string;
  limits: PlanLimits;
  /** true si el trial expiró o la suscripción está cancelada → sin análisis */
  expired: boolean;
  currentPeriodEnd: string | null;
}

/** Primer día del mes actual en formato YYYY-MM-DD (UTC). */
export function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Resuelve el plan efectivo a partir de la fila de subscriptions (o null). */
export function resolveEffectivePlan(sub: SubscriptionRow | null): EffectivePlan {
  const planId: PlanId = (['trial', 'starter', 'growth', 'scale', 'founder'] as PlanId[]).includes(
    (sub?.plan ?? 'trial') as PlanId
  )
    ? ((sub?.plan ?? 'trial') as PlanId)
    : 'trial';
  const status = sub?.status ?? 'trialing';
  const periodEnd = sub?.current_period_end ?? null;

  let expired = false;
  if (status === 'canceled') expired = true;
  if (planId === 'trial' && periodEnd && new Date(periodEnd).getTime() < Date.now()) {
    expired = true;
  }

  return {
    plan: planId,
    status,
    limits: PLAN_LIMITS[planId],
    expired,
    currentPeriodEnd: periodEnd,
  };
}

/** Mapea un Stripe price ID a su plan usando las envs STRIPE_PRICE_*. */
export function planFromStripePrice(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  const map: Array<[string, PlanId]> = [
    ['STRIPE_PRICE_STARTER_MONTHLY', 'starter'],
    ['STRIPE_PRICE_STARTER_ANNUAL', 'starter'],
    ['STRIPE_PRICE_GROWTH_MONTHLY', 'growth'],
    ['STRIPE_PRICE_GROWTH_ANNUAL', 'growth'],
    ['STRIPE_PRICE_SCALE_MONTHLY', 'scale'],
    ['STRIPE_PRICE_SCALE_ANNUAL', 'scale'],
  ];
  for (const [env, plan] of map) {
    if (process.env[env] && process.env[env] === priceId) return plan;
  }
  return null;
}
