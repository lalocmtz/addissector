'use client';

// =============================================================================
// AppHeader — the one navigation of the platform, as a LEFT SIDEBAR.
//
// Every page renders <AppHeader/> first and its own content after it. The
// sidebar is fixed to the left edge on desktop; a rule in globals.css
// (`body:has(aside[data-sidebar])`) pushes the page body to the right, so no
// page needs to know the sidebar exists. On narrow screens it collapses to a
// top bar with a drawer.
//
// Four places, in the order the work happens:
//   Biblioteca  what ran and what it returned
//   Producción  what we are making next, and how each tanda is doing
//   Cerebro     what we know: personas, ángulos, aprendizajes
//   Meta        the connection and the sync
// Plus the tools (Analizar video) and the account (Marcas).
// =============================================================================

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Scan, ChevronDown, Check, Plus, LogOut, BarChart3, Library, Brain, Film, SunMoon, FlaskConical, Settings, Menu, X, LayoutDashboard,
} from 'lucide-react';
import type { MeData, BrandRow } from '@/lib/use-me';
import { useT, useLocale, setLocaleCookie, type Locale } from '@/lib/i18n';

interface AppHeaderProps {
  me: MeData | null;
  activeBrand: BrandRow | null;
  onBrandChange: (id: string) => void;
}

const WORK = [
  { href: '/biblioteca', key: 'nav.library', icon: Library },
  { href: '/canvas', key: 'nav.canvas', icon: LayoutDashboard },
  { href: '/workshop', key: 'nav.workshop', icon: FlaskConical },
  { href: '/cerebro', key: 'nav.brain', icon: Brain },
  { href: '/meta', key: 'nav.meta', icon: BarChart3 },
] as const;

const TOOLS = [
  { href: '/studio', key: 'nav.analyze', icon: Film },
  { href: '/app/marcas', key: 'nav.brandsSettings', icon: Settings },
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
  const [drawer, setDrawer] = useState(false);
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
    (href === '/biblioteca' && pathname.startsWith('/analyze')) ||
    (href === '/workshop' && (pathname.startsWith('/experiments') || pathname.startsWith('/strategy') || pathname.startsWith('/plan')));

  const item = (href: string, key: string, Icon: typeof Library) => (
    <Link
      key={href}
      href={href}
      onClick={() => setDrawer(false)}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
        isActive(href) ? 'bg-accent-soft text-accent font-medium' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate">{t(key)}</span>
    </Link>
  );

  const brandSelector = me?.configured ? (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-surface text-sm text-ink hover:border-accent/50 transition-colors"
      >
        <span className="w-5 h-5 rounded-md gradient-blue flex items-center justify-center text-[10px] font-bold text-on-accent shrink-0">
          {(activeBrand?.name ?? 'M')[0]?.toUpperCase()}
        </span>
        <span className="truncate flex-1 text-left">{activeBrand?.name ?? t('nav.myBrand')}</span>
        <ChevronDown className="w-3.5 h-3.5 text-ink-4 shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 rounded-xl border border-line bg-surface shadow-2xl p-1.5 z-50">
          <p className="text-[10px] uppercase tracking-wide text-ink-4 px-2.5 py-1.5">{t('nav.brands')}</p>
          {me.brands.map((b) => (
            <button
              key={b.id}
              onClick={() => { onBrandChange(b.id); setOpen(false); }}
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
            onClick={() => { setOpen(false); router.push('/app/marcas'); }}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('nav.manageBrands')}
          </button>
        </div>
      )}
    </div>
  ) : null;

  const body = (
    <>
      <div className="px-4 pt-5 pb-3">
        <Link href="/biblioteca" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-blue flex items-center justify-center">
            <Scan className="w-4 h-4 text-on-accent" />
          </div>
          <span className="text-base font-semibold tracking-tight font-[family-name:var(--font-serif)]">Addissector</span>
        </Link>
      </div>
      <div className="px-3 pb-3">{brandSelector}</div>

      <nav className="px-3 flex-1 overflow-y-auto">
        <p className="text-[10px] uppercase tracking-wider text-ink-4 px-3 pt-2 pb-1.5">{t('nav.sectionWork')}</p>
        <div className="space-y-0.5">{WORK.map(({ href, key, icon }) => item(href, key, icon))}</div>
        <p className="text-[10px] uppercase tracking-wider text-ink-4 px-3 pt-5 pb-1.5">{t('nav.sectionTools')}</p>
        <div className="space-y-0.5">{TOOLS.map(({ href, key, icon }) => item(href, key, icon))}</div>
      </nav>

      <div className="px-3 py-3 border-t border-line">
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0 px-2">
            <p className="text-xs text-ink truncate">{me?.user?.email ?? ''}</p>
          </div>
          <select
            aria-label={t('nav.language')}
            value={locale}
            onChange={(e) => { setLocaleCookie(e.target.value as Locale); router.refresh(); }}
            className="text-[11px] bg-transparent border border-line rounded-md px-1 py-0.5 text-ink-2 font-[family-name:var(--font-mono)]"
          >
            <option value="en">EN</option>
            <option value="es">ES</option>
          </select>
          <button
            type="button"
            onClick={() => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-md text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
            title="Theme"
          >
            <SunMoon className="w-4 h-4" />
          </button>
          <form action="/logout" method="POST">
            <button type="submit" className="p-1.5 rounded-md text-ink-3 hover:text-danger hover:bg-surface-2 transition-colors" title={t('nav.signOut')}>
              <LogOut className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: fixed sidebar */}
      <aside
        data-sidebar
        className="hidden lg:flex fixed left-0 top-0 h-screen w-[240px] flex-col border-r border-line bg-surface z-40"
      >
        {body}
      </aside>

      {/* Mobile: top bar + drawer */}
      <header className="lg:hidden sticky top-0 z-40 border-b border-line bg-surface px-4 py-2.5 flex items-center justify-between">
        <Link href="/biblioteca" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg gradient-blue flex items-center justify-center">
            <Scan className="w-3.5 h-3.5 text-on-accent" />
          </div>
          <span className="text-sm font-semibold font-[family-name:var(--font-serif)]">Addissector</span>
          {activeBrand && <span className="text-xs text-ink-3">· {activeBrand.name}</span>}
        </Link>
        <button type="button" onClick={() => setDrawer(true)} className="p-2 rounded-md text-ink-2 hover:bg-surface-2" aria-label="Menu">
          <Menu className="w-5 h-5" />
        </button>
      </header>
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-overlay" onClick={() => setDrawer(false)} />
          <aside className="absolute left-0 top-0 h-full w-[260px] max-w-[85vw] flex flex-col bg-surface border-r border-line shadow-2xl">
            <button type="button" onClick={() => setDrawer(false)} className="absolute right-2 top-3 p-1.5 rounded-md text-ink-3 hover:bg-surface-2" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
            {body}
          </aside>
        </div>
      )}
    </>
  );
}
