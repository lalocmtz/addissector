// =============================================================================
// /api/brain/ingest — El cerebro lee un anuncio ganador y se alimenta de él.
// POST {brandId?, creativeId} · GET ?brand=  -> {pending}
//
// Nunca truena: si algo falla responde 200 con el resumen en ceros y el error
// dentro, para no romper el flujo del análisis que el usuario está viendo.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { ingestCreative, pendingCount } from '@/lib/brain-ingest-run';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  try {
    const pending = await pendingCount(getSupabase(), user.id, brandId);
    return NextResponse.json({ pending });
  } catch {
    return NextResponse.json({ pending: 0 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    brandId?: string | null;
    creativeId?: string;
  };
  if (!body.creativeId) return NextResponse.json({ error: 'Falta creativeId' }, { status: 400 });

  try {
    const summary = await ingestCreative({
      userId: user.id,
      creativeId: body.creativeId,
      brandId: body.brandId ?? null,
    });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error alimentando el cerebro';
    return NextResponse.json({
      created: { personas: 0, angles: 0, hooks: 0, learnings: 0 },
      merged: { personas: 0, angles: 0, hooks: 0, learnings: 0 },
      items: [],
      error: message,
    });
  }
}
