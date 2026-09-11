// =============================================================================
// /api/workshop/brief/editor?batch=&format=md|json
//   The brief the EDITOR executes — one cover for the tanda and one card per
//   piece. Nothing here is typed twice: marca, ángulo, concepto, funnel,
//   variable, hipótesis, win condition and prohibiciones come from the tanda;
//   código, formato, ratio, hook, beats, producto, CTA and compliance from the
//   piece and the rules in batch.ts.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { BATCH_SELECT, PIECE_SELECT, type PieceRow } from '@/lib/batch-server';
import { baseFormat, brandCode, isVideoFormat, prohibitionsFor } from '@/lib/batch';

export const runtime = 'nodejs';

const VARIABLE_ES: Record<string, string> = {
  hook: 'Hook (0–3 s / frase en pantalla)', format: 'Formato', offer: 'Oferta', proof_type: 'Tipo de prueba',
  awareness_level: 'Nivel de conciencia', creator: 'Creador', visual_style: 'Estilo visual', cta: 'Llamado a la acción',
};
const FORMAT_ES: Record<string, string> = { static: 'Estático', video: 'Video', ugc: 'UGC', carousel: 'Carrusel', animation: 'Animación' };

const CTA_BY_FUNNEL: Record<string, string> = {
  TOF: 'Suave: "Descúbrelo" / "Ver cómo funciona". Sin precio ni garantía.',
  MOF: '"Pruébalo" / "Ver más". Sin precio ni garantía.',
  BOF: 'Directo: "Compra ahora" / "Aprovecha". Aquí sí puede ir precio, garantía y envío.',
};
const PRODUCT_ENTRY: Record<string, string> = {
  TOF: 'Después del hook (nunca en el frame 1).',
  MOF: 'Desde el segundo beat (3–10 s), como la solución.',
  BOF: 'Desde el inicio; el producto es el protagonista.',
};

