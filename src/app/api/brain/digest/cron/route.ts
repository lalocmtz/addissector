// =============================================================================
// GET /api/brain/digest/cron — cada martes (vercel.json), para cada marca con
// cuenta de Meta activa: destilado de 7 y 30 días + síntesis de Claude, guardado
// como .md en brand-assets/<user>/<marca>/cerebro/. En el Cerebro aparece en
// "Qué funciona → Archivos semanales" listo para subir al proyecto de Claude.
// Auth: Authorization: Bearer <CRON_SECRET> (Vercel lo manda solo).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { computeDestilado, archivoSemanal, guardarSemanal } from '@/lib/cerebro-destilado';
import { sintetizar } from '@/lib/cerebro-sintesis';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || (auth !== `Bearer ${secret}` && request.headers.get('x-cron-secret') !== secret)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const sb = getSupabase();
  const { data: cuentas } = await sb.from('ad_account').select('brand_id').eq('active', true);
  const marcas = [...new Set((cuentas ?? []).map((c) => c.brand_id as string))];
  const { data: brands } = marcas.length ? await sb.from('brands').select('id,user_id,name').in('id', marcas) : { data: [] };

  const resultado: { marca: string; ok: boolean; archivo?: string; error?: string }[] = [];
  for (const b of brands ?? []) {
    try {
      const d = await computeDestilado(sb, b.id as string);
      if (!d.ventanas.some((v) => v.gasto > 0)) { resultado.push({ marca: String(b.name), ok: false, error: 'sin gasto' }); continue; }
      let sintesis: string | null = null;
      try { sintesis = (await sintetizar(d))?.markdown ?? null; } catch { /* sale sin síntesis */ }
      const a = await guardarSemanal(sb, b.user_id as string, b.id as string, d, archivoSemanal(d, sintesis));
      resultado.push({ marca: String(b.name), ok: true, archivo: a.path });
    } catch (e) {
      resultado.push({ marca: String(b.name), ok: false, error: e instanceof Error ? e.message : 'falló' });
    }
  }
  return NextResponse.json({ ok: true, resultado });
}
