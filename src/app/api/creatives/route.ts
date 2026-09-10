import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { saveCreative, type SaveCreativeInput } from '@/lib/creatives-save';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// GET /api/creatives — biblioteca del usuario (filtrable por marca: ?brand=id)
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ creatives: [], configured: false });
  }
  try {
    const sb = getSupabase();
    let query = sb
      .from('creatives')
      .select('id,name,type,preview_url,created_at,product,video_type,hook_score,brand_id,ad_name,video_url')
      .order('created_at', { ascending: false });

    // Session and brand are mandatory: every other route returns 400 without
    // a brand, and this one used to leak every creative of the user when the
    // parameter was missing.
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const brandId = request.nextUrl.searchParams.get('brand');
    if (!brandId) return NextResponse.json({ error: 'Missing brand' }, { status: 400 });
    query = query.eq('user_id', user.id).eq('brand_id', brandId);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ creatives: data ?? [], configured: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error listando creativos';
    return NextResponse.json({ error: message, creatives: [] }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/creatives — guardar un creativo en la marca activa del usuario
// ---------------------------------------------------------------------------
interface SaveBody extends SaveCreativeInput {
  brandId?: string | null;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase no está configurado', configured: false },
      { status: 501 }
    );
  }
  try {
    const body = (await request.json()) as SaveBody;
    if (!body.analysis) {
      return NextResponse.json({ error: 'Falta el análisis' }, { status: 400 });
    }

    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const userId: string = user.id;

    const sb = getSupabase();

    // Valida que la marca pertenezca al usuario.
    // A creative always belongs to a brand the user owns. No more orphans.
    if (!body.brandId) return NextResponse.json({ error: 'Missing brandId' }, { status: 400 });
    const { data: brand } = await sb
      .from('brands')
      .select('id')
      .eq('id', body.brandId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

    // The insert itself (preview upload, denormalized columns, meta_ads link)
    // is shared with the Gemini engine: src/lib/creatives-save.ts.
    const saved = await saveCreative(sb, userId, brand.id, body);
    return NextResponse.json({ id: saved.id, preview_url: saved.preview_url, video_url: saved.video_url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error guardando el creativo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
