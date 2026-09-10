// =============================================================================
// /api/meta/account — the Meta connection of one brand.
//
//   GET   ?brand=            state of the token: is there one, its last 4
//                            characters, and what Meta says it can do
//                            (ads_read for the numbers, pages_read_engagement
//                            for downloading videos).
//   PATCH { brandId, token } stores a new token in ad_account.access_token.
//                            Takes effect immediately for the sync and the
//                            barrido — nothing to redeploy.
//   PATCH { geminiKey }      stores the user's Gemini API key (app_settings)
//                            that powers the fast server-side engine.
//   GET also returns { gemini: { has_key, tail } }.
//
// Neither the token nor the key is ever sent back whole.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { GRAPH_VERSION } from '@/lib/meta-api';
import { GEMINI_SETTING_KEY } from '@/lib/gemini';

export const runtime = 'nodejs';

const NEEDED = ['ads_read', 'pages_read_engagement', 'pages_show_list'] as const;

interface Check {
  ok: boolean;
  name: string | null;
  granted: string[];
  missing: string[];
  /** Pages the token can act on (/me/accounts). Empty = no Page assigned to this user/token. */
  pages: { id: string; name: string }[];
  error: string | null;
}

async function checkToken(token: string): Promise<Check> {
  try {
    const me = (await (await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me?fields=name&access_token=${encodeURIComponent(token)}`, { cache: 'no-store' })).json()) as { name?: string; error?: { message?: string } };
    if (me.error) return { ok: false, name: null, granted: [], missing: [...NEEDED], pages: [], error: me.error.message ?? 'Token rechazado' };
    const perms = (await (await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/permissions?access_token=${encodeURIComponent(token)}`, { cache: 'no-store' })).json()) as { data?: { permission: string; status: string }[] };
    const granted = (perms.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission);
    const missing = NEEDED.filter((p) => !granted.includes(p));
    let pages: { id: string; name: string }[] = [];
    try {
      const acc = (await (await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name&limit=50&access_token=${encodeURIComponent(token)}`, { cache: 'no-store' })).json()) as { data?: { id: string; name: string }[] };
      pages = (acc.data ?? []).map((p) => ({ id: p.id, name: p.name }));
    } catch { /* optional */ }
    return { ok: missing.length === 0, name: me.name ?? null, granted, missing, pages, error: null };
  } catch (e) {
    return { ok: false, name: null, granted: [], missing: [...NEEDED], pages: [], error: e instanceof Error ? e.message : 'No se pudo consultar a Meta' };
  }
}

async function accountOf(brandId: string, userId: string) {
  const sb = getSupabase();
  const { data } = await sb.from('ad_account').select('id,ad_account_id,access_token,active')
    .eq('brand_id', brandId).eq('user_id', userId).eq('active', true).limit(1).maybeSingle();
  return data as { id: string; ad_account_id: string; access_token: string | null; active: boolean } | null;
}

/** { has_key, tail } for the user's Gemini key: app_settings first, env fallback. */
async function geminiState(userId: string): Promise<{ has_key: boolean; tail: string | null; from: 'user' | 'env' | null }> {
  const sb = getSupabase();
  try {
    const { data } = await sb.from('app_settings').select('value').eq('user_id', userId).eq('key', GEMINI_SETTING_KEY).maybeSingle();
    const v = typeof data?.value === 'string' ? data.value.trim() : '';
    if (v) return { has_key: true, tail: v.slice(-4), from: 'user' };
  } catch { /* table may not exist yet */ }
  const env = (process.env.GEMINI_API_KEY ?? '').trim();
  if (env) return { has_key: true, tail: env.slice(-4), from: 'env' };
  return { has_key: false, tail: null, from: null };
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const gemini = await geminiState(user.id);
  const acc = await accountOf(brandId, user.id);
  if (!acc) return NextResponse.json({ account: null, gemini });
  const token = acc.access_token ?? process.env.META_ACCESS_TOKEN ?? null;
  const check = token ? await checkToken(token) : null;
  return NextResponse.json({
    account: { id: acc.id, ad_account_id: acc.ad_account_id, has_token: Boolean(acc.access_token), token_tail: acc.access_token ? acc.access_token.slice(-4) : null },
    check,
    gemini,
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const body = (await request.json()) as { brandId?: string; token?: string; geminiKey?: string };

  // --- Gemini key (per user, not per brand) ---------------------------------
  if (typeof body.geminiKey === 'string') {
    const key = body.geminiKey.trim();
    if (!key) return NextResponse.json({ error: 'La clave de Gemini está vacía' }, { status: 400 });
    if (key.length < 20 || /\s/.test(key)) return NextResponse.json({ error: 'Eso no parece una clave de Gemini (AIza…)' }, { status: 400 });
    const sb = getSupabase();
    const { error } = await sb.from('app_settings').upsert(
      { user_id: user.id, key: GEMINI_SETTING_KEY, value: key, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' },
    );
    if (error) return NextResponse.json({ error: `No se pudo guardar la clave: ${error.message}` }, { status: 500 });
    return NextResponse.json({ ok: true, gemini: { has_key: true, tail: key.slice(-4), from: 'user' } });
  }

  const token = (body.token ?? '').trim();
  if (!body.brandId || !token) return NextResponse.json({ error: 'Faltan brandId o token' }, { status: 400 });
  const acc = await accountOf(body.brandId, user.id);
  if (!acc) return NextResponse.json({ error: 'La marca no tiene cuenta de Meta activa' }, { status: 404 });
  const check = await checkToken(token);
  if (check.error) return NextResponse.json({ error: `Meta rechazó el token: ${check.error}`, check }, { status: 400 });
  const sb = getSupabase();
  const { error } = await sb.from('ad_account').update({ access_token: token, updated_at: new Date().toISOString() }).eq('id', acc.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, token_tail: token.slice(-4), check });
}
