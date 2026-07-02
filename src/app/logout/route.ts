import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// POST /logout — cierra la sesión.
// IMPORTANTE: solo POST. Un GET aquí es peligroso: Next.js prefetchea los
// <Link>, y un GET que cierra sesión desconecta al usuario al cargar la página.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  if (isAuthConfigured()) {
    try {
      const supabase = await createServerClient();
      await supabase.auth.signOut();
    } catch {
      /* la sesión ya no existía */
    }
  }
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}

// GET inofensivo: alguien que visite /logout directo solo vuelve al inicio.
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/', request.url));
}
