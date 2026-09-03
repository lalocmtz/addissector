// =============================================================================
// AdDNA — Middleware: refresca la sesión de Supabase y protege las rutas de la
// app (/studio, /analyze*, /biblioteca, /app*). Sin sesión → /login.
// =============================================================================

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PROTECTED_PREFIXES = ['/studio', '/analyze', '/analyze-image', '/biblioteca', '/app', '/meta', '/cerebro', ];

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Auth aún no configurado (dev local): no bloquear nada.
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`)
  );

  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(loginUrl);
  }

  // Logged-in user on /login → straight to the engine.
  if (user && path === '/login') {
    const metaUrl = request.nextUrl.clone();
    metaUrl.pathname = '/meta';
    metaUrl.search = '';
    return NextResponse.redirect(metaUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/studio/:path*',
    '/analyze/:path*',
    '/analyze-image/:path*',
    '/biblioteca/:path*',
    '/app/:path*',
    '/studio',
    '/analyze',
    '/analyze-image',
    '/biblioteca',
    '/meta/:path*',
    '/cerebro/:path*',
    '/meta',
    '/cerebro',
    '/login',
  ],
};
