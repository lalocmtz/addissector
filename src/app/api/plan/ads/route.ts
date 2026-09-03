// /api/plan/ads — experiment variants (the ads to produce). Pinned to Meta by meta_ad_id.
import { makeCrud } from '@/lib/crud';

export const runtime = 'nodejs';

const crud = makeCrud({
  table: 'experiment_variant',
  select: 'id,experiment_id,concept_id,ad_name,variant,hook_id,hook,format,script,visual_notes,status,owner_id,meta_ad_id,matched_at,uploaded_at,created_at',
  writable: ['experiment_id', 'concept_id', 'ad_name', 'variant', 'hook_id', 'hook', 'format', 'script', 'visual_notes', 'status', 'owner_id', 'meta_ad_id', 'uploaded_at'],
  orderBy: { column: 'ad_name', ascending: true },
  limit: 2000,
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PATCH = crud.PATCH;
export const DELETE = crud.DELETE;
