// =============================================================================
// AdDNA — El cerebro se alimenta solo.
//
// Toma UN creativo ya analizado (que por definición es un anuncio ganador),
// saca los candidatos con el extractor determinista, los cruza con los bancos
// que ya existen y escribe en el Cerebro lo que de verdad aporta algo nuevo.
//
// El LLM entra UNA sola vez y sólo para dos cosas:
//   1. Reconciliar: ¿este ángulo ya lo tengo? -> merge en vez de duplicar.
//   2. Redactar en español de México.
//
// Nada de esto puede tronar el flujo del análisis: ante cualquier error se
// devuelve un resumen en ceros con el mensaje, y el usuario ni se entera.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { anthropicApiKey, MODEL } from '@/lib/ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { aggregateAds, type DailyRow } from './meta';
import { extractCandidates, type IngestCandidates, type IngestMetrics } from './brain-ingest';
import type { AnalysisResult } from './analysis-schema';


// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface IngestCounts {
  personas: number;
  angles: number;
  hooks: number;
  learnings: number;
}

export interface IngestItem {
  kind: 'persona' | 'angulo' | 'hook' | 'aprendizaje';
  action: 'create' | 'merge';
  label: string;
}

export interface IngestSummary {
  created: IngestCounts;
  merged: IngestCounts;
  items: IngestItem[];
  error?: string;
}

const zero = (): IngestCounts => ({ personas: 0, angles: 0, hooks: 0, learnings: 0 });
const emptySummary = (error?: string): IngestSummary => ({
  created: zero(),
  merged: zero(),
  items: [],
  ...(error ? { error } : {}),
});

// ---------------------------------------------------------------------------
// Respuesta esperada del LLM
// ---------------------------------------------------------------------------

interface PersonaDecision {
  action?: string; id?: string | null; name?: string; description?: string;
  pains?: string; desires?: string; objections?: string; awareness_stage?: string;
}
interface AngleDecision {
  action?: string; id?: string | null; code?: string; name?: string; pain?: string;
  mechanism?: string; objection?: string; awareness_stage?: string; funnel_stage?: string;
  learnings_append?: string;
}
interface HookDecision { action?: string; title?: string; body?: string; source?: string }
interface LearningDecision { action?: string; text?: string; evidence?: string }

