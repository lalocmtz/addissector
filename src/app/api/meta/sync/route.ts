// =============================================================================
// /api/meta/sync — Estado y disparo de la sincronización con Meta.
// GET  ?brand=  → última sync, progreso de creativos descargados, últimos logs.
// POST { action: 'sync' | 'creatives' } → dispara la edge function correspondiente.
// Las edge functions (meta-sync / meta-creatives) viven en Supabase y también
// corren solas por cron cada hora; estos botones son el "por si se traba".
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 120;

function functionsBase(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) return null;
  return `${url.replace(/\/$/, '')}/functions/v1`;
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const brandId = request.nextUrl.searchParams.get('brand');
  const sb = getSupabase();

  let accQ = sb.from('meta_accounts').select('brand_id,ad_account_id,last_synced_at,active');
  if (brandId) accQ = accQ.eq('brand_id', brandId);
  const { data: accounts } = await accQ;

  let mediaTotal = 0;
  let mediaDone = 0;
  if (brandId) {
    const { count: total } = await sb
      .from('meta_ads').select('id', { count: 'exact', head: true }).eq('brand_id', brandId);
    const { count: done } = await sb
      .from('meta_ads').select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId).not('media_url', 'is', null);
    mediaTotal = total ?? 0;
    mediaDone = done ?? 0;
  }

  const { data: logs } = await sb
    .from('sync_logs')
    .select('ran_at,ok,rows_upserted,creatives_downloaded,detail')
    .order('ran_at', { ascending: false })
    .limit(4);

  return NextResponse.json({
    accounts: accounts ?? [],
    lastSyncedAt: accounts?.[0]?.last_synced_at ?? null,
    media: { total: mediaTotal, done: mediaDone },
    logs: (logs ?? []).map((l) => ({ ...l, detail: (l.detail ?? '').slice(0, 160) })),
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { action } = (await request.json()) as { action: 'sync' | 'creatives' };
  const base = functionsBase();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return NextResponse.json({ error: 'Supabase no configurado' }, { status: 500 });

  const fn = action === 'creatives' ? 'meta-creatives' : 'meta-sync?days=7';
  try {
    const res = await fetch(`${base}/${fn}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: res.ok, result: data }, { status: res.ok ? 200 : 502 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error llamando a la función';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
