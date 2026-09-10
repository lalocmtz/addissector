// =============================================================================
// /api/canvas — El tablero libre (tipo Miro) de la marca.
// GET ?brand=          → devuelve el tablero (lo crea si no existe)
// PUT {brandId, data}  → guarda TODO el data {items[], groups[]} (máx 2 MB)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const BOARD_NAME = 'Canvas';
const MAX_BYTES = 2 * 1024 * 1024;
const EMPTY = { items: [], groups: [] };
const COLUMNS = 'id,name,data,updated_at';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });

  const sb = getSupabase();
  const { data: brand } = await sb.from('brands').select('id').eq('id', brandId).eq('user_id', user.id).maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  const { data: existing, error } = await sb
    .from('canvas_board')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .eq('user_id', user.id)
    .eq('name', BOARD_NAME)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (existing) return NextResponse.json(existing);

  const { data: created, error: insErr } = await sb
    .from('canvas_board')
    .insert({ user_id: user.id, brand_id: brandId, name: BOARD_NAME, data: EMPTY })
    .select(COLUMNS)
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json(created);
}

export async function PUT(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: 'Canvas demasiado grande (máx 2 MB)' }, { status: 413 });

  let body: { brandId?: unknown; data?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }

  const brandId = typeof body.brandId === 'string' ? body.brandId : null;
  const data = body.data as { items?: unknown; groups?: unknown } | null;
  if (!brandId) return NextResponse.json({ error: 'Falta brandId' }, { status: 400 });
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.items) || !Array.isArray(data.groups)) {
    return NextResponse.json({ error: 'data debe ser {items: [], groups: []}' }, { status: 400 });
  }

  const sb = getSupabase();
  const { data: saved, error } = await sb
    .from('canvas_board')
    .upsert(
      { user_id: user.id, brand_id: brandId, name: BOARD_NAME, data, updated_at: new Date().toISOString() },
      { onConflict: 'brand_id,user_id,name' },
    )
    .select(COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(saved);
}
