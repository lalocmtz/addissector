// =============================================================================
// POST /api/canvas/upload-url — URL firmada para subir una IMAGEN del Canvas
// directo del navegador al bucket brand-assets (evita el límite de body de
// Vercel). El cliente sube con supabase-js: uploadToSignedUrl(path, token, file).
// Devuelve también la URL pública, que es lo que se guarda en el tablero.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const BUCKET = 'brand-assets';
const EXT_OK = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic'];

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { brandId, filename } = (await request.json()) as { brandId?: string; filename?: string };
  if (!brandId) return NextResponse.json({ error: 'Falta brandId' }, { status: 400 });

  const sb = getSupabase();
  const { data: brand } = await sb.from('brands').select('id').eq('id', brandId).eq('user_id', user.id).maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });

  const raw = (filename?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ext = EXT_OK.includes(raw) ? raw.replace('jpeg', 'jpg') : 'png';
  const path = `${user.id}/${brandId}/canvas/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    path,
    token: data.token,
    url: sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
  });
}
