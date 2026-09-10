// Legacy route. The screen moved into Producción (/workshop).
import { redirect } from 'next/navigation';

export default function LegacyRedirect() {
  redirect('/workshop');
}
