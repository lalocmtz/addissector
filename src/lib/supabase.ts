// =============================================================================
// AdDissector - Supabase client (server-side only)
// Single-user setup: uses the service-role key from server env. The key is
// NEVER exposed to the browser; all DB access happens through /api routes.
// =============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/** Public storage bucket that holds creative preview thumbnails. */
export const PREVIEW_BUCKET = 'creative-previews';

/** True when the Supabase env vars are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Returns a memoized server-side Supabase client. Throws if not configured. */
export function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase no está configurado. Falta SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno.'
    );
  }
  if (!cached) {
    cached = createClient(url, key, { auth: { persistSession: false } });
  }
  return cached;
}
