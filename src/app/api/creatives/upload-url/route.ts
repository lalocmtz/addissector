// =============================================================================
// POST /api/creatives/upload-url — URL firmada para subir el VIDEO ORIGINAL
// directo del navegador al bucket creative-videos (evita el límite de body de
// Vercel). El cliente sube con supabase-js: uploadToSignedUrl(path, token, file).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { filename } = (await request.json()) as { filename?: string };
  const ext = (filename?.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const path = `${crypto.randomUUID()}.${ext}`;

  const sb = getSupabase();
  const { data, error } = await sb.storage.from('creative-videos').createSignedUploadUrl(path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    path,
    token: data.token,
    signedUrl: data.signedUrl,
    supabaseUrl: process.env.SUPABASE_URL,
  });
}
