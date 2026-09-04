// POST /api/experiments/hypothesis { id } — drafts the guided hypothesis
// template of an experiment. The draft is saved to experiment.hypothesis_doc;
// the strategist edits it from there (a PATCH on the same field).
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { anthropicApiKey } from '@/lib/ai';
import { draftHypothesis } from '@/lib/agents/hypothesis-writer';
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
    const doc = await draftHypothesis(sb, exp);
    const { data, error } = await sb.from('experiment')
      .update({ hypothesis_doc: doc, hypothesis: exp.hypothesis || doc.statement, updated_at: new Date().toISOString() })
      .eq('id', id).select(EXPERIMENT_SELECT).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ experiment: data, hypothesis_doc: doc });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Draft failed' }, { status: 500 });
  }
}
