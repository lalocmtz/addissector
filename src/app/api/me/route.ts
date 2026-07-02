import { NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import { getUsageSnapshot } from '@/lib/usage';
import { PLAN_LIMITS } from '@/lib/plans';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET /api/me — bootstrap de la app: perfil, plan, uso del mes y marcas.
// ---------------------------------------------------------------------------
export async function GET() {
  if (!isSupabaseConfigured() || !isAuthConfigured()) {
    return NextResponse.json({ configured: false, user: null });
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  try {
    const sb = getSupabase();
    const [{ data: profile }, { data: brands }, usage] = await Promise.all([
      sb.from('profiles').select('id,email,full_name,stripe_customer_id').eq('id', user.id).maybeSingle(),
      sb.from('brands').select('id,name,tone,palette,product,created_at').eq('user_id', user.id).order('created_at'),
      getUsageSnapshot(user.id),
    ]);

    const maxBrands = usage.plan.limits.maxBrands;

    return NextResponse.json({
      configured: true,
      user: {
        id: user.id,
        email: profile?.email ?? user.email,
        full_name: profile?.full_name ?? '',
        has_stripe_customer: Boolean(profile?.stripe_customer_id),
      },
      plan: {
        id: usage.plan.plan,
        label: PLAN_LIMITS[usage.plan.plan].label,
        status: usage.plan.status,
        expired: usage.plan.expired,
        current_period_end: usage.plan.currentPeriodEnd,
        max_brands: Number.isFinite(maxBrands) ? maxBrands : null,
      },
      usage: {
        used: usage.used,
        limit: usage.limit,
        remaining: usage.remaining,
        period_start: usage.periodStart,
      },
      brands: brands ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error cargando tu cuenta';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
