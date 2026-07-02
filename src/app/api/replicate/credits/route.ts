import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/supabase-server';
import { getKieCredits, isKieConfigured, COST_ESTIMATES } from '@/lib/kie';

export const runtime = 'nodejs';
export const maxDuration = 15;

// ---------------------------------------------------------------------------
// GET /api/replicate/credits — saldo de Kie.ai + estimaciones de costo, para
// mostrarlas ANTES de cada generación.
// ---------------------------------------------------------------------------
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  if (!isKieConfigured()) {
    return NextResponse.json({ configured: false, credits: null, estimates: COST_ESTIMATES });
  }
  const credits = await getKieCredits();
  return NextResponse.json({ configured: true, credits, estimates: COST_ESTIMATES });
}
