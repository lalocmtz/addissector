// =============================================================================
// i18n core — runtime-agnostic (server components and client components).
// The dictionaries live in src/i18n/*.ts; React bindings are in ./i18n.tsx.
// =============================================================================

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
