// =============================================================================
// GET /api/meta/asset?ad=<meta_ads.id> — proxy del creativo.
//
// El navegador no puede bajar el MP4 directo del CDN de Meta (CORS), y las URLs
// firmadas de `source` caducan. Esta ruta lo baja del lado del servidor y, si la
// URL ya expiró, la vuelve a resolver contra la API antes de rendirse.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { resolveAsset, type RawAd, GRAPH_VERSION, adToken } from '@/lib/meta-api';

export const runtime = 'nodejs';
export const maxDuration = 120;

const AD_FIELDS =
  'id,name,status,effective_status,created_time,adset_id,campaign_id,' +
  'creative{id,video_id,image_url,thumbnail_url,effective_object_story_id,object_story_spec,asset_feed_spec}';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const id = request.nextUrl.searchParams.get('ad');
  if (!id) return NextResponse.json({ error: 'Falta ad' }, { status: 400 });

  const sb = getSupabase();
  const { data: row } = await sb
    .from('meta_ads')
    .select('id,name,ad_id,brand_id,asset_url,asset_kind,brands(meta_ad_account_id)')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Anuncio no encontrado' }, { status: 404 });

  // The token and the account live in ad_account (the owner pastes the token
  // in /meta/barrido). The env var is only a fallback; re-resolving an expired
  // URL with a dead env token is exactly how every download came back 502.
  const { data: acc } = await sb.from('ad_account').select('ad_account_id,access_token')
    .eq('brand_id', row.brand_id).eq('active', true).limit(1).maybeSingle();
  const actId = acc?.ad_account_id ?? (row as unknown as { brands?: { meta_ad_account_id?: string } }).brands?.meta_ad_account_id;
  let token: string | null = null;
  try { token = adToken(acc?.access_token ?? null); } catch { token = null; }
  let resolveError: string | null = null;

  async function traer(url: string): Promise<Response | null> {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok && r.body) return r;
      return null;
    } catch {
      return null;
    }
  }

  let upstream = row.asset_url ? await traer(row.asset_url) : null;

  // URL caducada -> re-resolver contra la API y actualizar la fila.
  if (!upstream && row.ad_id && actId && token) {
    try {
      const u = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${row.ad_id}`);
      u.searchParams.set('fields', AD_FIELDS);
      u.searchParams.set('access_token', token);
      const ad = (await (await fetch(u, { cache: 'no-store' })).json()) as RawAd & { error?: { message?: string } };
      if (ad.error) throw new Error(ad.error.message ?? 'Meta rechazó la consulta');
      const fresh = await resolveAsset(ad, actId, token);
      if (!fresh.url) resolveError = fresh.error ?? 'Meta no entregó el archivo';
      if (fresh.url) {
        await sb.from('meta_ads').update({
          asset_url: fresh.url, asset_kind: fresh.kind,
          asset_strategy: fresh.strategy, thumbnail_url: fresh.thumbnail, asset_error: null,
        }).eq('id', row.id);
        upstream = await traer(fresh.url);
      }
    } catch (e) {
      resolveError = e instanceof Error ? e.message : 'No se pudo re-resolver el creativo';
    }
  }

  if (!upstream) {
    // Leave the reason on the row so the Top 30 board can say "súbelo tú".
    await sb.from('meta_ads').update({ asset_error: resolveError ?? 'La URL del creativo caducó y Meta no la renovó', updated_at: new Date().toISOString() }).eq('id', row.id);
    return NextResponse.json(
      { error: `No se pudo descargar el creativo desde Meta${resolveError ? `: ${resolveError}` : ''}` },
      { status: 502 }
    );
  }

  const tipo = upstream.headers.get('content-type')
    ?? (row.asset_kind === 'image' ? 'image/jpeg' : 'video/mp4');
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
