// =============================================================================
// /api/workshop/piece
//   POST    add a piece to a batch. The ad name is MINTED here — the client
//           never sends one and the strategist never types one.
//   PATCH   edit a piece: hook, format, owner, status, verdict, archive reason.
//           Editing any field the name is built from re-mints the name, unless
//           the piece is already matched to a live Meta ad, in which case the
//           name is frozen: renaming it there would orphan the reporting.
//   DELETE  remove a piece that was never launched.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { PIECE_SELECT } from '@/lib/batch-server';
import { mintAdName, PIECE_FORMATS, AWARENESS_STAGES, VERDICTS, ARCHIVE_REASONS } from '@/lib/batch';

export const runtime = 'nodejs';

const VARIANT_LABELS = 'ABCDEFGH';

async function batchOf(sb: ReturnType<typeof getSupabase>, id: string, userId: string) {
  const { data } = await sb.from('experiment')
    .select('id,brand_id,number,awareness,angle_id,angles(code)')
    .eq('id', id).eq('user_id', userId).maybeSingle();
  return data as unknown as { id: string; brand_id: string; number: number; awareness: string | null; angle_id: string | null; angles: { code: string | null } | null } | null;
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const batchId = body.batchId as string | undefined;
  if (!batchId) return NextResponse.json({ error: 'Missing batchId' }, { status: 400 });

  // The hook is the line that goes on screen, word for word. A description of a
  // hook is not shootable, so the field is required and it is the one thing the
  // name is built from.
  const hook = typeof body.hook === 'string' ? body.hook.trim() : '';
  if (!hook) return NextResponse.json({ error: 'A piece needs its literal hook' }, { status: 400 });

  const format = String(body.format ?? 'static');
  if (!(PIECE_FORMATS as readonly string[]).includes(format)) {
    return NextResponse.json({ error: 'Unknown format' }, { status: 400 });
  }

  const sb = getSupabase();
  const batch = await batchOf(sb, batchId, user.id);
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });

  const awarenessIn = String(body.awareness ?? batch.awareness ?? '');
  const awareness = (AWARENESS_STAGES as readonly string[]).includes(awarenessIn) ? awarenessIn : batch.awareness;

  const { data: siblings } = await sb.from('experiment_variant').select('id,variant').eq('experiment_id', batchId);
  const n = (siblings ?? []).length;
  const variant = VARIANT_LABELS[n] ?? String(n + 1);

  const ad_name = mintAdName({
    angleCode: batch.angles?.code ?? null,
    batchNumber: batch.number,
    awareness,
    format,
    hook,
    version: n + 1,
  });

  const { data, error } = await sb.from('experiment_variant').insert({
    user_id: user.id, brand_id: batch.brand_id, experiment_id: batchId,
    ad_name, variant, hook, format, awareness,
    hook_id: (body.hook_id as string) ?? null,
    script: typeof body.script === 'string' ? body.script.trim() || null : null,
    visual_notes: typeof body.visual_notes === 'string' ? body.visual_notes.trim() || null : null,
    owner_id: (body.owner_id as string) ?? null,
    status: 'planned',
  }).select(PIECE_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ piece: data });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const id = body.id as string | undefined;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const sb = getSupabase();
  const { data: current } = await sb.from('experiment_variant')
    .select('id,experiment_id,ad_name,hook,format,awareness,meta_ad_id')
    .eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!current) return NextResponse.json({ error: 'Piece not found' }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['hook', 'script', 'visual_notes', 'owner_id', 'hook_id', 'status'] as const) {
    if (body[k] === undefined) continue;
    const v = body[k];
    patch[k] = typeof v === 'string' ? (v.trim() || null) : v;
  }
  if (body.format !== undefined) {
    if (!(PIECE_FORMATS as readonly string[]).includes(String(body.format))) {
      return NextResponse.json({ error: 'Unknown format' }, { status: 400 });
    }
    patch.format = body.format;
  }
  if (body.awareness !== undefined) {
    if (!(AWARENESS_STAGES as readonly string[]).includes(String(body.awareness))) {
      return NextResponse.json({ error: 'Unknown awareness stage' }, { status: 400 });
    }
    patch.awareness = body.awareness;
  }
  if (body.verdict !== undefined) {
    if (body.verdict !== null && !(VERDICTS as readonly string[]).includes(String(body.verdict))) {
      return NextResponse.json({ error: 'Unknown verdict' }, { status: 400 });
    }
    patch.verdict = body.verdict;
    patch.verdict_at = body.verdict ? new Date().toISOString() : null;
  }
  if (body.archived_reason !== undefined) {
    if (body.archived_reason !== null && !(ARCHIVE_REASONS as readonly string[]).includes(String(body.archived_reason))) {
      return NextResponse.json({ error: 'Unknown archive reason' }, { status: 400 });
    }
    patch.archived_reason = body.archived_reason;
  }

  // Re-mint only while the piece is still ours to rename. Once Meta has it, the
  // name is the join key for every report that mentions this ad.
  const touchesName = ['hook', 'format', 'awareness'].some((k) => body[k] !== undefined);
  if (touchesName && !current.meta_ad_id && current.experiment_id) {
    const batch = await batchOf(sb, current.experiment_id, user.id);
    if (batch) {
      const version = Number(/v(\d+)$/.exec(current.ad_name)?.[1] ?? 1);
      patch.ad_name = mintAdName({
        angleCode: batch.angles?.code ?? null,
        batchNumber: batch.number,
        awareness: (patch.awareness as string) ?? current.awareness,
        format: (patch.format as string) ?? current.format,
        hook: (patch.hook as string) ?? current.hook,
        version,
      });
    }
  }

  const { data, error } = await sb.from('experiment_variant').update(patch)
    .eq('id', id).eq('user_id', user.id).select(PIECE_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ piece: data });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const sb = getSupabase();
  const { data: piece } = await sb.from('experiment_variant').select('id,meta_ad_id')
    .eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!piece) return NextResponse.json({ error: 'Piece not found' }, { status: 404 });
  // A piece that already ran is history, not a draft. It gets archived, never deleted.
  if (piece.meta_ad_id) return NextResponse.json({ error: 'This piece already ran — archive it instead' }, { status: 409 });

  const { error } = await sb.from('experiment_variant').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
