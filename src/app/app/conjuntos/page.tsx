// Ruta legacy: el análisis de Meta ahora es nativo en /meta.
import { redirect } from 'next/navigation';

export default function ConjuntosPage() {
  redirect('/meta');
}
