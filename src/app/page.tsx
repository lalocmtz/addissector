// =============================================================================
// AdDNA — plataforma personal: la raíz va directo al motor (Meta).
// El middleware manda a /login si no hay sesión.
// =============================================================================

import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/meta');
}
