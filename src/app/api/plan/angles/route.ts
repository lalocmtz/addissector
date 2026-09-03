// /api/plan/angles — banco de ángulos (la razón de compra).
import { makeCrud } from '@/lib/crud';

export const runtime = 'nodejs';

const crud = makeCrud({
  table: 'angles',
  select: 'id,code,name,persona_id,pain,desire,mechanism,psychology,objection,awareness_stage,funnel_stage,status,derived_status,priority,evidence,learnings,source,created_at',
  writable: ['code', 'name', 'persona_id', 'pain', 'desire', 'mechanism', 'psychology', 'objection', 'awareness_stage', 'funnel_stage', 'status', 'priority', 'evidence', 'learnings', 'source'],
  orderBy: { column: 'created_at', ascending: false },
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PATCH = crud.PATCH;
export const DELETE = crud.DELETE;
