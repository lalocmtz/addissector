'use client';

// =============================================================================
// AdDNA — Supabase browser client (@supabase/ssr). Solo para Auth en el cliente
// (login, signup, OAuth). El acceso a datos sigue pasando por /api con RLS.
// =============================================================================

import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function createBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase Auth no está configurado. Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }
  if (!cached) {
    cached = createSSRBrowserClient(url, key);
  }
  return cached;
}
