// POST /api/tiktok/upload-url — URL firmada para subir el video directo del
// navegador al bucket creative-videos, sin pasar por el límite de body de
// Vercel. El cliente sube con uploadToSignedUrl(path, token, file).
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { tiktokEnabled } from '@/lib/tiktok-server';

export const runtime = 'nodejs';

const BUCKET = 'creative-videos';
const EXT_OK = ['mp4', 'mov', 'webm', 'm4v'];

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tiktokEnabled(user.id))) return NextResponse.json({ error: 'Modo no disponible' }, { status: 403 });

  const { brandId, filename } = (await request.json()) as { brandId?: string; filename?: string };
  if (!brandId) return NextResponse.json({ error: 'Falta brandId' }, { status: 400 });

  const raw = (filename?.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ext = EXT_OK.includes(raw) ? raw : 'mp4';
  const path = `${brandId}/tiktok/${crypto.randomUUID()}.${ext}`;

  const sb = getSupabase();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ path, token: data.token, bucket: BUCKET });
}
