// =============================================================================
// Nombres del lote. Un lote = 1 concepto × 1 avatar × 1 trabajo.
//   Conjunto: FI-012 | RUBEN | VS-CALCOMANIA | ATENCION
//   Anuncios: FI-012-A1 … FI-012-A6
// El código (FI-012) es lo que une Meta con la plataforma: los resultados se
// leen solos buscando el código en el nombre del anuncio.
// =============================================================================

/** "Vs calcomanía!" → "VS-CALCOMANIA": lo que va entre barras en el nombre del conjunto. */
export function etiqueta(t: string, max = 22): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'X';
}

const TRABAJO_LABEL: Record<string, string> = { atencion: 'ATENCION', valor: 'VALOR', confianza: 'CONFIANZA' };
export function nombreLote(code: string, avatar: string, concepto: string, trabajo: string): string {
  return `${code} | ${etiqueta(avatar || 'GENERAL', 16)} | ${etiqueta(concepto)} | ${TRABAJO_LABEL[trabajo] ?? etiqueta(trabajo)}`;
}

export function nombreAnuncio(code: string, i: number): string {
  return `${code}-A${i + 1}`;
}
