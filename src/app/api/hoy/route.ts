// =============================================================================
// GET /api/hoy?brand=  — la pantalla "Hoy". El cálculo vive en src/lib/hoy.ts
// (lo comparten Lanzar y el generador de guiones).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { computeHoy, HoyError } from '@/lib/hoy';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  try {
    return NextResponse.json(await computeHoy(getSupabase(), brandId, user.id));
  } catch (e) {
    const status = e instanceof HoyError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falló' }, { status });
  }
}
