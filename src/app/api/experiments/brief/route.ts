// POST /api/experiments/brief { id } — writes (or rewrites) the production brief of an experiment.
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { anthropicApiKey } from '@/lib/ai';
import { writeBrief } from '@/lib/agents/brief-writer';
import { EXPERIMENT_SELECT } from '@/lib/experiments-server';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!anthropicApiKey()) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });
  const { id } = (await request.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const sb = getSupabase();
  const { data: exp } = await sb.from('experiment').select(EXPERIMENT_SELECT).eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!exp) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
  try {
    const brief = await writeBrief(sb, exp);
    const patch: Record<string, unknown> = { brief, updated_at: new Date().toISOString() };
    if (exp.status === 'draft') patch.status = 'planned';
    const { data } = await sb.from('experiment').update(patch).eq('id', id).select(EXPERIMENT_SELECT).single();
    return NextResponse.json({ experiment: data, brief });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Brief failed' }, { status: 500 });
  }
}
