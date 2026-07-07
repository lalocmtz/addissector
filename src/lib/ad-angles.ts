// =============================================================================
// AdDNA — Biblioteca de ángulos, etapas de conciencia y nomenclatura de anuncios.
// Sirve para (a) sugerir ángulos al maquetar, (b) generar nombres consistentes
// que empaten con el export de Meta, y (c) auto-armar el ecosistema de un batch.
// =============================================================================

export type Stage = 'tofu' | 'mofu' | 'bofu';

export const STAGES: { v: Stage; label: string; short: string }[] = [
  { v: 'tofu', label: 'TOFU · frío / descubrimiento', short: 'TOF' },
  { v: 'mofu', label: 'MOFU · consideración', short: 'MOF' },
  { v: 'bofu', label: 'BOFU · cierre / decisión', short: 'BOF' },
];

export const FORMATS = ['video', 'imagen'] as const;
export type AdFormat = (typeof FORMATS)[number];

// Etapas de conciencia (Eugene Schwartz), en español llano.
export const AWARENESS: { v: string; label: string }[] = [
  { v: 'inconsciente', label: 'Inconsciente — no sabe que tiene el problema' },
  { v: 'problema', label: 'Consciente del problema — lo siente, no sabe la solución' },
  { v: 'solucion', label: 'Consciente de la solución — busca opciones' },
  { v: 'producto', label: 'Consciente del producto — te compara' },
  { v: 'total', label: 'Totalmente consciente — solo falta la oferta' },
];

// Ángulos creativos con su código de nomenclatura y una pista de uso.
export const ANGLES: { code: string; label: string; hint: string; stage: Stage }[] = [
  { code: 'DESESP', label: 'Desesperación', hint: 'Agita el dolor al máximo antes de la solución.', stage: 'tofu' },
  { code: 'PROBSOL', label: 'Problema–Solución', hint: 'Muestra el problema y cómo tu producto lo resuelve.', stage: 'tofu' },
  { code: 'EDU', label: 'Educativo / How-to', hint: 'Enseña algo útil; posiciona el producto como el método.', stage: 'tofu' },
  { code: 'STORY', label: 'Storytelling / Founder', hint: 'Historia personal o de origen que genera identificación.', stage: 'tofu' },
  { code: 'PRUEBA', label: 'Prueba social', hint: 'Muchos ya lo usan / reseñas / cantidad de clientes.', stage: 'mofu' },
  { code: 'TESTI', label: 'Testimonial', hint: 'Un cliente real cuenta su resultado.', stage: 'mofu' },
  { code: 'AUTOR', label: 'Autoridad / Experto', hint: 'Respaldo de experto, dato o certificación.', stage: 'mofu' },
  { code: 'AB', label: 'Antes / Después', hint: 'Transformación visible del antes al después.', stage: 'mofu' },
  { code: 'COMPARA', label: 'Comparación', hint: 'Tú vs. la alternativa / competencia.', stage: 'mofu' },
  { code: 'OFERTA', label: 'Oferta / Promoción', hint: 'Descuento, combo o bono claro.', stage: 'bofu' },
  { code: 'URGENCIA', label: 'Urgencia / Escasez', hint: 'Tiempo limitado o stock limitado.', stage: 'bofu' },
  { code: 'GARANTIA', label: 'Garantía / Sin riesgo', hint: 'Devolución, prueba gratis: quita el miedo a comprar.', stage: 'bofu' },
];

/** Nombre consistente para que empate con el export de Meta.
 *  Formato: BATCH | NN | STAGE | ANGLE | FORMATO
 *  (ej. "B01 | 01 | TOF | DESESP | VID"). El NN es un consecutivo único por
 *  anuncio para que no se pierdan entre muchos. Los segmentos vacíos se omiten. */
export function adName(
  batch: string,
  seq: number | string,
  stage: Stage,
  angleCode?: string,
  format?: AdFormat | string,
): string {
  const st = STAGES.find((s) => s.v === stage)?.short ?? 'TOF';
  const fmt = format === 'video' ? 'VID' : format === 'imagen' ? 'IMG' : '';
  const nn = String(seq).padStart(2, '0');
  return [batch.trim(), nn, st, angleCode ?? '', fmt].filter(Boolean).join(' | ');
}

