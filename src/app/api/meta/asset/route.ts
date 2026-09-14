// =============================================================================
// GET /api/meta/asset?ad=<meta_ads.id> — proxy del creativo.
//
// El navegador no puede bajar el MP4 directo del CDN de Meta (CORS), y las URLs
// firmadas de `source` caducan. Esta ruta lo baja del lado del servidor y, si la
// URL ya expiró, la vuelve a resolver contra la API antes de rendirse (la
// lógica compartida vive en src/lib/meta-asset.ts).
//
// Además deja una COPIA en nuestro bucket la primera vez que un archivo de Meta
// pasa por aquí (src/lib/meta-mirror.ts): así el siguiente play ya no depende de
// que el link firmado siga vivo. Por eso lee el cuerpo a memoria en vez de
// pasarlo en streaming — es el precio de quedarnos con el archivo.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { META_ASSET_COLUMNS, type MetaAssetRow } from '@/lib/meta-asset';
import { openAndMirror } from '@/lib/meta-mirror';

export const runtime = 'nodejs';
export const maxDuration = 300;

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

  const { bytes, mime, error } = await openAndMirror(sb, row as unknown as MetaAssetRow);

  if (!bytes) {
    return NextResponse.json(
      { error: `No se pudo descargar el creativo desde Meta${error ? `: ${error}` : ''}` },
      { status: 502 }
    );
  }

  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, max-age=600',
    },
  });
}
