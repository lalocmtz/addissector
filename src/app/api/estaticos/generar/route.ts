// =============================================================================
// /api/estaticos/generar — una versión de un estático con Kie.ai.
//   POST { brandId, prompt, imagenes[], aspect }  → { taskId, model }
//   GET  ?brand=&taskId=                          → { estado, url?, error? }
// Al terminar, la imagen se copia a nuestro bucket (brand-assets/<user>/<marca>/
// generadas/<taskId>.png): los archivos de Kie se borran a los 14 días.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { getKieKey, crearImagen, estadoImagen, type Aspect } from '@/lib/kie';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BUCKET = 'brand-assets';
const ASPECTS: Aspect[] = ['1:1', '4:5', '9:16', '16:9', '3:4'];

async function marcaDelUsuario(brandId: string, userId: string) {
  const { data } = await getSupabase().from('brands').select('id').eq('id', brandId).eq('user_id', userId).maybeSingle();
  return Boolean(data);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { brandId?: string; prompt?: string; imagenes?: string[]; aspect?: string };
  if (!b.brandId || !(await marcaDelUsuario(b.brandId, user.id))) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });
  const prompt = (b.prompt ?? '').trim();
  if (!prompt) return NextResponse.json({ error: 'Falta el prompt' }, { status: 400 });
  const key = await getKieKey(getSupabase(), user.id);
  if (!key) return NextResponse.json({ error: 'Falta la clave de Kie.ai', sinClave: true }, { status: 400 });
  const aspect = (ASPECTS as string[]).includes(b.aspect ?? '') ? (b.aspect as Aspect) : '9:16';
  try {
    const t = await crearImagen(key, { prompt, imagenes: (b.imagenes ?? []).filter((u) => /^https?:\/\//.test(u)), aspect });
    return NextResponse.json(t);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Kie.ai falló' }, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const brandId = sp.get('brand') ?? '';
  const taskId = (sp.get('taskId') ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!taskId || !(await marcaDelUsuario(brandId, user.id))) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  const sb = getSupabase();
  const key = await getKieKey(sb, user.id);
  if (!key) return NextResponse.json({ error: 'Falta la clave de Kie.ai', sinClave: true }, { status: 400 });

  const st = await estadoImagen(key, taskId);
  if (st.estado !== 'listo') return NextResponse.json(st);

  // Copia permanente (idempotente: el nombre es el taskId).
  const path = `${user.id}/${brandId}/generadas/${taskId}.png`;
  const publica = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  try {
    const r = await fetch(st.urls[0], { cache: 'no-store' });
    if (r.ok) {
      const bytes = new Uint8Array(await r.arrayBuffer());
      const type = r.headers.get('content-type') ?? 'image/png';
      const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: true });
      if (!error) return NextResponse.json({ ...st, url: publica, original: st.urls[0] });
    }
  } catch { /* si la copia falla se entrega la URL de Kie */ }
  return NextResponse.json({ ...st, url: st.urls[0], original: st.urls[0], sinCopia: true });
}
