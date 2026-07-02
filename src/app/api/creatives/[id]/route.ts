import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, PREVIEW_BUCKET, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';

async function scopedUserId(): Promise<{ userId: string | null; response?: NextResponse }> {
  if (!isAuthConfigured()) return { userId: null };
  const user = await getSessionUser();
  if (!user) {
    return {
      userId: null,
      response: NextResponse.json({ error: 'No autenticado' }, { status: 401 }),
    };
  }
  return { userId: user.id };
}

// ---------------------------------------------------------------------------
// GET /api/creatives/[id] — full record (analysis + metrics) to reopen
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase no está configurado' }, { status: 501 });
  }
  try {
    const { id } = await params;
    const { userId, response } = await scopedUserId();
    if (response) return response;

    const sb = getSupabase();
    let query = sb.from('creatives').select('*').eq('id', id);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query.single();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error leyendo el creativo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/creatives/[id] — remove record + its preview
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase no está configurado' }, { status: 501 });
  }
  try {
    const { id } = await params;
    const { userId, response } = await scopedUserId();
    if (response) return response;

    const sb = getSupabase();
    let readQuery = sb.from('creatives').select('preview_url').eq('id', id);
    if (userId) readQuery = readQuery.eq('user_id', userId);
    const { data } = await readQuery.single();
    if (data?.preview_url) {
      const path = String(data.preview_url).split(`${PREVIEW_BUCKET}/`).pop();
      if (path) await sb.storage.from(PREVIEW_BUCKET).remove([path]);
    }

    let deleteQuery = sb.from('creatives').delete().eq('id', id);
    if (userId) deleteQuery = deleteQuery.eq('user_id', userId);
    const { error } = await deleteQuery;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error eliminando el creativo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
