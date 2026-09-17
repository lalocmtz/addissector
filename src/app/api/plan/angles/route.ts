// /api/plan/angles — banco de ángulos (la razón de compra).
//
// `angles.code` es NOT NULL y no tiene default, y el POST insertaba sin code:
// por eso "Agregar ángulo" moría con un 500 en producción. El servidor genera
// ahora un código provisional único por marca (NUEVO001, NUEVO002…) que el
// dueño renombra después a su nomenclatura [AVATAR:3][PALANCA:2][ORIGEN:1][SEC:2].
import { makeCrud } from '@/lib/crud';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';

/** Siguiente NUEVOnnn libre en la marca. Sin colisiones ni códigos nulos. */
async function nextProvisionalCode(brandId: string, userId: string): Promise<string> {
  const sb = getSupabase();
  const { data } = await sb.from('angles').select('code')
    .eq('brand_id', brandId).eq('user_id', userId).like('code', 'NUEVO%').limit(500);
  let max = 0;
  for (const row of (data ?? []) as { code: string | null }[]) {
    const m = /^NUEVO(\d{1,4})$/.exec((row.code ?? '').trim().toUpperCase());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `NUEVO${String(max + 1).padStart(3, '0')}`;
}

const crud = makeCrud({
  table: 'angles',
  select: 'id,code,name,persona_id,definition,example,reference_url,reference_kind,pain,desire,mechanism,psychology,objection,awareness_stage,funnel_stage,status,derived_status,priority,evidence,learnings,source,created_at',
  writable: ['code', 'name', 'persona_id', 'definition', 'example', 'reference_url', 'reference_kind', 'pain', 'desire', 'mechanism', 'psychology', 'objection', 'awareness_stage', 'funnel_stage', 'status', 'priority', 'evidence', 'learnings', 'source'],
  notNull: ['code', 'name', 'status'],
  beforeCreate: async ({ brandId, userId, values }) => {
    const out: Record<string, unknown> = {};
    if (!values.code) out.code = await nextProvisionalCode(brandId, userId);
    if (!values.name) out.name = 'Concepto nuevo';
    if (!values.status) out.status = 'sin_probar';
    return out;
  },
  orderBy: { column: 'created_at', ascending: false },
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PATCH = crud.PATCH;
export const DELETE = crud.DELETE;
