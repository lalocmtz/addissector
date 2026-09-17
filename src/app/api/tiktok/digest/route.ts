// =============================================================================
// GET /api/tiktok/digest?product= — el destilado de UN producto.
//
// Es el único entregable que importa del modo: juntar los videos marcados como
// ganadores y sacar de ellos un bloque de texto que se pega en cualquier chat
// para que escriba el siguiente video de ESE producto.
//
// Solo entran los ganadores. Un video que el vendedor no marcó no es evidencia
// de nada, y meterlo diluye el patrón — que es justo lo que hace inútiles a las
// bibliotecas: guardarlo todo y no distinguir.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { tiktokEnabled } from '@/lib/tiktok-server';

export const runtime = 'nodejs';

interface Video {
  title: string | null; hook: string | null; headline: string | null;
  framework: string | null; why_worked: string | null; origin: string;
  beats: { t: number; what: string; role: string }[] | null;
  analysis: Record<string, unknown> | null;
  notes: string | null;
}

const lim = (s: string | null | undefined, n = 220) =>
  (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tiktokEnabled(user.id))) return NextResponse.json({ error: 'Modo no disponible' }, { status: 403 });

  const productId = request.nextUrl.searchParams.get('product');
  if (!productId) return NextResponse.json({ error: 'Falta product' }, { status: 400 });

  const sb = getSupabase();
  const { data: prod } = await sb.from('tt_product').select('id,name,category,notes,mechanism')
    .eq('id', productId).eq('user_id', user.id).maybeSingle();
  if (!prod) return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  const p = prod as { name: string; category: string | null; notes: string | null; mechanism: string | null };

  const [{ data: vids }, { data: personas }] = await Promise.all([
    sb.from('tt_video')
      .select('title,hook,headline,framework,why_worked,origin,beats,analysis,notes')
      .eq('product_id', productId).eq('user_id', user.id).eq('winner', true)
      .order('created_at', { ascending: false }).limit(20),
    sb.from('personas').select('name,description,pains,desires,objections')
      .eq('product_id', productId).eq('user_id', user.id).limit(5),
  ]);

  const videos = (vids ?? []) as Video[];
  const L: string[] = [];

  L.push(`# ${p.name}${p.category ? ` · ${p.category}` : ''} — lo que funcionó en TikTok Shop`);
  L.push('');
  if (p.notes) { L.push(`Qué es: ${lim(p.notes, 500)}`); }
  if (p.mechanism) { L.push(`Por qué funciona: ${lim(p.mechanism, 500)}`); }
  L.push('');

  const avatares = (personas ?? []) as { name: string; description: string | null; pains: string | null; desires: string | null; objections: string | null }[];
  if (avatares.length) {
    L.push('## A quién le vendemos');
    for (const a of avatares) {
      L.push(`· ${a.name}${a.description ? ` — ${lim(a.description, 200)}` : ''}`);
      if (a.pains) L.push(`  le duele: ${lim(a.pains)}`);
      if (a.objections) L.push(`  no compra porque: ${lim(a.objections)}`);
    }
    L.push('');
  }

  if (!videos.length) {
    L.push('## Videos ganadores');
    L.push('Todavía no hay ninguno marcado como ganador. Marca los que sí vendieron y vuelve:');
    L.push('sin eso, lo de abajo sería una opinión en vez de un patrón.');
    return NextResponse.json({ product: p.name, winners: 0, prompt: L.join('\n') });
  }

  // Los frameworks que se repiten son el hallazgo: uno solo es una anécdota.
  const conteo = new Map<string, number>();
  for (const v of videos) {
    const f = (v.framework ?? '').trim();
    if (f) conteo.set(f, (conteo.get(f) ?? 0) + 1);
  }
  const repetidos = [...conteo.entries()].sort((a, b) => b[1] - a[1]);

  if (repetidos.length) {
    L.push('## Los frameworks que ya funcionaron');
    for (const [f, n] of repetidos) L.push(`· ${f}${n > 1 ? ` — se repitió en ${n} videos ganadores` : ''}`);
    L.push('');
  }

  L.push(`## Los ${videos.length} videos ganadores, desmenuzados`);
  L.push('');
  for (const v of videos) {
    L.push(`### ${v.title ?? 'Sin título'}${v.origin === 'mio' ? ' (mío)' : ''}`);
    if (v.framework) L.push(`Framework: ${v.framework}`);
    if (v.hook) L.push(`Primera frase: "${lim(v.hook)}"`);
    if (v.headline) L.push(`Primer texto en pantalla: "${lim(v.headline)}"`);
    if (v.why_worked) L.push(`Por qué funciona: ${lim(v.why_worked, 400)}`);
    const a = (v.analysis ?? {}) as Record<string, unknown>;
    const objecion = typeof a.objection === 'string' ? a.objection : '';
    const retencion = typeof a.retention_hook === 'string' ? a.retention_hook : '';
    if (objecion) L.push(`Objeción que tumba: ${lim(objecion)}`);
    if (retencion) L.push(`Qué retiene después del segundo 3: ${lim(retencion)}`);
    if (v.beats?.length) {
      L.push('Estructura:');
      for (const b of v.beats) L.push(`  ${b.t}s · ${b.role || 'momento'}: ${lim(b.what, 160)}`);
    }
    if (v.notes) L.push(`Nota mía: ${lim(v.notes, 300)}`);
    L.push('');
  }

  L.push('## Qué hacer con esto');
  L.push('Escribe guiones nuevos para este producto usando los frameworks de arriba.');
  L.push('Respeta la estructura beat por beat y el tipo de primera frase; cambia el ejemplo,');
  L.push('el escenario y las palabras. No copies el guión — copia la mecánica que lo hizo funcionar.');

  return NextResponse.json({ product: p.name, winners: videos.length, prompt: L.join('\n') });
}
