// Ruta legacy: el cerebro ahora es nativo en /cerebro.
import { redirect } from 'next/navigation';

export default function CerebroLegacyPage() {
  redirect('/cerebro');
}
