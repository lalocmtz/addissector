// =============================================================================
// PATCH /api/meta/ads/[id] — expediente del anuncio (respuesta de la IA de
// Meta, análisis del video) y vínculo con un creativo de la Biblioteca.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';

interface Body {
  dossier_meta?: string | null;
  dossier_video?: string | null;
  creative_id?: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json()) as Body;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.dossier_meta !== undefined) patch.dossier_meta = body.dossier_meta || null;
  if (body.dossier_video !== undefined) patch.dossier_video = body.dossier_video || null;
  if (body.creative_id !== undefined) patch.creative_id = body.creative_id || null;

  const sb = getSupabase();
  const { data, error } = await sb
    .from('meta_ads')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id,name,dossier_meta,dossier_video,creative_id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ad: data });
}
