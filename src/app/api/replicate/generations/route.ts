import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET /api/replicate/generations?creative=<id>|brand=<id> — galería del usuario
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    if (!isAuthConfigured() || !isSupabaseConfigured()) {
      return NextResponse.json({ generations: [] });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const sb = getSupabase();
    let query = sb
      .from('generations')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(60);

    const creative = request.nextUrl.searchParams.get('creative');
    const brand = request.nextUrl.searchParams.get('brand');
    if (creative) query = query.eq('creative_id', creative);
    else if (brand) query = query.eq('brand_id', brand);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ generations: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error listando generaciones';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
