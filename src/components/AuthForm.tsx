'use client';

// =============================================================================
// AdDNA — Formulario compartido de login / signup (email+password y Google).
// =============================================================================

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Scan, Loader2, Mail, Lock, User } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase-browser';
import { BRAND } from '@/lib/brand';

interface AuthFormProps {
  mode: 'login' | 'signup';
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="var(--color-google-blue)" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="var(--color-google-green)" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="var(--color-google-yellow)" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="var(--color-google-red)" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isSignup = mode === 'signup';
  const next = searchParams.get('next') || '/studio';
  // Continuar a checkout tras registrarse desde la landing de precios.
  const tier = searchParams.get('tier');
  const cycle = searchParams.get('cycle');

  const afterAuth = async () => {
    if (tier) {
      try {
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier, cycle: cycle || 'monthly' }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.url) {
          window.location.href = data.url;
          return;
        }
      } catch {
        /* sigue al studio */
      }
    }
    router.push(next);
    router.refresh();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const supabase = createBrowserClient();
      if (isSignup) {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (err) throw err;
        if (data.session) {
          await afterAuth();
        } else {
          setInfo('Te enviamos un correo de confirmación. Ábrelo para activar tu cuenta.');
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        await afterAuth();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Algo salió mal. Intenta de nuevo.';
      setError(
        /invalid login credentials/i.test(message)
          ? 'Correo o contraseña incorrectos.'
          : /already registered/i.test(message)
            ? 'Ese correo ya tiene cuenta. Inicia sesión.'
            : message
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError(null);
    try {
      const supabase = createBrowserClient();
      const params = new URLSearchParams();
      params.set('next', tier ? `/studio?tier=${tier}&cycle=${cycle || 'monthly'}` : next);
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback?${params.toString()}` },
      });
      if (err) throw err;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(
        /not enabled|unsupported provider|validation_failed/i.test(message)
          ? 'El acceso con Google aún no está habilitado. Por ahora entra con tu correo y contraseña.'
          : 'No se pudo iniciar con Google. Intenta con tu correo y contraseña.'
      );
      setGoogleLoading(false);
    }
  };

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <Link href="/" className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl gradient-blue flex items-center justify-center">
            <Scan className="w-5 h-5 text-on-accent" />
          </div>
          <span className="text-xl font-bold tracking-tight">{BRAND.name}</span>
        </Link>

        <div className="rounded-2xl border border-line bg-surface p-6">
          <h1 className="text-xl font-bold mb-1">
            {isSignup ? 'Crea tu cuenta' : 'Bienvenido de vuelta'}
          </h1>
          <p className="text-sm text-ink-3 mb-6">
            {isSignup
              ? 'Empieza gratis: 3 análisis para entender por qué venden tus anuncios.'
              : 'Entra para seguir escalando tus creativos ganadores.'}
          </p>

          <button
            onClick={handleGoogle}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border border-line-strong text-ink hover:border-accent/50 transition-colors disabled:opacity-60 mb-4"
          >
            {googleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleIcon />}
            Continuar con Google
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-surface-2" />
            <span className="text-[10px] uppercase tracking-wide text-ink-4">o con correo</span>
            <div className="h-px flex-1 bg-surface-2" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {isSignup && (
              <div className="relative">
                <User className="w-4 h-4 text-ink-4 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Tu nombre"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-canvas border border-line text-sm text-ink placeholder:text-ink-4 focus:border-accent/60 focus:outline-none"
                />
              </div>
            )}
            <div className="relative">
              <Mail className="w-4 h-4 text-ink-4 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tucorreo@ejemplo.com"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-canvas border border-line text-sm text-ink placeholder:text-ink-4 focus:border-accent/60 focus:outline-none"
              />
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-ink-4 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? 'Contraseña (mínimo 6 caracteres)' : 'Contraseña'}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-canvas border border-line text-sm text-ink placeholder:text-ink-4 focus:border-accent/60 focus:outline-none"
              />
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}
            {info && <p className="text-xs text-ok">{info}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold gradient-blue text-on-accent shadow-lg  hover: transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSignup ? 'Crear cuenta gratis' : 'Entrar'}
            </button>
          </form>
        </div>

      </motion.div>
    </main>
  );
}
