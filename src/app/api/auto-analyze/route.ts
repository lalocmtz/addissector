// =============================================================================
// GET /api/auto-analyze — El corazón automático del Cerebro.
// Corre por cron de Vercel cada 2 horas: toma los anuncios que cruzaron los
// umbrales del SOP (vista v_ads_para_analizar en Supabase) y que aún no tienen
// análisis, y les genera la "mesa redonda" automáticamente:
//   · categoria 'ganador'   → qué hace ganar a este creativo (replicar)
//   · categoria 'antivideo' → autopsia: anti-patrones (qué NO volver a hacer)
// El resultado queda en meta_ads.fusion y alimenta al Cerebro.
// Procesa máx. 2 por corrida (cada análisis toma ~1 min).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { runFusion, type FusionMode } from '@/lib/fusion-core';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BATCH = 2;

export async function GET(request: NextRequest) {
  // Autorización: cron de Vercel (header x-vercel-cron / CRON_SECRET) o usuario logueado
  const isVercelCron =
    request.headers.get('x-vercel-cron') !== null ||
    (request.headers.get('user-agent') ?? '').includes('vercel-cron');
  const cronSecret = process.env.CRON_SECRET;
  const hasSecret = cronSecret
    ? request.headers.get('authorization') === `Bearer ${cronSecret}`
    : false;
  if (!isVercelCron && !hasSecret) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const sb = getSupabase();

  const { data: pending, error } = await sb
    .from('v_ads_para_analizar')
    .select('brand_id,name,categoria,spend7,roas7,analizado')
    .eq('analizado', false)
    .order('spend7', { ascending: false })
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pending?.length) {
    return NextResponse.json({ ok: true, processed: 0, msg: 'Nada pendiente de analizar.' });
  }

  const results: Array<{ ad: string; categoria: string; ok: boolean; error?: string }> = [];
  for (const p of pending) {
    const mode: FusionMode = p.categoria === 'antivideo' ? 'antivideo' : 'ganador';
    const r = await runFusion(p.brand_id, p.name, mode);
    results.push({ ad: p.name, categoria: p.categoria, ok: !r.error, error: r.error });
  }

  // Bitácora en Supabase para que el Panel y sync_logs lo registren
  const okCount = results.filter((r) => r.ok).length;
  await sb.from('sync_logs').insert({
    ok: okCount === results.length,
    rows_upserted: 0,
    detail: `auto-analyze: ${JSON.stringify(results).slice(0, 800)}`,
  });

  return NextResponse.json({ ok: true, processed: results.length, results });
}
