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
  Scan, LayoutGrid, ChevronDown, Check, Plus, LogOut, BarChart3, Library, Brain, Film,
} from 'lucide-react';
import type { MeData, BrandRow } from '@/lib/use-me';

interface AppHeaderProps {
  me: MeData | null;
  activeBrand: BrandRow | null;
  onBrandChange: (id: string) => void;
}

const NAV = [
  { href: '/meta', label: 'Meta', icon: BarChart3 },
  { href: '/plan', label: 'Planificación', icon: LayoutGrid },
  { href: '/biblioteca', label: 'Biblioteca', icon: Library },
  { href: '/cerebro', label: 'Cerebro', icon: Brain },
  { href: '/studio', label: 'Analizar video', icon: Film },
] as const;

export default function AppHeader({ me, activeBrand, onBrandChange }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
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
    <header className="border-b border-[#1e1e2e] px-4 sm:px-6 py-3 sticky top-0 z-50 bg-[#0a0a0f]/90 backdrop-blur-xl">
      <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/meta" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg gradient-blue flex items-center justify-center">
              <Scan className="w-4 h-4 text-white" />
            </div>
            <span className="hidden lg:inline text-sm font-bold tracking-tight">AdDNA</span>
          </Link>

          {/* Selector de marca */}
          {me?.configured && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1e1e2e] bg-[#111118] text-sm text-[#f1f5f9] hover:border-[#3b82f6]/50 transition-colors max-w-[160px]"
              >
                <span className="w-5 h-5 rounded-md gradient-blue flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                  {(activeBrand?.name ?? 'M')[0]?.toUpperCase()}
                </span>
                <span className="truncate">{activeBrand?.name ?? 'Mi marca'}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#64748b] shrink-0" />
              </button>

              {open && (
                <div className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-[#1e1e2e] bg-[#111118] shadow-2xl shadow-black/50 p-1.5 z-50">
                  <p className="text-[10px] uppercase tracking-wide text-[#64748b] px-2.5 py-1.5">
                    Tus marcas
                  </p>
                  {me.brands.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        onBrandChange(b.id);
                        setOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-[#f1f5f9] hover:bg-[#1e1e2e] transition-colors"
                    >
                      <span className="w-5 h-5 rounded-md gradient-blue flex items-center justify-center text-[10px] font-bold text-white">
                        {b.name[0]?.toUpperCase()}
                      </span>
                      <span className="truncate flex-1 text-left">{b.name}</span>
                      {activeBrand?.id === b.id && <Check className="w-4 h-4 text-[#22c55e]" />}
                    </button>
                  ))}
                  <div className="h-px bg-[#1e1e2e] my-1.5" />
                  <button
                    onClick={() => {
                      setOpen(false);
                      router.push('/app/marcas');
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-[#94a3b8] hover:bg-[#1e1e2e] hover:text-[#f1f5f9] transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Gestionar marcas
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <nav className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                isActive(href)
                  ? 'text-[#f1f5f9] bg-[#1e1e2e]'
                  : 'text-[#94a3b8] hover:text-[#f1f5f9]'
              }`}
            >
              <Icon className="w-3.5 h-3.5 hidden sm:block" />
              {label}
            </Link>
          ))}
        </nav>

        <form action="/logout" method="POST" className="shrink-0">
          <button
            type="submit"
            className="p-2 rounded-lg text-[#94a3b8] hover:text-[#f43f5e] hover:bg-[#1e1e2e] transition-colors"
            title="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
