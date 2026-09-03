// POST /api/experiments/close { id, verdict? } — manual close. Writes the result and the learning like the auto-close does.
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { closeExperiment, type Evaluation } from '@/lib/experiments';
import { loadExperiments, EXPERIMENT_SELECT } from '@/lib/experiments-server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as { id?: string; verdict?: 'validated' | 'refuted' | 'inconclusive' };
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const sb = getSupabase();
  const { data: exp } = await sb.from('experiment').select('id,brand_id,status').eq('id', body.id).eq('user_id', user.id).maybeSingle();
  if (!exp) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
  if (exp.status === 'closed') return NextResponse.json({ error: 'Already closed' }, { status: 409 });

  const { experiments } = await loadExperiments(sb, user.id, exp.brand_id, { autoClose: false });
  const full = experiments.find((e) => e.id === exp.id)!;
  const ev: Evaluation = full.evaluation ?? {
    decidable: false, reason: 'no_live_variants', verdict: null, spend: 0, progress: 0, days_live: 0, best: null, control: null, variants: [],
    gates: { roas: null, hook: null, hold: null, cpa: null, control: null },
  };
  const verdict = body.verdict ?? ev.verdict ?? 'inconclusive';
  const hookVariant = full.variants.find((v) => v.hook_id || v.hook);
  const { learningId } = await closeExperiment(sb, full, { ...ev, verdict, decidable: true }, {
    reason: 'manual', hookId: hookVariant?.hook_id ?? null, hookTitle: hookVariant?.hook ?? null,
    dimensionValue: ev.best ? full.variants.find((v) => v.id === ev.best?.variant_id)?.format ?? null : null,
  });
  const { data } = await sb.from('experiment').select(EXPERIMENT_SELECT).eq('id', exp.id).single();
  return NextResponse.json({ experiment: data, learningId });
}
