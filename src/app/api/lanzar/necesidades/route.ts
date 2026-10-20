// GET /api/lanzar/necesidades?brand= — "Qué necesita la cuenta" + "Qué hay
// pendiente" + los ganadores que se pueden iterar (para la puerta Iterar).
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { contextoCreativo } from '@/lib/contexto-creativo';
import { HoyError } from '@/lib/hoy';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  try {
    const c = await contextoCreativo(getSupabase(), brandId, user.id);
    return NextResponse.json({
      necesidades: c.necesidades,
      pendientes: c.pendientes,
      ganadores: c.ganadores.map(({ transcript, veredicto, receta, conservar, probar, ...g }) => ({ ...g, analizado: Boolean(transcript || veredicto || receta || conservar || probar) })),
      personas: c.personas.map((p) => ({ id: p.id, name: p.name })),
    });
  } catch (e) {
    const status = e instanceof HoyError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status });
  }
}
