// =============================================================================
// AdDNA — Feature flags
// Punto ÚNICO de control para ocultar/mostrar el motor de generación real.
//
// v1 (default): AdDNA es un ANALISTA de creativos. Se ocultan B-roll ("Crear"),
// el Estudio de Clonación (CloneStudio) y la galería de generaciones. La salida
// del análisis (veredicto, scores, y los PROMPTS/BRIEF de texto) se mantiene.
//
// Para reactivar TODO el motor de generación: define en Vercel
//   NEXT_PUBLIC_FEATURE_GENERATION=1
// y redeploy. No hay que tocar UI de nuevo.
// =============================================================================

/** Interruptor maestro (público para Server y Client Components). */
export const FEATURE_GENERATION_ENABLED: boolean =
  process.env.NEXT_PUBLIC_FEATURE_GENERATION === '1' ||
  process.env.NEXT_PUBLIC_FEATURE_GENERATION === 'true';

/** Rutas que SOLO existen cuando la generación está activa. */
export const GENERATION_ROUTES: readonly string[] = ['/app/crear'] as const;

/** ¿Esta ruta debe estar bloqueada en v1? */
export function isGenerationRoute(pathname: string): boolean {
  if (FEATURE_GENERATION_ENABLED) return false;
  return GENERATION_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  );
}

/** Gatea botones/paneles de generación real (CloneStudio, etc.). */
export function canGenerate(): boolean {
  return FEATURE_GENERATION_ENABLED;
}
