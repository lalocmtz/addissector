// =============================================================================
// GET /api/meta/asset?ad=<meta_ads.id> — proxy del creativo.
//
// El navegador no puede bajar el MP4 directo del CDN de Meta (CORS), y las URLs
// firmadas de `source` caducan. Esta ruta lo baja del lado del servidor y, si la
// URL ya expiró, la vuelve a resolver contra la API antes de rendirse (la
// lógica compartida vive en src/lib/meta-asset.ts).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { openMetaAsset, META_ASSET_COLUMNS, type MetaAssetRow } from '@/lib/meta-asset';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const id = request.nextUrl.searchParams.get('ad');
  if (!id) return NextResponse.json({ error: 'Falta ad' }, { status: 400 });

  const sb = getSupabase();
  const { data: row } = await sb
    .from('meta_ads')
    .select(META_ASSET_COLUMNS)
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Anuncio no encontrado' }, { status: 404 });

  const { upstream, error } = await openMetaAsset(sb, row as unknown as MetaAssetRow);

  if (!upstream) {
    return NextResponse.json(
      { error: `No se pudo descargar el creativo desde Meta${error ? `: ${error}` : ''}` },
      { status: 502 }
    );
  }

  const tipo = upstream.headers.get('content-type')
    ?? ((row as { asset_kind?: string | null }).asset_kind === 'image' ? 'image/jpeg' : 'video/mp4');
  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': tipo,
      'Cache-Control': 'private, max-age=600',
      ...(upstream.headers.get('content-length')
        ? { 'Content-Length': upstream.headers.get('content-length')! }
        : {}),
    },
  });
}
