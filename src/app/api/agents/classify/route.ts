// =============================================================================
// POST /api/agents/classify — runs the Taxonomy Classifier on creatives that
// have an analysis but no dimensions yet (or on the ids given).
//   { brandId, limit?: number, creativeIds?: string[], force?: boolean }
// Batches are small on purpose (Vercel function time); call repeatedly.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { agentCaller } from '@/lib/agents/auth';
import { anthropicApiKey } from '@/lib/ai';
import { classifyCreative, loadTaxonomy, type CreativeForClassification } from '@/lib/agents/taxonomy-classifier';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const caller = await agentCaller(request);
  if (!caller) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!anthropicApiKey()) return NextResponse.json({ error: 'Anthropic API key is not configured' }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as { brandId?: string; limit?: number; creativeIds?: string[]; force?: boolean };
  if (!body.brandId) return NextResponse.json({ error: 'Missing brandId' }, { status: 400 });
  const limit = Math.min(Math.max(body.limit ?? 6, 1), 12);

  const sb = getSupabase();
  let bq = sb.from('brands').select('id,user_id,name,product').eq('id', body.brandId);
  if (caller.userId) bq = bq.eq('user_id', caller.userId);
  const { data: brand } = await bq.maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  // Candidates: creatives with analysis, without dimension rows (unless force)
  let cq = sb.from('creatives')
    .select('id,brand_id,user_id,name,ad_name,meta_ad_id,type,duration,transcript,analysis')
    .eq('brand_id', brand.id).not('analysis', 'is', null).order('created_at', { ascending: false }).limit(200);
  if (body.creativeIds?.length) cq = cq.in('id', body.creativeIds);
  const { data: creatives } = await cq;
  const { data: done } = await sb.from('ad_dimension').select('creative_id').eq('brand_id', brand.id);
  const doneSet = new Set((done ?? []).map((d) => d.creative_id as string));
  const todo = ((creatives ?? []) as CreativeForClassification[]).filter((c) => body.force || !doneSet.has(c.id)).slice(0, limit);

  const taxonomy = await loadTaxonomy(sb, brand.user_id, brand.id);
  const results: unknown[] = [];
  const started = Date.now();
  for (const c of todo) {
    if (Date.now() - started > 240_000) break; // leave headroom for the response
    try {
      const r = await classifyCreative(sb, { ...c, user_id: brand.user_id }, taxonomy, { name: brand.name, product: brand.product });
      results.push({ ok: true, ...r });
    } catch (e) {
      results.push({ ok: false, creativeId: c.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const remaining = ((creatives ?? []) as CreativeForClassification[]).filter((c) => body.force || !doneSet.has(c.id)).length - todo.length;
  return NextResponse.json({ ok: true, processed: results.length, remaining, results });
}
