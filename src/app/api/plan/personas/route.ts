// /api/plan/personas — banco de avatares.
import { makeCrud } from '@/lib/crud';

export const runtime = 'nodejs';

const crud = makeCrud({
  table: 'personas',
  select: 'id,name,description,pains,desires,objections,awareness_stage,evidence,status,created_at',
  writable: ['name', 'description', 'pains', 'desires', 'objections', 'awareness_stage', 'evidence', 'status'],
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PATCH = crud.PATCH;
export const DELETE = crud.DELETE;
