// =============================================================================
// POST /api/fusion — La mesa redonda: psicólogo + creative strategist +
// analista desmenuzan UN creativo. La lógica vive en src/lib/fusion-core.ts
// (compartida con el cron /api/auto-analyze). mode opcional: 'ganador' | 'antivideo'.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/supabase-server';
import { runFusion, type FusionMode } from '@/lib/fusion-core';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { brandId, adName, mode } = (await request.json()) as {
    brandId: string; adName: string; mode?: FusionMode;
  };
  if (!brandId || !adName) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });

  const result = await runFusion(brandId, adName, mode ?? 'ganador');
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ fusion: result.fusion });
}
