// =============================================================================
// POST /api/agents/link-learnings — attaches unlinked learnings to the entity
// they explain. { brandId, limit?: number }
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { agentCaller } from '@/lib/agents/auth';
import { anthropicApiKey } from '@/lib/ai';
import { loadTaxonomy } from '@/lib/agents/taxonomy-classifier';
import { linkLearnings, type LearningRow } from '@/lib/agents/learning-linker';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const caller = await agentCaller(request);
  if (!caller) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!anthropicApiKey()) return NextResponse.json({ error: 'Anthropic API key is not configured' }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as { brandId?: string; limit?: number };
  if (!body.brandId) return NextResponse.json({ error: 'Missing brandId' }, { status: 400 });
  const limit = Math.min(Math.max(body.limit ?? 25, 1), 40);

  const sb = getSupabase();
  let bq = sb.from('brands').select('id,user_id').eq('id', body.brandId);
  if (caller.userId) bq = bq.eq('user_id', caller.userId);
  const { data: brand } = await bq.maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  const { data: rows } = await sb.from('learnings')
    .select('id,text,evidence,source_ad,ad_ids')
    .eq('brand_id', brand.id).is('linked_at', null).order('created_at').limit(limit);
  const taxonomy = await loadTaxonomy(sb, brand.user_id, brand.id);
  const r = await linkLearnings(sb, (rows ?? []) as LearningRow[], taxonomy);
  const { count } = await sb.from('learnings').select('id', { count: 'exact', head: true }).eq('brand_id', brand.id).is('linked_at', null);
  return NextResponse.json({ ok: true, ...r, remaining: count ?? 0 });
}
