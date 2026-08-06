// Plataforma personal: no hay registro público.
import { redirect } from 'next/navigation';

export default function SignupPage() {
  redirect('/login');
}
