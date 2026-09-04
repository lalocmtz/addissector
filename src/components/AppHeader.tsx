'use client';

// =============================================================================
// AdDNA — Header unificado de la plataforma personal.
// Un solo menú en TODAS las secciones:
// Meta · Planificación · Biblioteca · Cerebro · Analizar video.
// El selector de marca cambia el contexto de toda la plataforma.
// =============================================================================

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Scan, LayoutGrid, ChevronDown, Check, Plus, LogOut, BarChart3, Library, Brain, Film, SunMoon, FlaskConical } from 'lucide-react';
import type { MeData, BrandRow } from '@/lib/use-me';
import { useT, useLocale, setLocaleCookie, type Locale } from '@/lib/i18n';

interface AppHeaderProps {
  me: MeData | null;
  activeBrand: BrandRow | null;
  onBrandChange: (id: string) => void;
}

const NAV = [
  { href: '/meta', key: 'nav.meta', icon: BarChart3 },
  { href: '/experiments', key: 'nav.experiments', icon: FlaskConical },
  { href: '/strategy', key: 'nav.strategy', icon: LayoutGrid },
  { href: '/biblioteca', key: 'nav.library', icon: Library },
  { href: '/cerebro', key: 'nav.brain', icon: Brain },
  { href: '/studio', key: 'nav.analyze', icon: Film },
] as const;

function setTheme(next: 'light' | 'dark') {
  document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.setAttribute('data-theme', next);
}

export default function AppHeader({ me, activeBrand, onBrandChange }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const isActive = (href: string) =>
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === '/biblioteca' && (pathname.startsWith('/analyze'))) ||
    (href === '/studio' && pathname.startsWith('/studio'));

  return (
    <header className="border-b border-line px-4 sm:px-6 py-3 sticky top-0 z-50 bg-canvas/90 ">
      <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/meta" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg gradient-blue flex items-center justify-center">
              <Scan className="w-4 h-4 text-on-accent" />
            </div>
            <span className="hidden lg:inline text-sm font-semibold tracking-tight font-[family-name:var(--font-serif)]">Addissector</span>
          </Link>

          {/* Selector de marca */}
          {me?.configured && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-line bg-surface text-sm text-ink hover:border-accent/50 transition-colors max-w-[160px]"
              >
                <span className="w-5 h-5 rounded-md gradient-blue flex items-center justify-center text-[10px] font-bold text-on-accent shrink-0">
                  {(activeBrand?.name ?? 'M')[0]?.toUpperCase()}
                </span>
                <span className="truncate">{activeBrand?.name ?? t('nav.myBrand')}</span>
                <ChevronDown className="w-3.5 h-3.5 text-ink-4 shrink-0" />
              </button>

              {open && (
                <div className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-line bg-surface shadow-2xl  p-1.5 z-50">
                  <p className="text-[10px] uppercase tracking-wide text-ink-4 px-2.5 py-1.5">
                    {t('nav.brands')}
                  </p>
                  {me.brands.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        onBrandChange(b.id);
                        setOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-ink hover:bg-surface-2 transition-colors"
                    >
                      <span className="w-5 h-5 rounded-md gradient-blue flex items-center justify-center text-[10px] font-bold text-on-accent">
                        {b.name[0]?.toUpperCase()}
                      </span>
                      <span className="truncate flex-1 text-left">{b.name}</span>
                      {activeBrand?.id === b.id && <Check className="w-4 h-4 text-ok" />}
                    </button>
                  ))}
                  <div className="h-px bg-surface-2 my-1.5" />
                  <button
                    onClick={() => {
                      setOpen(false);
                      router.push('/app/marcas');
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    {t('nav.manageBrands')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <nav className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto">
          {NAV.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                isActive(href)
                  ? 'text-ink bg-surface-2'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              <Icon className="w-3.5 h-3.5 hidden sm:block" />
              {t(key)}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1 shrink-0">
          <select
            aria-label={t('nav.language')}
            value={locale}
            onChange={(e) => { setLocaleCookie(e.target.value as Locale); router.refresh(); }}
            className="text-xs bg-transparent border border-line rounded-md px-1.5 py-1 text-ink-2 font-[family-name:var(--font-mono)]"
          >
            <option value="en">EN</option>
            <option value="es">ES</option>
          </select>
          <button
            type="button"
            onClick={() => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-md text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
            title="Theme"
          >
            <SunMoon className="w-4 h-4" />
          </button>
        <form action="/logout" method="POST" className="shrink-0">
          <button
            type="submit"
            className="p-2 rounded-lg text-ink-3 hover:text-danger hover:bg-surface-2 transition-colors"
            title={t('nav.signOut')}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </form>
        </div>
      </div>
    </header>
  );
}
