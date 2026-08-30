// =============================================================================
// Cola del barrido automático.
//   GET  /api/meta/queue?brand=&limit=   -> anuncios pendientes de analizar
//   POST /api/meta/queue                 -> marca el resultado de uno
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const brandId = sp.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const limit = Math.min(Number(sp.get('limit') ?? 25), 100);

  const sb = getSupabase();
  const { data, error } = await sb
    .from('meta_ads')
    .select('id,name,ad_id,video_id,asset_kind,asset_strategy,thumbnail_url,duration,queue_status,queue_attempts')
    .eq('brand_id', brandId)
    .eq('user_id', user.id)
    .in('queue_status', ['pendiente', 'error'])
    .neq('asset_kind', 'none')
    .lt('queue_attempts', 3)
    .order('last_seen', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resumen para la barra de progreso
  const { data: todos } = await sb
    .from('meta_ads')
    .select('queue_status,asset_kind')
    .eq('brand_id', brandId)
    .eq('user_id', user.id);
  const resumen = { pendiente: 0, listo: 0, error: 0, omitido: 0, total: (todos ?? []).length };
  for (const r of todos ?? []) {
    const k = (r.queue_status ?? 'pendiente') as keyof typeof resumen;
    if (k in resumen && k !== 'total') resumen[k]++;
  }

  return NextResponse.json({ items: data ?? [], resumen });
}

interface MarkBody {
  id: string;
  status: 'listo' | 'error' | 'omitido' | 'procesando';
  error?: string | null;
  creativeId?: string | null;
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const b = (await request.json().catch(() => ({}))) as MarkBody;
  if (!b.id || !b.status) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });

  const sb = getSupabase();
  const { data: prev } = await sb
    .from('meta_ads').select('queue_attempts').eq('id', b.id).eq('user_id', user.id).maybeSingle();

  const patch: Record<string, unknown> = {
    queue_status: b.status,
    queue_error: b.error ?? null,
    updated_at: new Date().toISOString(),
  };
  if (b.status === 'error') patch.queue_attempts = (prev?.queue_attempts ?? 0) + 1;
  if (b.status === 'listo') {
    patch.analyzed_at = new Date().toISOString();
    patch.queue_error = null;
    if (b.creativeId) patch.creative_id = b.creativeId;
  }

  const { error } = await sb.from('meta_ads').update(patch).eq('id', b.id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
