// =============================================================================
// AdDNA — /research quedó absorbido por el Cerebro.
// Todo lo que entra de afuera (búsqueda web, notas y documentos) vive ahora en
// la pestaña "Externo" del Cerebro. Esta ruta solo existe para que los enlaces
// viejos sigan funcionando.
// =============================================================================

import { redirect } from 'next/navigation';

export default function ResearchPage() {
  redirect('/cerebro?tab=externo');
}
