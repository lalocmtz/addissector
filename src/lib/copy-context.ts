// =============================================================================
// AdDNA — Serializa TODO el análisis de un creativo a texto legible (markdown)
// para copiarlo en un clic y pegarlo como contexto en cualquier IA o brief.
// =============================================================================

type Rec = Record<string, unknown>;

const r = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function list(title: string, items: unknown[], fmt: (x: unknown) => string): string {
  if (!items.length) return '';
  return `\n${title}\n${items.map((x) => `- ${fmt(x)}`).join('\n')}\n`;
}

/** Convierte el análisis completo (video o imagen) a markdown portable. */
export function analysisToClipboardText(analysis: Rec, name?: string): string {
  const out: string[] = [];
  const sa = r(analysis.structural_analysis);
  const ws = r(sa.winning_structure);
  const dash = r(analysis.dashboard);
  const hook = r(dash.hook);
  const pat = r(dash.patterns);
  const psy = r(analysis.psychological_analysis);
  const buyer = r(psy.buyer_psychology);
  const avatar = r(psy.target_avatar);
  const scroll = r(psy.scroll_stop);
  const copy = r(analysis.copy_analysis);
  const vb = r(analysis.visual_breakdown);
  const sig = r(analysis.signals);

  out.push(`# CONTEXTO COMPLETO DEL CREATIVO${name ? ` — ${name}` : ''}`);

  // Veredicto / interpretación simple
  out.push(`\n## VEREDICTO`);
  if (s(analysis.verdict)) out.push(`Por qué funciona: ${s(analysis.verdict)}`);
  if (analysis.overall_score != null)
    out.push(`Score: ${analysis.overall_score}/100 (${s(analysis.score_label)})`);
  for (const [k, label] of [
    ['scroll_stop', 'Detiene el scroll'],
    ['clarity', 'Claridad'],
    ['offer', 'Oferta'],
  ] as const) {
    const sg = r(sig[k]);
    if (s(sg.level)) out.push(`- ${label}: ${s(sg.level)} — ${s(sg.note)}`);
  }
  out.push(list('\n## RECETA GANADORA', arr(analysis.winning_recipe), s));
  out.push(list('## QUÉ MANTENER (no negociable)', arr(analysis.keep), s));
  out.push(list('## QUÉ PROBAR', arr(analysis.test), s));

  // Estructura / contenido (video)
  if (Object.keys(sa).length) {
    out.push(`\n## ESTRUCTURA DEL VIDEO`);
    if (s(sa.video_type)) out.push(`Tipo: ${s(sa.video_type)}`);
    if (s(sa.product)) out.push(`Producto: ${s(sa.product)}`);
    if (s(sa.visual_context)) out.push(`Contexto visual: ${s(sa.visual_context)}`);
    if (s(sa.content_summary)) out.push(`Resumen: ${s(sa.content_summary)}`);
    if (s(ws.hook)) out.push(`Hook: ${s(ws.hook)}`);
    if (s(ws.development)) out.push(`Desarrollo: ${s(ws.development)}`);
    if (s(ws.cta)) out.push(`CTA: ${s(ws.cta)}`);
    if (arr(ws.persuasion_elements).length)
      out.push(`Elementos de persuasión: ${arr(ws.persuasion_elements).map(s).join(', ')}`);
    if (s(ws.tone)) out.push(`Tono: ${s(ws.tone)} · Formato: ${s(ws.format)}`);
  }

  // Dashboard (hook + patrones)
  if (Object.keys(hook).length || Object.keys(pat).length) {
    out.push(`\n## DASHBOARD VISUAL`);
    if (s(hook.type))
      out.push(
        `Hook: ${s(hook.type)} · ${s(hook.duration_seconds)}s · efectividad ${s(hook.effectiveness_score)}/10 — ${s(hook.effectiveness_reasoning)}`
      );
    if (s(hook.scroll_stop_mechanism)) out.push(`Mecanismo scroll-stop: ${s(hook.scroll_stop_mechanism)}`);
    if (s(pat.persuasion_framework)) out.push(`Framework: ${s(pat.persuasion_framework)}`);
    if (arr(pat.power_words).length) out.push(`Power words: ${arr(pat.power_words).map(s).join(', ')}`);
    if (s(pat.emotional_arc)) out.push(`Arco emocional: ${s(pat.emotional_arc)}`);
    if (s(pat.pacing_rhythm)) out.push(`Ritmo: ${s(pat.pacing_rhythm)}`);
    if (arr(pat.ugc_markers).length) out.push(`Marcadores UGC: ${arr(pat.ugc_markers).map(s).join(', ')}`);
  }

  // Imagen estática: visual + copy
  if (Object.keys(vb).length) {
    out.push(`\n## DESGLOSE VISUAL (imagen)`);
    for (const k of ['format', 'layout', 'focal_point', 'color_psychology', 'typography', 'product_presentation', 'imagery_style']) {
      if (s(vb[k])) out.push(`${k}: ${s(vb[k])}`);
    }
    if (arr(vb.color_palette).length) out.push(`Paleta: ${arr(vb.color_palette).map(s).join(', ')}`);
  }
  if (Object.keys(copy).length) {
    out.push(`\n## COPY DE LA IMAGEN`);
    if (s(copy.headline)) out.push(`Headline: ${s(copy.headline)}`);
    if (s(copy.subheadline)) out.push(`Subheadline: ${s(copy.subheadline)}`);
    if (s(copy.cta_text)) out.push(`CTA: ${s(copy.cta_text)}`);
    if (arr(copy.offer_badges).length) out.push(`Badges: ${arr(copy.offer_badges).map(s).join(' · ')}`);
    if (arr(copy.all_text_verbatim).length)
      out.push(`Todo el texto: ${arr(copy.all_text_verbatim).map(s).join(' | ')}`);
    if (s(copy.copy_angle)) out.push(`Ángulo: ${s(copy.copy_angle)} · Framework: ${s(copy.copy_framework)}`);
  }

  // Psicología profunda
  if (Object.keys(psy).length) {
    out.push(`\n## PSICOLOGÍA PROFUNDA`);
    if (s(psy.why_it_converts)) out.push(`Por qué convierte: ${s(psy.why_it_converts)}`);
    if (s(scroll.mechanism))
      out.push(`Scroll-stop: ${s(scroll.mechanism)} (${s(scroll.primary_trigger)}, ${s(scroll.strength_score)}/10) — ${s(scroll.reasoning)}`);
    if (s(buyer.core_desire)) out.push(`Deseo profundo: ${s(buyer.core_desire)}`);
    if (s(buyer.core_pain)) out.push(`Dolor: ${s(buyer.core_pain)}`);
    if (s(buyer.identity_shift)) out.push(`Cambio de identidad: ${s(buyer.identity_shift)}`);
    if (arr(buyer.objections_handled).length)
      out.push(`Objeciones neutralizadas: ${arr(buyer.objections_handled).map(s).join(' | ')}`);
    out.push(
      list('Gatillos de persuasión:', arr(psy.persuasion_triggers), (t) => {
        const x = r(t);
        return `${s(x.trigger)} (${s(x.strength)}/10): ${s(x.how_used)}`;
      })
    );
    out.push(
      list('Sesgos cognitivos:', arr(psy.cognitive_biases), (t) => {
        const x = r(t);
        return `${s(x.bias)}: ${s(x.how_exploited)}`;
      })
    );
    if (s(psy.awareness_level)) out.push(`Nivel de consciencia: ${s(psy.awareness_level)}`);
    if (s(psy.market_sophistication)) out.push(`Sofisticación del mercado: ${s(psy.market_sophistication)}`);
    if (s(avatar.who))
      out.push(`Avatar: ${s(avatar.who)} · Mindset: ${s(avatar.mindset)} · Resuena porque: ${s(avatar.resonance_reason)}`);
  }

  // Guion y variantes (video)
  if (s(analysis.original_script)) {
    out.push(`\n## GUION ORIGINAL (lo que dice el video)\n${s(analysis.original_script)}`);
  }
  const variants = arr(analysis.script_variants);
  if (variants.length) {
    out.push(`\n## VARIANTES DE GUION`);
    for (const v of variants) {
      const x = r(v);
      out.push(`\n### Variante ${s(x.variant_number)} — ${s(x.scenario)}\n${s(x.script)}`);
    }
  }
  // Variantes de replicación (imagen)
  const rep = r(analysis.replication);
  if (s(rep.faithful_recreation_prompt)) {
    out.push(`\n## PROMPT DE RECREACIÓN FIEL\n${s(rep.faithful_recreation_prompt)}`);
    out.push(
      list('Variantes de replicación:', arr(rep.variants), (t) => {
        const x = r(t);
        return `Variante ${s(x.variant_number)} (${s(x.angle)}): ${s(x.prompt)}`;
      })
    );
    if (s(rep.design_notes)) out.push(`Notas de diseño (no negociables): ${s(rep.design_notes)}`);
  }

  // Brief destilado para anuncios estáticos (sin ruido de video)
  const firstSentence = s(analysis.original_script).split(/(?<=[.!?])\s/)[0] || '';
  const staticBits: string[] = [];
  if (s(avatar.who)) staticBits.push(`A quién le hablas: ${s(avatar.who)}`);
  if (s(buyer.core_pain)) staticBits.push(`Dolor a atacar: ${s(buyer.core_pain)}`);
  if (s(buyer.core_desire)) staticBits.push(`Deseo a prometer: ${s(buyer.core_desire)}`);
  if (s(buyer.identity_shift)) staticBits.push(`Transformación a vender: ${s(buyer.identity_shift)}`);
  if (firstSentence) staticBits.push(`Hook probado (adaptable a headline): "${firstSentence}"`);
  if (arr(pat.power_words).length)
    staticBits.push(`Power words para el copy: ${arr(pat.power_words).map(s).join(', ')}`);
  const proof = arr(ws.persuasion_elements).map(s).filter((x) =>
    /prueba|social|antes|después|reseñ|testimon|número|específic/i.test(x)
  );
  if (proof.length) staticBits.push(`Prueba a mostrar visualmente: ${proof.join(', ')}`);
  const objections = arr(buyer.objections_handled).map(s);
  if (objections.length) staticBits.push(`Objeción nº1 a neutralizar en el estático: ${objections[0]}`);
  const offerSig = r(sig.offer);
  if (s(offerSig.note)) staticBits.push(`Oferta/urgencia: ${s(offerSig.note)}`);
  if (s(psy.awareness_level))
    staticBits.push(`Nivel de consciencia del avatar: ${s(psy.awareness_level)} — calibra qué tan directo puede ser el headline`);
  if (staticBits.length) {
    out.push(`\n## BRIEF PARA ANUNCIOS ESTÁTICOS (destilado, sin ruido de video)`);
    out.push(staticBits.map((b) => `- ${b}`).join('\n'));
  }

  return out.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
