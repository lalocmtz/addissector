// /api/plan/ads — anuncios planeados. Su ad_name es el puente con Meta.
import { makeCrud } from '@/lib/crud';

export const runtime = 'nodejs';

const crud = makeCrud({
  table: 'planned_ads',
  select: 'id,concept_id,ad_name,variant,format,hook,script,visual_notes,status,owner,uploaded_at,created_at',
  writable: ['concept_id', 'ad_name', 'variant', 'format', 'hook', 'script', 'visual_notes', 'status', 'owner', 'uploaded_at'],
  orderBy: { column: 'ad_name', ascending: true },
  limit: 2000,
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PATCH = crud.PATCH;
export const DELETE = crud.DELETE;
