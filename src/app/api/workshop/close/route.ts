// =============================================================================
// /api/workshop/close
//
// Closing a batch is the only event in this system that can create a learning.
// Everything an agent writes is an observation; only what a batch proved is
// evidence. That wall is the whole point — the old model had 149 "learnings",
// every one of them written by a model about a single ad, none of them from a
// test, and they were being fed back as if they were knowledge.
//
// Closing does four things and nothing else:
//   1. stamps a verdict on every piece, computed from ad_daily
//   2. writes ONE learning, with the pieces and the numbers as its evidence
//   3. marks the winning hook verified — the only way that flag is ever set
//   4. closes the batch
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { loadWorkshop, BATCH_SELECT } from '@/lib/batch-server';
import { VERDICT_ACTION, type Verdict } from '@/lib/batch';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ratio = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}x`);
const money = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const id = body.id as string | undefined;
  const brandId = body.brandId as string | undefined;
  if (!id || !brandId) return NextResponse.json({ error: 'Missing id or brandId' }, { status: 400 });

  const sb = getSupabase();
  const workshop = await loadWorkshop(sb, user.id, brandId, Number(body.window ?? 30));
  const batch = [...workshop.live, ...workshop.bench, ...workshop.closed].find((b) => b.id === id);
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
  if (batch.status === 'closed') return NextResponse.json({ error: 'Already closed' }, { status: 409 });

  const judged = batch.pieces.filter((p) => p.verdict_now !== null);
  const force = body.force === true;
  // A batch nobody could read yet has nothing to teach. Saying so is the honest
  // answer; inventing a verdict is how the old system filled itself with noise.
  if (!judged.length && !force) {
    return NextResponse.json({
      error: 'no_readable_pieces',
      message: 'No piece has carried enough spend to be judged yet.',
      progress: batch.progress,
    }, { status: 409 });
  }

  const now = new Date().toISOString();

  // 1. Verdicts
  for (const p of batch.pieces) {
    const verdict = p.verdict_now ?? (force ? 'loser' : null);
    if (!verdict) continue;
    await sb.from('experiment_variant').update({
      verdict, verdict_at: now,
      archived_reason: verdict === 'loser' ? (p.spend > 0 ? 'fatigue' : 'never_delivered') : null,
      status: 'evaluated', updated_at: now,
    }).eq('id', p.id).eq('user_id', user.id);
  }

  // 2. The learning
  const ranked = [...judged].sort((a, b) => {
    const rank: Record<Verdict, number> = { breakthrough: 0, kpi_winner: 1, spend_winner: 2, loser: 3 };
    return rank[a.verdict_now as Verdict] - rank[b.verdict_now as Verdict] || b.spend - a.spend;
  });
  const best = ranked[0] ?? null;
  const worked = best && best.verdict_now !== 'loser';

  const subject = `${batch.variable.replace(/_/g, ' ')} on ${batch.angle_code ?? batch.angle_name ?? 'the angle'}`;
  const text = worked
    ? `${batch.code} · ${batch.name}: changing ${subject} works. "${(best.hook ?? '').slice(0, 120)}" reached ${ratio(best.roas)} ROAS on ${money(best.spend)} of spend — ${VERDICT_ACTION[best.verdict_now as Verdict]}.`
    : `${batch.code} · ${batch.name}: changing ${subject} did not work. No piece cleared breakeven over ${money(batch.spend)} of spend.`;

  const evidence = batch.pieces
    .map((p) => `${p.ad_name}: spend ${money(p.spend)}, ROAS ${ratio(p.roas)}, ${p.purchases ?? 0} purchases, verdict ${p.verdict_now ?? 'unreadable'}`)
    .join(' · ');

  const { data: learning, error: lerr } = await sb.from('learnings').insert({
    user_id: user.id, brand_id: brandId,
    kind: 'learning',
    stale_metrics: false,
    text: typeof body.text === 'string' && body.text.trim() ? body.text.trim() : text,
    evidence,
    status: 'candidate',
    source: 'experiment',
    active: true,
    experiment_id: batch.id,
    angle_id: batch.angle_id,
    concept_id: null,
    hook_id: best?.hook_id ?? null,
    dimension: batch.variable,
    dimension_value: best?.hook ?? null,
    ad_ids: batch.pieces.map((p) => p.meta_ad_id).filter((x): x is string => Boolean(x)),
  }).select('id').single();
  if (lerr) return NextResponse.json({ error: lerr.message }, { status: 500 });

  // 3. The hook bank only learns from this
  if (worked && best?.hook_id) {
    await sb.from('hook').update({ verified: true, literal: true, status: 'validated', updated_at: now })
      .eq('id', best.hook_id).eq('user_id', user.id);
  }

  // 4. The batch
  const { data, error } = await sb.from('experiment').update({
    status: 'closed', closed_at: now, evaluated_at: now,
    close_reason: worked ? 'criteria_met' : 'criteria_failed',
    closed_note: typeof body.note === 'string' ? body.note.trim() || null : null,
    learning_id: learning.id,
    result: {
      verdict: worked ? 'validated' : 'refuted',
      pieces: batch.pieces.map((p) => ({ id: p.id, ad_name: p.ad_name, verdict: p.verdict_now, spend: p.spend, roas: p.roas })),
    },
    updated_at: now,
  }).eq('id', batch.id).eq('user_id', user.id).select(BATCH_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ batch: data, learning_id: learning.id, verdicts: batch.pieces.length });
}
