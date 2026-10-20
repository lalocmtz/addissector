// =============================================================================
// /api/brain/digest — qué está funcionando (Cerebro → "Qué funciona").
//
//   GET  ?brand=          las ventanas de 7, 15 y 30 días con cada ganador y
//                         perdedor: métricas, hook verbal, hook visual, texto en
//                         pantalla, estructura, guion y receta (de lo que el
//                         barrido extrajo), + los archivos semanales guardados.
//   POST { brandId }      genera la foto de hoy: Claude sintetiza los patrones,
//                         se arma el .md para el proyecto de Claude y se guarda
//                         en brand-assets/<user>/<marca>/cerebro/.
//
// El cron de los martes (/api/brain/digest/cron) hace el POST solo.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { computeDestilado, archivoSemanal, guardarSemanal, listarSemanales } from '@/lib/cerebro-destilado';
import { sintetizar } from '@/lib/cerebro-sintesis';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function marcaDelUsuario(brandId: string, userId: string) {
  const { data } = await getSupabase().from('brands').select('id').eq('id', brandId).eq('user_id', userId).maybeSingle();
  return Boolean(data);
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId || !(await marcaDelUsuario(brandId, user.id))) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });
  const sb = getSupabase();
  try {
    const [d, semanales] = await Promise.all([computeDestilado(sb, brandId), listarSemanales(sb, user.id, brandId)]);
    return NextResponse.json({ ...d, semanales });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falló' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { brandId?: string };
  if (!b.brandId || !(await marcaDelUsuario(b.brandId, user.id))) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });
  const sb = getSupabase();
  try {
    const d = await computeDestilado(sb, b.brandId);
    let sintesis: string | null = null;
    let aviso: string | null = null;
    try {
      sintesis = (await sintetizar(d))?.markdown ?? null;
      if (!sintesis) aviso = 'No hubo ganadores con gasto suficiente: el archivo sale sin síntesis.';
    } catch (e) {
      aviso = `La síntesis falló (${e instanceof Error ? e.message : 'error'}); el archivo sale sin ella.`;
    }
    const markdown = archivoSemanal(d, sintesis);
    const archivo = await guardarSemanal(sb, user.id, b.brandId, d, markdown);
    return NextResponse.json({ ...archivo, sintesis, markdown, aviso });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falló' }, { status: 500 });
  }
}
