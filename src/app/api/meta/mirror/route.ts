// =============================================================================
// /api/meta/mirror — backfill de creativos a nuestro bucket.
//
//   GET  ?brand=            cuántos anuncios siguen colgando de la CDN de Meta.
//   POST { brandId, limit } baja ese lote y lo deja en el bucket.
//
// Existe porque las filas viejas guardaron el link firmado de fbcdn en vez del
// archivo, y esos links ya caducaron: la Biblioteca muestra "Analizado" con el
// reproductor en negro. Cada anuncio se vuelve a resolver contra Meta (la URL
// se renueva con el token de la cuenta), se descarga y se sube al bucket.
//
// Va por lotes chicos a propósito: son descargas reales y la función tiene
// techo de tiempo. El cliente lo llama en bucle hasta que `restantes` sea 0.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { isOwnBucketUrl, META_ASSET_COLUMNS, type MetaAssetRow } from '@/lib/meta-asset';
import { openAndMirror } from '@/lib/meta-mirror';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;
/** Margen para devolver respuesta antes de que la función se corte sola. */
const TIME_BUDGET_MS = 240_000;

/** Filas de la marca cuyo archivo todavía vive en la CDN de Meta. */
async function pending(sb: ReturnType<typeof getSupabase>, brandId: string, userId: string) {
  const { data } = await sb
    .from('meta_ads')
    .select(META_ASSET_COLUMNS + ',analyzed_at')
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .not('asset_url', 'is', null)
    .order('analyzed_at', { ascending: false, nullsFirst: false })
    .limit(500);
  const rows = (data ?? []) as unknown as (MetaAssetRow & { analyzed_at: string | null })[];
  return rows.filter((r) => !isOwnBucketUrl(r.asset_url));
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const sb = getSupabase();
  const rows = await pending(sb, brandId, user.id);
  return NextResponse.json({ restantes: rows.length });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { brandId?: string; limit?: number };
  const brandId = (body.brandId ?? '').trim();
  if (!brandId) return NextResponse.json({ error: 'Falta brandId' }, { status: 400 });
  const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const sb = getSupabase();
  const rows = await pending(sb, brandId, user.id);
  const lote = rows.slice(0, limit);

  const started = Date.now();
  let guardados = 0;
  const fallidos: { name: string; error: string }[] = [];

  for (const row of lote) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      const r = await openAndMirror(sb, row);
      if (r.mirrored || r.fromBucket) guardados += 1;
      else fallidos.push({ name: row.name, error: r.error ?? 'Meta no entregó el archivo' });
    } catch (e) {
      fallidos.push({ name: row.name, error: e instanceof Error ? e.message : 'Error inesperado' });
    }
  }

  return NextResponse.json({
    ok: true,
    procesados: lote.length,
    guardados,
    fallidos,
    restantes: Math.max(rows.length - guardados, 0),
  });
}