interface BrainDecision {
  persona?: PersonaDecision;
  angle?: AngleDecision;
  hooks?: HookDecision[];
  learnings?: LearningDecision[];
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM = `Eres el bibliotecario del cerebro de una marca de ecommerce. Cada anuncio que llega YA es un ganador: tu trabajo es decidir qué de lo que trae merece entrar al banco y qué ya está ahí con otro nombre.

Recibes CANDIDATOS extraídos del análisis de un anuncio y los BANCOS que la marca ya tiene. Devuelves decisiones.

REGLAS DURAS:
- ÁNGULOS: si ya existe un ángulo que cubre el MISMO dolor y el MISMO mecanismo, devuelve "merge" con su id y escribe en "learnings_append" UNA línea nueva con lo que este anuncio confirma o agrega. NUNCA dupliques ángulos: el banco tiene que converger, no explotar. Sólo devuelve "create" si el dolor o el mecanismo son genuinamente distintos a todo lo que hay.
- CODE del ángulo: MAYÚSCULAS, UNA sola palabra, sin acentos ni espacios, máximo 12 caracteres. Si es "merge", conserva el code existente tal cual.
- PERSONAS: si ya hay una persona que es la misma gente (aunque esté escrita distinto), devuelve "merge" con su id. Sólo "create" si es un avatar realmente nuevo.
- HOOKS: crea uno sólo si es distinto en ESTRUCTURA de los que ya hay, no sólo en palabras. Mismo mecanismo con otras palabras = "skip".
- APRENDIZAJES: crea uno sólo si es específico y accionable. PROHIBIDO "buen hook", "buena edición", "buen ritmo" y cualquier obviedad. Cada aprendizaje debe decir QUÉ mecanismo funcionó con QUÉ persona. Si ya existe uno que dice lo mismo, "skip".
- Todo en español de México, directo, sin jerga de marketing gringo, sin adjetivos de relleno.
- No inventes datos que no estén en los candidatos.
- Ante la duda, "skip". Es mejor un banco chico y limpio que uno grande y repetido.

Devuelve SOLO este JSON, sin texto alrededor, sin markdown, sin explicaciones:
{
  "persona": {"action":"create|merge|skip","id":null,"name":"","description":"","pains":"","desires":"","objections":"","awareness_stage":""},
  "angle": {"action":"create|merge|skip","id":null,"code":"","name":"","pain":"","mechanism":"","objection":"","awareness_stage":"","funnel_stage":"","learnings_append":""},
  "hooks": [{"action":"create|skip","title":"","body":"","source":""}],
  "learnings": [{"action":"create|skip","text":"","evidence":""}]
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s.toLowerCase().replace(/\.(mp4|mov|webm|m4v|png|jpg|jpeg)$/i, '').replace(/\s+/g, ' ').trim();

const txt = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Código de ángulo saneado: MAYÚSCULAS, una palabra, sin acentos, ≤12. */
function safeCode(raw: string, fallback: string): string {
  const base = (raw || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return base || 'ANGULO';
}

/** Extrae el primer objeto JSON de la respuesta (tolera cercos de markdown). */
function parseJson(raw: string): BrainDecision | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as BrainDecision;
  } catch {
    return null;
  }
}

/** Añade una línea a un campo de texto sin repetirla ni pisar lo que había. */
function appendLine(current: string | null, line: string): string | null {
  const add = line.trim();
  if (!add) return current;
  const prev = (current ?? '').trim();
  if (!prev) return add;
  if (prev.includes(add)) return prev;
  return `${prev}\n${add}`;
}

// ---------------------------------------------------------------------------
// Ingesta de UN creativo
// ---------------------------------------------------------------------------

export interface IngestOptions {
  userId: string;
  creativeId: string;
  brandId?: string | null;
  /** Cliente ya creado (el backfill reusa el mismo). */
  sb?: SupabaseClient;
  apiKey?: string;
}

export async function ingestCreative(opts: IngestOptions): Promise<IngestSummary> {
  const sb = opts.sb ?? getSupabase();
  const apiKey = opts.apiKey ?? anthropicApiKey();

  // 1 · El creativo -----------------------------------------------------------
  const { data: creative } = await sb
    .from('creatives')
    .select('id,brand_id,name,ad_name,analysis,transcript')
    .eq('id', opts.creativeId)
    .eq('user_id', opts.userId)
    .maybeSingle();

  if (!creative) return emptySummary('No encontré ese creativo.');
  if (!creative.analysis) return emptySummary('Ese creativo todavía no tiene análisis.');

  const brandId: string | null = (opts.brandId as string) || creative.brand_id || null;
  if (!brandId) return emptySummary('Ese creativo no está asignado a ninguna marca.');

  const adName: string = txt(creative.ad_name) || txt(creative.name);
  if (!adName) {
    // Sin nombre no hay evidencia posible: se marca como leído para que el
    // backfill no se quede atorado en él para siempre.
    await markIngested(sb, opts.creativeId);
    return emptySummary('El creativo no tiene nombre: sin él no hay evidencia.');
  }

  // 2 · Sus números reales en Meta (la evidencia) -----------------------------
  const metrics: IngestMetrics = {};
  let dossier = '';
  try {
    const { data: metaAds } = await sb
      .from('meta_ads')
      .select('name,fusion,dossier_meta,dossier_video')
      .eq('brand_id', brandId);
    const hit = (metaAds ?? []).find((m) => norm(String(m.name)) === norm(adName));
    if (hit) {
      dossier = [
        txt(hit.fusion).slice(0, 3000),
        txt(hit.dossier_meta).slice(0, 1500),
        txt(hit.dossier_video).slice(0, 1500),
      ]
        .filter(Boolean)
        .join('\n\n');
    }

    const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const { data: daily } = await sb
      .from('meta_daily')
      .select('ad_name,date,status,spend,revenue,roas,cpa,cpc,cpm,v3s,hook_rate,v25,v50,v75,freq,cost_atc,link_clicks,cvr,result_rate')
      .eq('brand_id', brandId)
      .gte('date', from)
      .limit(20000);
    const agg = aggregateAds((daily ?? []) as DailyRow[]);
    const ad = agg.find((a) => norm(a.ad_name) === norm(adName));
    if (ad) {
      metrics.spend = ad.spend;
      metrics.roas = ad.roas;
      metrics.hookRate = ad.hook_rate;
    }
  } catch {
    /* sin métricas: la evidencia se queda con el nombre del anuncio */
  }

  // 3 · Candidatos deterministas ---------------------------------------------
  const candidates = extractCandidates(creative.analysis as AnalysisResult, adName, metrics);
  const nothing =
    !candidates.persona && !candidates.angle && !candidates.hooks.length && !candidates.learnings.length;
  if (nothing) {
    await markIngested(sb, opts.creativeId);
    return emptySummary();
  }

  if (!apiKey) return emptySummary('Falta la API key de Anthropic.');

  // 4 · Los bancos que ya existen, en forma compacta --------------------------
  const [personasRes, anglesRes, hooksRes, learningsRes] = await Promise.all([
    sb.from('personas').select('id,name').eq('brand_id', brandId).eq('user_id', opts.userId).limit(200),
    sb.from('angles').select('id,code,name,pain,mechanism').eq('brand_id', brandId).eq('user_id', opts.userId).limit(200),
    sb.from('research_notes').select('id,title').eq('brand_id', brandId).eq('user_id', opts.userId).eq('kind', 'hook').limit(200),
    sb.from('learnings').select('id,text').eq('brand_id', brandId).eq('user_id', opts.userId).limit(200),
  ]);

  const banks = {
    personas: personasRes.data ?? [],
    angles: anglesRes.data ?? [],
    hooks: hooksRes.data ?? [],
    learnings: learningsRes.data ?? [],
  };

  // 5 · UNA llamada al LLM ----------------------------------------------------
  const userMsg = [
    `ANUNCIO GANADOR: ${adName}`,
    `\nCANDIDATOS EXTRAÍDOS DEL ANÁLISIS (JSON):\n${JSON.stringify(candidates, null, 2)}`,
    `\nBANCOS QUE LA MARCA YA TIENE (JSON):\n${JSON.stringify(banks, null, 2)}`,
    dossier ? `\nCONTEXTO EXTRA DEL ANUNCIO:\n${dossier}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  let decision: BrainDecision | null = null;
  try {
    const client = new Anthropic({ apiKey });
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMsg }];
    for (let attempt = 0; attempt < 2 && !decision; attempt++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 3000,
        system: SYSTEM,
        messages,
      });
      const raw = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      decision = parseJson(raw);
      if (!decision) {
        // Un solo reintento, pidiendo únicamente el JSON.
        messages.push({ role: 'assistant', content: raw.slice(0, 2000) || '…' });
        messages.push({
          role: 'user',
          content: 'Eso no era JSON válido. Responde SOLO el objeto JSON pedido, sin texto ni markdown alrededor.',
        });
      }
    }
  } catch (err) {
    return emptySummary(err instanceof Error ? err.message : 'Error hablando con la IA');
  }

  if (!decision) return emptySummary('La IA no devolvió un JSON válido.');

  // 6 · Escribir en el Cerebro ------------------------------------------------
  const created = zero();
  const merged = zero();
  const items: IngestItem[] = [];
  const now = new Date().toISOString();

  // --- Persona ---
  let personaId: string | null = null;
  const pd = decision.persona;
  if (pd && candidates.persona) {
    const ev = candidates.persona.evidence;
    if (pd.action === 'create' && txt(pd.name)) {
      const { data } = await sb
        .from('personas')
        .insert({
          user_id: opts.userId,
          brand_id: brandId,
          name: txt(pd.name),
          description: txt(pd.description) || null,
          pains: txt(pd.pains) || null,
          desires: txt(pd.desires) || null,
          objections: txt(pd.objections) || null,
          awareness_stage: txt(pd.awareness_stage) || null,
          evidence: ev,
          status: 'activa',
          source: 'ia',
        })
        .select('id')
        .maybeSingle();
      personaId = data?.id ?? null;
      created.personas++;
      items.push({ kind: 'persona', action: 'create', label: txt(pd.name) });
    } else if (pd.action === 'merge' && txt(pd.id ?? '')) {
      const id = txt(pd.id ?? '');
      const { data: existing } = await sb
        .from('personas')
        .select('id,description,pains,desires,objections,awareness_stage,evidence,name')
        .eq('id', id)
        .eq('user_id', opts.userId)
        .maybeSingle();
      if (existing) {
        personaId = existing.id;
        // Sólo rellena huecos: lo que Eduardo escribió no se pisa nunca.
        const patch: Record<string, unknown> = {
          evidence: appendLine(existing.evidence, ev),
          updated_at: now,
        };
        if (!txt(existing.description) && txt(pd.description)) patch.description = txt(pd.description);
        if (!txt(existing.pains) && txt(pd.pains)) patch.pains = txt(pd.pains);
        if (!txt(existing.desires) && txt(pd.desires)) patch.desires = txt(pd.desires);
        if (!txt(existing.objections) && txt(pd.objections)) patch.objections = txt(pd.objections);
        if (!txt(existing.awareness_stage) && txt(pd.awareness_stage)) {
          patch.awareness_stage = txt(pd.awareness_stage);
        }
        await sb.from('personas').update(patch).eq('id', id).eq('user_id', opts.userId);
        merged.personas++;
        items.push({ kind: 'persona', action: 'merge', label: txt(existing.name) || txt(pd.name) });
      }
    }
  }

  // --- Ángulo ---
  const ad = decision.angle;
  if (ad && candidates.angle) {
    const ev = candidates.angle.evidence;
    if (ad.action === 'create' && txt(ad.name)) {
      const used = new Set(banks.angles.map((a) => String(a.code ?? '').toUpperCase()));
      let code = safeCode(txt(ad.code), txt(ad.name).split(' ')[0] ?? 'ANGULO');
      if (used.has(code)) code = `${code.slice(0, 10)}${Math.floor(Math.random() * 90 + 10)}`;
      const { error } = await sb.from('angles').insert({
        user_id: opts.userId,
        brand_id: brandId,
        code,
        name: txt(ad.name),
        persona_id: personaId,
        pain: txt(ad.pain) || null,
        mechanism: txt(ad.mechanism) || null,
        objection: txt(ad.objection) || null,
        awareness_stage: txt(ad.awareness_stage) || null,
        funnel_stage: txt(ad.funnel_stage) || 'tofu',
        status: 'ganador',
        evidence: ev,
        learnings: txt(ad.learnings_append) || null,
        source: 'ia',
      });
      if (!error) {
        created.angles++;
        items.push({ kind: 'angulo', action: 'create', label: txt(ad.name) });
      }
    } else if (ad.action === 'merge' && txt(ad.id ?? '')) {
      const id = txt(ad.id ?? '');
      const { data: existing } = await sb
        .from('angles')
        .select('id,name,pain,mechanism,objection,evidence,learnings')
        .eq('id', id)
        .eq('user_id', opts.userId)
        .maybeSingle();
      if (existing) {
        // Los aprendizajes se CONCATENAN: el ángulo va acumulando lo que
        // cada ganador confirmó. Nunca se sobreescribe.
        const patch: Record<string, unknown> = {
          learnings: appendLine(existing.learnings, txt(ad.learnings_append)),
          evidence: appendLine(existing.evidence, ev),
          updated_at: now,
        };
        if (!txt(existing.pain) && txt(ad.pain)) patch.pain = txt(ad.pain);
        if (!txt(existing.mechanism) && txt(ad.mechanism)) patch.mechanism = txt(ad.mechanism);
        if (!txt(existing.objection) && txt(ad.objection)) patch.objection = txt(ad.objection);
        await sb.from('angles').update(patch).eq('id', id).eq('user_id', opts.userId);
        merged.angles++;
        items.push({ kind: 'angulo', action: 'merge', label: txt(existing.name) || txt(ad.name) });
      }
    }
  }

  // --- Hooks ---
  const hookRows = (decision.hooks ?? [])
    .filter((h) => h.action === 'create' && txt(h.title))
    .slice(0, 4)
    .map((h) => ({
      user_id: opts.userId,
      brand_id: brandId,
      kind: 'hook',
      title: txt(h.title).slice(0, 400),
      body: txt(h.body) || null,
      source: 'ia',
      evidence: candidates.hooks[0]?.evidence ?? adName,
      status: 'funciona',
    }));
  if (hookRows.length) {
    const { error } = await sb.from('research_notes').insert(hookRows);
    if (!error) {
      created.hooks += hookRows.length;
      for (const h of hookRows) items.push({ kind: 'hook', action: 'create', label: h.title });
    }
  }

  // --- Aprendizajes ---
  const learningRows = (decision.learnings ?? [])
    .filter((l) => l.action === 'create' && txt(l.text))
    .slice(0, 6)
    .map((l) => ({
      user_id: opts.userId,
      brand_id: brandId,
      text: txt(l.text),
      evidence: txt(l.evidence) || candidates.learnings[0]?.evidence || adName,
      source_ad: adName,
      source: 'ia',
      source_creative: opts.creativeId,
      active: true,
    }));
  if (learningRows.length) {
    const { error } = await sb.from('learnings').insert(learningRows);
    if (!error) {
      created.learnings += learningRows.length;
      for (const l of learningRows) items.push({ kind: 'aprendizaje', action: 'create', label: l.text });
    }
  }

  // 7 · Marcar como leído -----------------------------------------------------
  await markIngested(sb, opts.creativeId);

  return { created, merged, items };
}

async function markIngested(sb: SupabaseClient, creativeId: string) {
  await sb.from('creatives').update({ ingested_at: new Date().toISOString() }).eq('id', creativeId);
}

/** Cuántos análisis de la marca todavía no ha leído el cerebro. */
export async function pendingCount(
  sb: SupabaseClient,
  userId: string,
  brandId: string
): Promise<number> {
  const { count } = await sb
    .from('creatives')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('brand_id', brandId)
    .not('analysis', 'is', null)
    .is('ingested_at', null);
  return count ?? 0;
}

export type { IngestCandidates };
