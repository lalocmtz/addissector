import { NextRequest, NextResponse } from 'next/server';
import { TIERS, type BillingCycle } from '@/lib/brand';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import { getOrCreateStripeCustomer, isStripeConfigured, siteUrl, stripePost } from '@/lib/stripe';

export const runtime = 'nodejs';
export const maxDuration = 20;

// ---------------------------------------------------------------------------
// POST /api/checkout — crea una Stripe Checkout Session (suscripción) para el
// usuario logueado, creando/reusando su stripe_customer_id.
// ---------------------------------------------------------------------------

interface CheckoutBody {
  tier?: string;
  cycle?: BillingCycle;
}

export async function POST(request: NextRequest) {
  try {
    const { tier, cycle = 'monthly' } = (await request.json()) as CheckoutBody;

    if (!isStripeConfigured()) {
      return NextResponse.json({ url: null, configured: false });
    }

    const tierDef = TIERS.find((t) => t.id === tier);
    if (!tierDef) {
      return NextResponse.json({ error: 'Plan inválido' }, { status: 400 });
    }

    const priceEnvName =
      cycle === 'annual' ? tierDef.stripePriceEnvAnnual : tierDef.stripePriceEnvMonthly;
    const priceId = process.env[priceEnvName];
    if (!priceId) {
      // Secret key presente pero este precio aún no está configurado.
      return NextResponse.json({ url: null, configured: false });
    }

    // Requiere sesión: el checkout se liga a la cuenta del usuario.
    if (!isAuthConfigured() || !isSupabaseConfigured()) {
      return NextResponse.json(
        { error: 'Auth no está configurado en el servidor' },
        { status: 500 }
      );
    }
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Crea tu cuenta para elegir un plan.', code: 'auth_required' },
        { status: 401 }
      );
    }

    // Crea/reusa el customer de Stripe y persístelo en profiles.
    const sb = getSupabase();
    const { data: profile } = await sb
      .from('profiles')
      .select('stripe_customer_id,email')
      .eq('id', user.id)
      .maybeSingle();

    const customerId = await getOrCreateStripeCustomer({
      userId: user.id,
      email: profile?.email ?? user.email,
      existingCustomerId: profile?.stripe_customer_id,
    });
    if (!profile?.stripe_customer_id) {
      await sb.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }

    const origin = siteUrl(request.headers.get('origin'));

    const form = new URLSearchParams();
    form.set('mode', 'subscription');
    form.set('customer', customerId);
    form.set('line_items[0][price]', priceId);
    form.set('line_items[0][quantity]', '1');
    form.set('allow_promotion_codes', 'true');
    form.set('success_url', `${origin}/studio?welcome=1`);
    form.set('cancel_url', `${origin}/#precios`);
    form.set('metadata[tier]', tierDef.id);
    form.set('metadata[cycle]', cycle);
    form.set('metadata[user_id]', user.id);
    form.set('subscription_data[metadata][tier]', tierDef.id);
    form.set('subscription_data[metadata][user_id]', user.id);

    const session = await stripePost<{ url: string }>('/checkout/sessions', form);

    return NextResponse.json({ url: session.url, configured: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error en checkout';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
