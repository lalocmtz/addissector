// Plataforma personal: la gestión vive en /app/marcas.
import { redirect } from 'next/navigation';

export default function CuentaPage() {
  redirect('/app/marcas');
}
