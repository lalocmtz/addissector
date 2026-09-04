// /api/products — the products of a brand. An experiment names the product it tests.
import { makeCrud } from '@/lib/crud';

export const runtime = 'nodejs';

const crud = makeCrud({
  table: 'product',
  select: 'id,name,description,price,url,active,created_at',
  writable: ['name', 'description', 'price', 'url', 'active'],
  orderBy: { column: 'created_at', ascending: true },
  limit: 200,
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PATCH = crud.PATCH;
export const DELETE = crud.DELETE;
