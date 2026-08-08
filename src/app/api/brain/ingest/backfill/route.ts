// =============================================================================
// /api/brain/ingest/backfill — POST {brandId}
// Recorre los análisis que el cerebro todavía no ha leído y los ingiere EN
// SERIE, máximo 8 por llamada para no pasarse del tiempo de la función.
// Devuelve `remaining` para que el cliente vuelva a llamar hasta llegar a 0.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { ingestCreative, pendingCount, type IngestCounts, type IngestItem } from '@/lib/brain-ingest-run';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BATCH = 8;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { brandId?: string };
  if (!body.brandId) return NextResponse.json({ error: 'Falta brandId' }, { status: 400 });

  const sb = getSupabase();
  const created: IngestCounts = { personas: 0, angles: 0, hooks: 0, learnings: 0 };
  const merged: IngestCounts = { personas: 0, angles: 0, hooks: 0, learnings: 0 };
  const items: IngestItem[] = [];
  let processed = 0;
  let lastError: string | undefined;

  try {
    const { data: pend } = await sb
      .from('creatives')
      .select('id')
      .eq('user_id', user.id)
      .eq('brand_id', body.brandId)
      .not('analysis', 'is', null)
      .is('ingested_at', null)
      .order('created_at', { ascending: false })
      .limit(BATCH);

    for (const row of pend ?? []) {
      const summary = await ingestCreative({
        sb,
        userId: user.id,
        creativeId: row.id as string,
        brandId: body.brandId,
      });
      processed++;
      created.personas += summary.created.personas;
      created.angles += summary.created.angles;
      created.hooks += summary.created.hooks;
      created.learnings += summary.created.learnings;
      merged.personas += summary.merged.personas;
      merged.angles += summary.merged.angles;
      items.push(...summary.items);
      if (summary.error) lastError = summary.error;
    }

    const remaining = await pendingCount(sb, user.id, body.brandId);
    return NextResponse.json({ processed, remaining, created, merged, items, ...(lastError ? { error: lastError } : {}) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error alimentando el cerebro';
    return NextResponse.json({ processed, remaining: 0, created, merged, items, error: message });
  }
}
