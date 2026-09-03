'use client';

// =============================================================================
// AdDNA — Hook de datos de cuenta (perfil, plan, uso, marcas) + marca activa.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';

export interface BrandEconomics {
  currency?: string;
  breakeven?: number;
  target?: number;
  kill?: number;
}

export interface BrandRow {
  id: string;
  name: string;
  tone: string | null;
  palette: string | null;
  product: string | null;
  economics?: BrandEconomics | null;
  created_at: string;
}

export interface MeData {
  configured: boolean;
  user: { id: string; email: string | null; full_name: string } | null;
  brands: BrandRow[];
}

const ACTIVE_BRAND_KEY = 'addna-active-brand';

export function useMe() {
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeBrandId, setActiveBrandIdState] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/me');
      if (res.status === 401) {
        setMe(null);
        setError('unauthenticated');
        return;
      }
      const data = (await res.json()) as MeData;
      setMe(data);
      setError(null);

      // Resuelve la marca activa: localStorage → primera marca.
      const stored =
        typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_BRAND_KEY) : null;
      const brands = data.brands ?? [];
      const valid = brands.find((b) => b.id === stored);
      const next = valid?.id ?? brands[0]?.id ?? null;
      setActiveBrandIdState(next);
      if (next && typeof window !== 'undefined') localStorage.setItem(ACTIVE_BRAND_KEY, next);
    } catch {
      setError('No se pudo cargar tu cuenta.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActiveBrandId = useCallback((id: string) => {
    setActiveBrandIdState(id);
    if (typeof window !== 'undefined') localStorage.setItem(ACTIVE_BRAND_KEY, id);
  }, []);

  const activeBrand = me?.brands.find((b) => b.id === activeBrandId) ?? null;

  return { me, loading, error, refresh, activeBrand, activeBrandId, setActiveBrandId };
}

/** Lee la marca activa sin hook (para handlers fuera de React). */
export function getStoredActiveBrandId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_BRAND_KEY);
}
