import { NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET /api/me — bootstrap de la app: perfil y marcas (plataforma personal,
// sin planes ni límites de uso).
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
    const [{ data: profile }, { data: brands }] = await Promise.all([
      sb.from('profiles').select('id,email,full_name').eq('id', user.id).maybeSingle(),
      sb.from('brands').select('id,name,tone,palette,product,economics,created_at').eq('user_id', user.id).order('created_at'),
    ]);

    return NextResponse.json({
      configured: true,
      user: {
        id: user.id,
        email: profile?.email ?? user.email,
        full_name: profile?.full_name ?? '',
        has_stripe_customer: false,
      },
      plan: null,
      usage: null,
      brands: brands ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error cargando tu cuenta';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
