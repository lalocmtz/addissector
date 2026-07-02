// =============================================================================
// AdDNA — Supabase server helpers (@supabase/ssr)
// createServerClient: sesión del usuario (anon key + cookies) para auth.
// getSupabase (src/lib/supabase.ts): service-role para acceso a datos.
// =============================================================================

import { cookies } from 'next/headers';
import { createServerClient as createSSRClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';

function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
}

function supabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function isAuthConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

/** Cliente Supabase ligado a la sesión del usuario (cookies). Solo en server. */
export async function createServerClient(): Promise<SupabaseClient> {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) {
    throw new Error(
      'Supabase Auth no está configurado. Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }
  const cookieStore = await cookies();
  return createSSRClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Llamado desde un Server Component: el middleware refresca la sesión.
        }
      },
    },
  });
}

/** Usuario autenticado de la petición actual, o null. */
export async function getSessionUser(): Promise<User | null> {
  if (!isAuthConfigured()) return null;
  try {
    const supabase = await createServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}

/** Usuario autenticado o lanza (para rutas API protegidas). */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) {
    const err = new Error('No autenticado') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return user;
}
