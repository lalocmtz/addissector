import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { planFromStripePrice, type PlanId } from '@/lib/plans';
import { stripeGet } from '@/lib/stripe';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// POST /api/stripe/webhook — sincroniza el ciclo de vida de la suscripción.
// Eventos: checkout.session.completed, customer.subscription.updated/deleted.
// Configura en Stripe un webhook hacia https://tudominio.com/api/stripe/webhook
// y pon el signing secret en STRIPE_WEBHOOK_SECRET.
// ---------------------------------------------------------------------------

function verifyStripeSignature(payload: string, header: string, secret: string): boolean {
  // Header format: t=timestamp,v1=signature[,v1=...]
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=') as [string, string])
  );
  const timestamp = parts['t'];
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  const provided = parts['v1'] ?? '';
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

interface StripeSubscriptionObject {
  id?: string;
  customer?: string;
  status?: string;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> };
}

interface StripeCheckoutSessionObject {
  id?: string;
  customer?: string;
  subscription?: string;
  metadata?: Record<string, string>;
}

/** Mapea el status de Stripe a nuestro set (trialing|active|past_due|canceled). */
function mapStatus(stripeStatus: string | undefined): string {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    default:
      return 'canceled'; // canceled | unpaid | incomplete_expired | paused
  }
}

/** Encuentra el user_id: primero metadata, luego profiles.stripe_customer_id. */
async function resolveUserId(
  metadata: Record<string, string> | undefined,
  customerId: string | undefined
): Promise<string | null> {
  if (metadata?.user_id) return metadata.user_id;
  if (!customerId) return null;
  const sb = getSupabase();
  const { data } = await sb
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data?.id ?? null;
}

async function upsertSubscription(opts: {
  userId: string;
  plan: PlanId | null;
  status: string;
  stripeSubscriptionId: string | null;
  currentPeriodEndEpoch: number | null;
}) {
  const sb = getSupabase();
  const row: Record<string, unknown> = {
    user_id: opts.userId,
    status: opts.status,
    stripe_subscription_id: opts.stripeSubscriptionId,
    current_period_end: opts.currentPeriodEndEpoch
      ? new Date(opts.currentPeriodEndEpoch * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  };
  if (opts.plan) row.plan = opts.plan;

  const { error } = await sb.from('subscriptions').upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
}

/** Extrae plan y period_end de un objeto subscription de Stripe. */
function extractFromSubscription(sub: StripeSubscriptionObject): {
  plan: PlanId | null;
  periodEnd: number | null;
} {
  const priceId = sub.items?.data?.[0]?.price?.id;
  const plan =
    planFromStripePrice(priceId) ??
    ((['starter', 'growth', 'scale'] as PlanId[]).includes(sub.metadata?.tier as PlanId)
      ? (sub.metadata?.tier as PlanId)
      : null);
  // API 2025+: current_period_end vive en el item; versiones previas, en la raíz.
  const periodEnd =
    sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
  return { plan, periodEnd };
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get('stripe-signature');
  const payload = await request.text();

  if (!secret) {
    // Aún no configurado — responde 200 para que Stripe no reintente por siempre.
    return NextResponse.json({ received: true, configured: false });
  }
  if (!signature || !verifyStripeSignature(payload, signature, secret)) {
    return NextResponse.json({ error: 'Firma inválida' }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase no está configurado' }, { status: 500 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = (event.data?.object ?? {}) as StripeCheckoutSessionObject;
        const userId = await resolveUserId(session.metadata, session.customer);
        if (!userId) break;

        // Trae la suscripción real para obtener status, precio y period_end.
        let plan: PlanId | null =
          (['starter', 'growth', 'scale'] as PlanId[]).includes(
            session.metadata?.tier as PlanId
          )
            ? (session.metadata?.tier as PlanId)
            : null;
        let status = 'active';
        let periodEnd: number | null = null;

        if (session.subscription) {
          try {
            const sub = await stripeGet<StripeSubscriptionObject>(
              `/subscriptions/${session.subscription}`
            );
            const extracted = extractFromSubscription(sub);
            plan = extracted.plan ?? plan;
            periodEnd = extracted.periodEnd;
            status = mapStatus(sub.status);
          } catch (err) {
            console.error('[stripe] No se pudo leer la suscripción:', err);
          }
        }

        await upsertSubscription({
          userId,
          plan,
          status,
          stripeSubscriptionId: session.subscription ?? null,
          currentPeriodEndEpoch: periodEnd,
        });
        console.log('[stripe] checkout.session.completed →', userId, plan, status);
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = (event.data?.object ?? {}) as StripeSubscriptionObject;
        const userId = await resolveUserId(sub.metadata, sub.customer);
        if (!userId) break;

        const { plan, periodEnd } = extractFromSubscription(sub);
        const status =
          event.type === 'customer.subscription.deleted' ? 'canceled' : mapStatus(sub.status);

        await upsertSubscription({
          userId,
          plan,
          status,
          stripeSubscriptionId: sub.id ?? null,
          currentPeriodEndEpoch: periodEnd,
        });
        console.log('[stripe]', event.type, '→', userId, plan, status);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('[stripe] Error procesando webhook:', err);
    return NextResponse.json({ error: 'Error procesando el evento' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
