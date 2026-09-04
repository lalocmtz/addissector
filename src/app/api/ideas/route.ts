// /api/ideas — the inbox. Anything worth testing, from anyone. Cheap until promoted.
import { makeCrud } from '@/lib/crud';

export const runtime = 'nodejs';

const crud = makeCrud({
  table: 'idea',
  select: 'id,text,rationale,source,status,variable,persona_id,angle_id,concept_id,hook_id,dimension,dimension_value,evidence,experiment_id,owner_id,created_by,discarded_reason,notes,created_at,updated_at',
  writable: ['text', 'rationale', 'source', 'status', 'variable', 'persona_id', 'angle_id', 'concept_id', 'hook_id', 'dimension', 'dimension_value', 'evidence', 'owner_id', 'created_by', 'discarded_reason', 'notes'],
  orderBy: { column: 'created_at', ascending: false },
  limit: 1000,
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PATCH = crud.PATCH;
export const DELETE = crud.DELETE;
