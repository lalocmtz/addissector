// =============================================================================
// AdDNA — Helper de Stripe server-side (REST vía fetch, sin SDK).
// =============================================================================

const STRIPE_API = 'https://api.stripe.com/v1';

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

interface StripeError {
  error?: { message?: string };
}

/** POST form-encoded a la API de Stripe. Lanza con el mensaje de Stripe si falla. */
export async function stripePost<T = Record<string, unknown>>(
  path: string,
  form: URLSearchParams
): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('STRIPE_SECRET_KEY no está configurada');

  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const json = (await res.json()) as T & StripeError;
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Stripe error (${res.status})`);
  }
  return json;
}

/** GET a la API de Stripe. */
export async function stripeGet<T = Record<string, unknown>>(path: string): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('STRIPE_SECRET_KEY no está configurada');

  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = (await res.json()) as T & StripeError;
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Stripe error (${res.status})`);
  }
  return json;
}

/**
 * Devuelve el stripe_customer_id del usuario, creándolo (y guardándolo en
 * profiles) si aún no existe.
 */
export async function getOrCreateStripeCustomer(opts: {
  userId: string;
  email: string | null | undefined;
  existingCustomerId: string | null | undefined;
}): Promise<string> {
  if (opts.existingCustomerId) return opts.existingCustomerId;

  const form = new URLSearchParams();
  if (opts.email) form.set('email', opts.email);
  form.set('metadata[user_id]', opts.userId);

  const customer = await stripePost<{ id: string }>('/customers', form);
  return customer.id;
}

export function siteUrl(fallbackOrigin?: string | null): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    fallbackOrigin ||
    'http://localhost:3000'
  );
}
