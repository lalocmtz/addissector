// /api/plan/hooks — the hook bank (its own table since migration 013).
import { makeCrud } from '@/lib/crud';

export const runtime = 'nodejs';

const crud = makeCrud({
  table: 'hook',
  select: 'id,title,body,hook_type,status,source,evidence,ad_ids,created_at,updated_at',
  writable: ['title', 'body', 'hook_type', 'status', 'source', 'evidence', 'ad_ids'],
  orderBy: { column: 'created_at', ascending: false },
  limit: 1000,
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PATCH = crud.PATCH;
export const DELETE = crud.DELETE;
