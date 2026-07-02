import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET /auth/callback — intercambia el código OAuth (Google) por una sesión.
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/studio';

  if (code) {
    try {
      const supabase = await createServerClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${next.startsWith('/') ? next : '/studio'}`);
      }
    } catch {
      /* cae al redirect de error */
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