interface Doc { concept?: string | null; funnel?: string | null; base_format?: string | null; win_condition?: string | null; brand_code?: string | null; prohibitions?: string[] }

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const batchId = request.nextUrl.searchParams.get('batch');
  if (!batchId) return NextResponse.json({ error: 'Missing batch' }, { status: 400 });
  const wantsJson = request.nextUrl.searchParams.get('format') === 'json';

  const sb = getSupabase();
  const { data: raw } = await sb.from('experiment').select(BATCH_SELECT).eq('id', batchId).eq('user_id', user.id).maybeSingle();
  if (!raw) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  const b = raw as unknown as { id: string; brand_id: string; code: string; name: string; status: string; variable: string; awareness: string | null; hypothesis: string | null; hypothesis_doc: Doc | null; angle_id: string | null; impression_cap: number | null; notes: string | null };

  const [pieceRes, angleRes, brandRes] = await Promise.all([
    sb.from('experiment_variant').select(PIECE_SELECT).eq('experiment_id', batchId).order('variant'),
    b.angle_id ? sb.from('angles').select('code,name,mechanism,objection').eq('id', b.angle_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('brands').select('name').eq('id', b.brand_id).maybeSingle(),
  ]);
  const pieces = (pieceRes.data ?? []) as unknown as PieceRow[];
  const angle = angleRes.data as { code: string | null; name: string; mechanism: string | null; objection: string | null } | null;
  const brandName = (brandRes.data as { name: string } | null)?.name ?? '';
  const doc = (b.hypothesis_doc ?? {}) as Doc;
  const brand = doc.brand_code ?? brandCode(brandName);
  const funnel = doc.funnel ?? '—';
  const prohibitions = doc.prohibitions?.length ? doc.prohibitions : prohibitionsFor(brand, doc.funnel);

  const cards = pieces.map((p) => {
    const bf = baseFormat(p.format_code);
    const video = isVideoFormat(p.format_code) || (!p.format_code && p.format !== 'static' && p.format !== 'carousel');
    const compliance = [...prohibitions];
    if (video && brand === 'SG' && doc.funnel === 'TOF') compliance.push('Frame 1: sin producto, sin logo.');
    return {
      codigo: p.ad_name,
      formato: bf ? `${bf.code} · ${bf.es}` : (FORMAT_ES[p.format ?? ''] ?? p.format ?? ''),
      ratio: bf?.ratio ?? (video ? '9:16 / 4:5' : '4:5 / 1:1'),
      hook: p.hook ?? '',
      beats: p.beats ?? null,
      guion: p.script ?? null,
      nota_visual: p.visual_notes ?? null,
      modo_falla: p.failure_mode ?? null,
      producto_entra: PRODUCT_ENTRY[doc.funnel ?? ''] ?? 'Cuando el guion lo pida; nunca antes del hook.',
      cta: CTA_BY_FUNNEL[doc.funnel ?? ''] ?? 'Según el funnel de la tanda.',
      compliance,
      estado: p.status,
    };
  });

  const tanda = {
    codigo: b.code, nombre: b.name, marca: brandName, marca_codigo: brand,
    angulo: angle ? `${angle.code ?? ''} ${angle.name}`.trim() : null,
    mecanismo: angle?.mechanism ?? null, objecion: angle?.objection ?? null,
    concepto: doc.concept ?? null, funnel, formato_base: doc.base_format ? `${doc.base_format} · ${baseFormat(doc.base_format)?.es ?? ''}` : null,
    variable: VARIABLE_ES[b.variable] ?? b.variable,
    hipotesis: b.hypothesis ?? null, win_condition: doc.win_condition ?? null,
    prohibiciones: prohibitions, tope_impresiones: b.impression_cap ?? 1500, notas: b.notes ?? null,
  };

  if (wantsJson) return NextResponse.json({ tanda, piezas: cards });

  const L: string[] = [];
  const push = (s = '') => L.push(s);
  push(`# Brief editor · ${tanda.codigo} · ${tanda.nombre}`);
  push();
  push(`- **Marca:** ${tanda.marca} (${tanda.marca_codigo})`);
  push(`- **Ángulo:** ${tanda.angulo ?? '—'}`);
  if (tanda.mecanismo) push(`- **Mecanismo:** ${tanda.mecanismo}`);
  push(`- **Concepto:** ${tanda.concepto ?? '—'}`);
  push(`- **Funnel:** ${tanda.funnel}`);
  push(`- **Formato base:** ${tanda.formato_base ?? '—'}`);
  push(`- **Variable única:** ${tanda.variable} — todo lo demás igual entre piezas.`);
  push(`- **Hipótesis:** ${tanda.hipotesis ?? '—'}`);
  push(`- **Win condition:** ${tanda.win_condition ?? '—'}`);
  push('- **Prohibiciones:**');
  for (const x of prohibitions) push(`  - ${x}`);
  if (tanda.notas) push(`- **Notas:** ${tanda.notas}`);
  push();
  push('## Piezas');
  push('El código es el nombre del anuncio en Meta. Se pega sin cambiar una letra.');
  push();
  if (!cards.length) push('_(todavía no hay piezas)_');
  cards.forEach((c, i) => {
    push(`### ${i + 1}. \`${c.codigo}\``);
    push(`- **Formato:** ${c.formato} · **Ratio:** ${c.ratio}`);
    push(`- **Hook (literal):** ${c.hook}`);
    if (c.beats) {
      push('- **Beats:**');
      if (c.beats.open) push(`  - 0–3 s: ${c.beats.open}`);
      if (c.beats.body) push(`  - 3–10 s: ${c.beats.body}`);
      if (c.beats.close) push(`  - Cierre: ${c.beats.close}`);
    }
    if (c.guion) { push('- **Guion:**'); push(''); push(c.guion.split('\n').map((l) => `  ${l}`).join('\n')); push(''); }
    if (c.nota_visual) push(`- **Nota visual:** ${c.nota_visual}`);
    push(`- **Cuándo entra el producto:** ${c.producto_entra}`);
    push(`- **CTA:** ${c.cta}`);
    if (c.modo_falla) push(`- **Modo de falla a evitar:** ${c.modo_falla}`);
    push('- **Compliance:**');
    for (const x of c.compliance) push(`  - ${x}`);
    push();
  });
  push(`_Generado por AdDissector · ${new Date().toISOString().slice(0, 10)}_`);

  return new NextResponse(L.join('\n'), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="brief-editor-${b.code}.md"` },
  });
}
