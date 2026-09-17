// /api/tiktok/products — los productos del vendedor. La unidad de todo el modo.
import { makeCrud } from '@/lib/crud';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/supabase-server';
import { tiktokEnabled } from '@/lib/tiktok-server';

export const runtime = 'nodejs';

const crud = makeCrud({
  table: 'tt_product',
  select: 'id,name,category,notes,mechanism,image_url,status,created_at',
  writable: ['name', 'category', 'notes', 'mechanism', 'image_url', 'status'],
  notNull: ['name'],
  orderBy: { column: 'created_at', ascending: true },
});

/** Cada verbo revisa la llave antes de tocar nada: la UI no es una defensa. */
async function guard(): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tiktokEnabled(user.id))) return NextResponse.json({ error: 'Modo no disponible' }, { status: 403 });
  return null;
}

export async function GET(r: NextRequest) { return (await guard()) ?? crud.GET(r); }
export async function POST(r: NextRequest) { return (await guard()) ?? crud.POST(r); }
export async function PATCH(r: NextRequest) { return (await guard()) ?? crud.PATCH(r); }
export async function DELETE(r: NextRequest) { return (await guard()) ?? crud.DELETE(r); }
