// /api/plan/personas — banco de avatares.
import { makeCrud } from '@/lib/crud';

export const runtime = 'nodejs';

const crud = makeCrud({
  table: 'personas',
  select: 'id,name,callout,description,pains,education_gap,solutions,desires,objections,offer_fit,awareness_stage,evidence,status,source,created_at',
  writable: ['name', 'callout', 'description', 'pains', 'education_gap', 'solutions', 'desires', 'objections', 'offer_fit', 'awareness_stage', 'evidence', 'status'],
  notNull: ['name'],
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PATCH = crud.PATCH;
export const DELETE = crud.DELETE;
