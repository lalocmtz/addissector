'use client';

// =============================================================================
// i18n — the product is built in English; Spanish is a locale.
//
// Usage (client components):
//   const t = useT();
//   t('meta.columns.spend')            → "Spend" | "Gasto"
//   t('meta.memory', { from, to })     → interpolates {from} {to}
//
// The dictionary lives in src/i18n/*.ts. Keys are dot paths; a missing key
// falls back to English, then to the key itself (never a blank UI).
// The locale comes from the `locale` cookie (default "en") and is applied by
// <LocaleProvider> in the root layout.
// =============================================================================

import { createContext, useCallback, useContext, useMemo } from 'react';
import { en } from '@/i18n/en';
import { es } from '@/i18n/es';

export type Locale = 'en' | 'es';
export const LOCALES: Locale[] = ['en', 'es'];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'locale';

type Dict = Record<string, string>;
const DICTS: Record<Locale, Dict> = { en, es };

export type Vars = Record<string, string | number | null | undefined>;

export function translate(locale: Locale, key: string, vars?: Vars): string {
  const raw = DICTS[locale]?.[key] ?? DICTS.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] == null ? '' : String(vars[k])));
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as string[]).includes(v);
}

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Translation hook. Stable identity per locale so it is safe in deps arrays. */
export function useT(): (key: string, vars?: Vars) => string {
  const locale = useLocale();
  return useCallback((key: string, vars?: Vars) => translate(locale, key, vars), [locale]);
}

/** Intl helpers bound to the active locale. */
export function useFormatters() {
  const locale = useLocale();
  return useMemo(() => makeFormatters(locale), [locale]);
}

export function makeFormatters(locale: Locale) {
  const tag = locale === 'es' ? 'es-MX' : 'en-US';
  return {
    /** Money with an explicit ISO code: "US$1,240" / "MX$18,500". Never a bare "$". */
    money(n: number | null | undefined, currency: string | null | undefined, opts: { compact?: boolean } = {}): string {
      if (n == null || !Number.isFinite(n)) return '—';
      const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
      if (!code) return `${n.toLocaleString(tag, { maximumFractionDigits: 2 })} ¤`;
      const digits = Math.abs(n) >= 100 ? 0 : 2;
      return new Intl.NumberFormat(tag, {
        style: 'currency', currency: code, currencyDisplay: 'code',
        minimumFractionDigits: digits, maximumFractionDigits: digits,
        ...(opts.compact ? { notation: 'compact' } : {}),
      }).format(n).replace(/ /g, ' ');
    },
    pct(n: number | null | undefined, digits = 1): string {
      if (n == null || !Number.isFinite(n)) return '—';
      return `${n.toFixed(digits)}%`;
    },
    num(n: number | null | undefined, digits = 0): string {
      if (n == null || !Number.isFinite(n)) return '—';
      return n.toLocaleString(tag, { maximumFractionDigits: digits, minimumFractionDigits: digits });
    },
    ratio(n: number | null | undefined, digits = 2): string {
      if (n == null || !Number.isFinite(n)) return '—';
      return n.toFixed(digits);
    },
    date(iso: string | null | undefined): string {
      if (!iso) return '—';
      const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
      return d.toLocaleDateString(tag, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    },
  };
}

/** Persist the locale in the cookie and reload so server components pick it up. */
export function setLocaleCookie(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}
