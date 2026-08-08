// =============================================================================
// AdDNA — Fábrica de handlers CRUD para los bancos del Cerebro.
// Todas las tablas del motor de planificación comparten la misma forma:
// filtradas por brand_id + user_id, con RLS encima. Esto evita repetir
// cuatro veces el mismo archivo.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';

export interface CrudConfig {
  table: string;
  /** Columnas que se devuelven en el GET. */
  select: string;
  /** Columnas que el cliente puede escribir. */
  writable: string[];
  /** Orden por defecto. */
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
}

function pick(body: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (body[k] !== undefined) {
      const v = body[k];
      out[k] = typeof v === 'string' ? (v.trim() || null) : v;
    }
  }
  return out;
}

export function makeCrud(cfg: CrudConfig) {
  const order = cfg.orderBy ?? { column: 'created_at', ascending: false };

  async function GET(request: NextRequest) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const brandId = request.nextUrl.searchParams.get('brand');
    if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
    const sb = getSupabase();
    const { data, error } = await sb
      .from(cfg.table)
      .select(cfg.select)
      .eq('brand_id', brandId)
      .eq('user_id', user.id)
      .order(order.column, { ascending: order.ascending ?? false })
      .limit(cfg.limit ?? 500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ items: data ?? [] });
  }

  async function POST(request: NextRequest) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const body = (await request.json()) as Record<string, unknown>;
    const brandId = body.brandId as string;
    if (!brandId) return NextResponse.json({ error: 'Falta brandId' }, { status: 400 });
    const sb = getSupabase();
    const { data, error } = await sb
      .from(cfg.table)
      .insert({ ...pick(body, cfg.writable), user_id: user.id, brand_id: brandId })
      .select(cfg.select)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ item: data });
  }

  async function PATCH(request: NextRequest) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const body = (await request.json()) as Record<string, unknown>;
    const id = body.id as string;
    if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
    const patch = pick(body, cfg.writable);
    patch.updated_at = new Date().toISOString();
    const sb = getSupabase();
    const { data, error } = await sb
      .from(cfg.table)
      .update(patch)
      .eq('id', id)
      .eq('user_id', user.id)
      .select(cfg.select)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ item: data });
  }

  async function DELETE(request: NextRequest) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
    const sb = getSupabase();
    const { error } = await sb.from(cfg.table).delete().eq('id', id).eq('user_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return { GET, POST, PATCH, DELETE };
}