/** Extrae el consecutivo (NN) de un nombre ya formado; si no hay, usa fallback. */
export function seqOfName(name: string, fallback: number): string {
  const parts = name.split('|').map((x) => x.trim());
  return parts[1] && /^\d{1,3}$/.test(parts[1]) ? parts[1] : String(fallback).padStart(2, '0');
}

export type ScaffoldAd = {
  name: string;
  funnel_stage: Stage;
  angle: string;
  format: AdFormat;
  awareness_stage: string;
  hypothesis: string;
};

/** Auto-arma el ecosistema base de un batch: 2 TOF, 2 MOF, 2 BOF con ángulos
 *  sugeridos y nomenclatura lista. El usuario luego edita/agrega. */
export function scaffoldBatch(batch: string): ScaffoldAd[] {
  const plan: Array<{ stage: Stage; angle: string; awareness: string; format: AdFormat }> = [
    { stage: 'tofu', angle: 'DESESP', awareness: 'problema', format: 'video' },
    { stage: 'tofu', angle: 'EDU', awareness: 'problema', format: 'video' },
    { stage: 'mofu', angle: 'TESTI', awareness: 'solucion', format: 'video' },
    { stage: 'mofu', angle: 'AB', awareness: 'solucion', format: 'imagen' },
    { stage: 'bofu', angle: 'OFERTA', awareness: 'producto', format: 'imagen' },
    { stage: 'bofu', angle: 'URGENCIA', awareness: 'total', format: 'imagen' },
  ];
  return plan.map((p, i) => {
    const meta = ANGLES.find((a) => a.code === p.angle);
    return {
      name: adName(batch, i + 1, p.stage, p.angle, p.format),
      funnel_stage: p.stage,
      angle: p.angle,
      format: p.format,
      awareness_stage: p.awareness,
      hypothesis: meta?.hint ?? '',
    };
  });
}

/** Etapa de embudo a partir del código corto (TOF/MOF/BOF). */
export function stageFromShort(short: string): Stage {
  const s = short.toUpperCase();
  return s.startsWith('MOF') ? 'mofu' : s.startsWith('BOF') ? 'bofu' : 'tofu';
}

/** Lee la nomenclatura de un nombre de anuncio de Meta para inferir batch,
 *  etapa, ángulo y formato. Tolera nombres que NO siguen la convención. */
export function parseAdName(name: string): {
  batch: string; stage?: Stage; angle?: string; format?: AdFormat;
} {
  // Separa por "_" o "|" (los dos convenios comunes en Meta) y quita la
  // extensión de archivo. El CONJUNTO = primer token (B01, B02, ...).
  const clean = name.replace(/\.(mp4|mov|m4v|jpg|jpeg|png|webp|gif)$/i, '');
  const segs = clean.split(/[|_]/).map((p) => p.trim()).filter(Boolean);
  const batch = (segs[0] || clean).trim() || 'Importados';
  let stage: Stage | undefined;
  let angle: string | undefined;
  let format: AdFormat | undefined;
  if (/\.(mp4|mov|m4v)$/i.test(name)) format = 'video';
  else if (/\.(jpg|jpeg|png|webp|gif)$/i.test(name)) format = 'imagen';
  for (const p of segs.slice(1)) {
    const up = p.toUpperCase();
    if (/^(TOFU?|MOFU?|BOFU?)\b/.test(up)) stage = stageFromShort(up);
    else if (up === 'VID' || up === 'VIDEO') format = 'video';
    else if (up === 'IMG' || up === 'IMAGEN' || up === 'IMAGE') format = 'imagen';
    else if (/^\d{1,3}$/.test(p)) { /* consecutivo */ }
    else if (/^\d{1,2}[A-Z]{3,}\d*$/i.test(p)) { /* fecha tipo 04JUL */ }
    else if (!angle && p.length > 2 && !/^V\d+$/i.test(up)) angle = p;
  }
  return { batch, stage, angle, format };
}
