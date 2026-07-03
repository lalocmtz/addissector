'use client';

// =============================================================================
// AdDNA — Header de la app: selector de marca (estilo Slack/Notion), uso del
// mes, navegación y cuenta.
// =============================================================================

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Scan, ChevronDown, Check, Plus, Library, Settings, LogOut, Gauge, Sparkles,
} from 'lucide-react';
import type { MeData, BrandRow } from '@/lib/use-me';

interface AppHeaderProps {
  me: MeData | null;
  activeBrand: BrandRow | null;
  onBrandChange: (id: string) => void;
}

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

  const usage = me?.usage;
  const usagePct = usage && usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0;
  const lowRemaining = usage ? usage.remaining <= Math.max(1, Math.floor(usage.limit * 0.1)) : false;

  const navItem = (href: string, label: string) => (
    <Link
      href={href}
      className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
        pathname === href
          ? 'text-[#f1f5f9] bg-[#1e1e2e]'
          : 'text-[#94a3b8] hover:text-[#f1f5f9]'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="border-b border-[#1e1e2e] px-6 py-3 sticky top-0 z-50 bg-[#0a0a0f]/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Link href="/studio" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg gradient-blue flex items-center justify-center">
              <Scan className="w-4 h-4 text-white" />
            </div>
            <span className="hidden sm:inline text-sm font-bold tracking-tight">AdDNA</span>
          </Link>

          {/* Selector de marca */}
          {me?.configured && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1e1e2e] bg-[#111118] text-sm text-[#f1f5f9] hover:border-[#3b82f6]/50 transition-colors max-w-[180px]"
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

        <nav className="hidden md:flex items-center gap-1">
          {navItem('/studio', 'Studio')}
          {navItem('/app/crear', 'Crear de 0')}
          {navItem('/biblioteca', 'Biblioteca')}
          {navItem('/app/marcas', 'Marcas')}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {/* Uso del mes */}
          {usage && usage.limit > 0 && Number.isFinite(usage.limit) && (
            <Link
              href="/app/cuenta"
              className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-[family-name:var(--font-mono)] transition-colors ${
                lowRemaining
                  ? 'border-[#f59e0b]/40 text-[#fbbf24] hover:border-[#f59e0b]'
                  : 'border-[#1e1e2e] text-[#94a3b8] hover:border-[#3b82f6]/50'
              }`}
              title={`Análisis usados este mes: ${usage.used} de ${usage.limit}`}
            >
              <Gauge className="w-3.5 h-3.5" />
              {usage.used}/{usage.limit}
              <span className="w-14 h-1.5 rounded-full bg-[#1e1e2e] overflow-hidden">
                <span
                  className={`block h-full rounded-full ${lowRemaining ? 'bg-[#f59e0b]' : 'bg-[#3b82f6]'}`}
                  style={{ width: `${usagePct}%` }}
                />
              </span>
            </Link>
          )}

          {me?.plan?.id === 'trial' && (
            <Link
              href="/#precios"
              className="hidden lg:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg gradient-blue text-white font-medium"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Elegir plan
            </Link>
          )}

          <Link
            href="/app/cuenta"
            className="p-2 rounded-lg text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#1e1e2e] transition-colors"
            title="Mi cuenta"
          >
            <Settings className="w-4 h-4" />
          </Link>
          <form action="/logout" method="POST">
            <button
              type="submit"
              className="p-2 rounded-lg text-[#94a3b8] hover:text-[#f43f5e] hover:bg-[#1e1e2e] transition-colors"
              title="Cerrar sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </form>
          <Link
            href="/biblioteca"
            className="md:hidden p-2 rounded-lg text-[#94a3b8] hover:text-[#f1f5f9]"
            title="Biblioteca"
          >
            <Library className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
