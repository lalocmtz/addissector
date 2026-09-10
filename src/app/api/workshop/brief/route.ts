// =============================================================================
// /api/workshop/brief?batch=
//   The brief the team executes, as one markdown document. Everything in it
//   already lives in the database — the tanda, its pieces with their minted
//   names, the angle, the persona, the brand economics. Nothing is typed twice.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { resolveEconomics } from '@/lib/meta';
import { BATCH_SELECT, PIECE_SELECT, type PieceRow } from '@/lib/batch-server';

export const runtime = 'nodejs';

const AWARENESS_ES: Record<string, string> = {
  unaware: 'No sabe que tiene el problema',
  problem_aware: 'Sabe el problema, no la solución',
  solution_aware: 'Conoce soluciones, no la nuestra',
  product_aware: 'Conoce el producto, no ha comprado',
  most_aware: 'Listo para comprar',
};
const VARIABLE_ES: Record<string, string> = {
  hook: 'el hook (primeros 3 segundos)', format: 'el formato', offer: 'la oferta', proof_type: 'el tipo de prueba',
  awareness_level: 'el nivel de conciencia', creator: 'el creador', visual_style: 'el estilo visual', cta: 'el llamado a la acción',
};
const FORMAT_ES: Record<string, string> = { static: 'Estático', video: 'Video', ugc: 'UGC', carousel: 'Carrusel', animation: 'Animación' };

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const batchId = request.nextUrl.searchParams.get('batch');
  if (!batchId) return NextResponse.json({ error: 'Missing batch' }, { status: 400 });
  const wantsJson = request.nextUrl.searchParams.get('format') === 'json';

  const sb = getSupabase();
  const { data: raw } = await sb.from('experiment').select(BATCH_SELECT).eq('id', batchId).eq('user_id', user.id).maybeSingle();
  if (!raw) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  const b = raw as unknown as { id: string; brand_id: string; code: string; name: string; status: string; variable: string; awareness: string | null; hypothesis: string | null; hypothesis_doc: unknown; angle_id: string | null; product_id: string | null; owner_id: string | null; planned_for: string | null; impression_cap: number | null; notes: string | null };

  const [pieceRes, angleRes, brandRes, memberRes, productRes] = await Promise.all([
    sb.from('experiment_variant').select(PIECE_SELECT).eq('experiment_id', batchId).order('variant'),
    b.angle_id ? sb.from('angles').select('code,name,pain,desire,mechanism,psychology,objection,awareness_stage,personas(name,description,pains,desires,objections)').eq('id', b.angle_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('brands').select('name,economics,product').eq('id', b.brand_id).maybeSingle(),
    sb.from('member').select('id,name,role').eq('user_id', user.id),
    b.product_id ? sb.from('product').select('name,description,price,url').eq('id', b.product_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const pieces = (pieceRes.data ?? []) as unknown as PieceRow[];
  const angle = angleRes.data as unknown as { code: string | null; name: string; pain: string | null; desire: string | null; mechanism: string | null; psychology: string | null; objection: string | null; awareness_stage: string | null; personas: { name: string; description: string | null; pains: string | null; desires: string | null; objections: string | null } | null } | null;
  const brand = brandRes.data as { name: string; economics: unknown; product: string | null } | null;
  const product = productRes.data as { name: string; description: string | null; price: number | null; url: string | null } | null;
  const eco = resolveEconomics(brand?.economics);
  const members = new Map((memberRes.data ?? []).map((m) => [m.id as string, `${m.name}${m.role ? ` (${m.role})` : ''}`]));
  const hd = (b.hypothesis_doc ?? null) as Record<string, unknown> | null;

  const lines: string[] = [];
  const push = (s = '') => lines.push(s);
  push(`# Brief · ${b.code} · ${b.name}`);
  push(`**Marca:** ${brand?.name ?? ''}${product ? ` · **Producto:** ${product.name}${product.price ? ` ($${product.price})` : ''}` : brand?.product ? ` · **Producto:** ${brand.product}` : ''}`);
  push(`**Estado:** ${b.status}${b.planned_for ? ` · **Para:** ${b.planned_for}` : ''}${b.owner_id ? ` · **Responsable:** ${members.get(b.owner_id) ?? ''}` : ''}`);
  push();
  push('## 1. Qué probamos (una sola variable)');
  push(`Esta tanda cambia **${VARIABLE_ES[b.variable] ?? b.variable}**. Todo lo demás se mantiene igual entre piezas: si se mueven dos cosas, el resultado no se puede leer.`);
  push();
  push('## 2. Hipótesis');
  push(b.hypothesis ? `> ${b.hypothesis}` : '> (sin hipótesis — escribe: "Si cambiamos X esperamos Y porque Z")');
  if (hd && typeof hd === 'object') {
    for (const [k, v] of Object.entries(hd)) if (typeof v === 'string' && v.trim()) push(`- **${k}:** ${v.trim()}`);
  }
  push();
  push('## 3. A quién le hablamos');
  push(`**Conciencia:** ${AWARENESS_ES[b.awareness ?? ''] ?? b.awareness ?? '—'}`);
  if (angle?.personas) {
    const p = angle.personas;
    push(`**Persona:** ${p.name}${p.description ? ` — ${p.description}` : ''}`);
    if (p.pains) push(`- Dolores: ${p.pains}`);
    if (p.desires) push(`- Deseos: ${p.desires}`);
    if (p.objections) push(`- Objeciones: ${p.objections}`);
  }
  push();
  push('## 4. Ángulo (por qué compra)');
  if (angle) {
    push(`**${angle.code ?? ''} · ${angle.name}**`);
    if (angle.pain) push(`- Dolor: ${angle.pain}`);
    if (angle.desire) push(`- Deseo: ${angle.desire}`);
    if (angle.mechanism) push(`- Mecanismo / promesa: ${angle.mechanism}`);
    if (angle.psychology) push(`- Psicología: ${angle.psychology}`);
    if (angle.objection) push(`- Objeción a vencer: ${angle.objection}`);
  } else push('—');
  push();
  push('## 5. Piezas a producir');
  push('Cada pieza lleva su nombre generado. **Se pega en Meta sin cambiar una letra**: así el rendimiento se llena solo en la plataforma.');
  push();
  if (!pieces.length) push('_(todavía no hay piezas)_');
  for (const p of pieces) {
    push(`### Pieza ${p.variant ?? ''} · ${FORMAT_ES[p.format ?? ''] ?? p.format ?? ''}${p.owner_id ? ` · hace: ${members.get(p.owner_id) ?? ''}` : ''}`);
    push(`- **Nombre del anuncio:** \`${p.ad_name}\``);
    push(`- **Hook (textual, primeros 3 s):** ${p.hook ?? ''}`);
    if (p.script) { push('- **Guion / estructura:**'); push(''); push(p.script.split('\n').map((l) => `  ${l}`).join('\n')); push(''); }
    if (p.visual_notes) push(`- **Notas visuales:** ${p.visual_notes}`);
    push(`- **Estado:** ${p.status}${p.meta_ad_id ? ' · ya al aire' : ''}`);
    push();
  }
  push('## 6. Qué NO cambia');
  push(`- Ángulo, persona, nivel de conciencia y oferta son fijos en toda la tanda.`);
  push(`- Solo cambia ${VARIABLE_ES[b.variable] ?? b.variable}.`);
  push();
  push('## 7. Cómo se decide');
  push(`- Meta ROAS: **${eco.target}x** · Breakeven: **${eco.breakeven}x** · Gasto mínimo para juzgar: **${eco.kill}**.`);
  push(`- Tope de impresiones por pieza: **${b.impression_cap ?? 1500}**. Se califica cuando todas llegan al tope.`);
  push('- Veredictos: escalar (volumen + ROAS), iterar (ROAS sin volumen), mantener (volumen sin ROAS), archivar (ninguno).');
  if (b.notes) { push(); push('## Notas'); push(String(b.notes)); }
  push(); push(`_Generado por AdDissector · ${new Date().toISOString().slice(0, 10)}_`);

  const md = lines.join('\n');
  if (wantsJson) return NextResponse.json({ markdown: md });
  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="brief-${b.code}.md"`,
    },
  });
}
