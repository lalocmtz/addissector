import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import { getOrCreateStripeCustomer, isStripeConfigured, siteUrl, stripePost } from '@/lib/stripe';

export const runtime = 'nodejs';
export const maxDuration = 20;

// ---------------------------------------------------------------------------
// POST /api/billing/portal — crea una Billing Portal Session de Stripe para
// que el usuario gestione o cancele su suscripción.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: 'Stripe no está configurado todavía.', configured: false },
        { status: 501 }
      );
    }
    if (!isAuthConfigured() || !isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Auth no está configurado' }, { status: 500 });
    }

    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

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
    form.set('customer', customerId);
    form.set('return_url', `${origin}/app/cuenta`);

    const session = await stripePost<{ url: string }>('/billing_portal/sessions', form);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error abriendo el portal';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
