import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// POST /logout (y GET para enlaces simples) — cierra la sesión.
// ---------------------------------------------------------------------------
async function handleLogout(request: NextRequest) {
  if (isAuthConfigured()) {
    try {
      const supabase = await createServerClient();
      await supabase.auth.signOut();
    } catch {
      /* la sesión ya no existía */
    }
  }
  return NextResponse.redirect(new URL('/', request.url));
}

export async function POST(request: NextRequest) {
  return handleLogout(request);
}

export async function GET(request: NextRequest) {
  return handleLogout(request);
}
