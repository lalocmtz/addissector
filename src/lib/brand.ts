// =============================================================================
// Brand + pricing config — single source of truth for the marketing site.
// Swap BRAND.name / tagline here to rebrand the whole landing in one place.
// Naming shortlist (see blueprint): AdDNA · Adloop · Winlab · Clonad · Scalr
// =============================================================================

export const BRAND = {
  name: 'AdDNA',
  tagline: 'La inteligencia detrás de tus anuncios ganadores.',
  subtitle:
    'Sube el creativo que ya te está funcionando, entiende POR QUÉ convierte y genera variantes listas para producir — todo en una sola plataforma.',
  domain: 'addissector.vercel.app',
};

export type BillingCycle = 'monthly' | 'annual';

export interface PricingTier {
  id: 'starter' | 'growth' | 'scale';
  name: string;
  priceMonthly: number;   // USD / mes en facturación mensual
  priceAnnual: number;    // USD / mes equivalente en facturación anual (2 meses gratis)
  blurb: string;
  featured?: boolean;
  cta: string;
  features: string[];
  // Stripe price IDs (rellenar en variables de entorno del proyecto).
  stripePriceEnvMonthly: string;
  stripePriceEnvAnnual: string;
}

export const TIERS: PricingTier[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceMonthly: 39,
    priceAnnual: 32,
    blurb: 'Para el dueño que empieza a tomar decisiones con datos.',
    cta: 'Empezar',
    features: [
      '1 marca / workspace',
      '30 análisis al mes (video o imagen)',
      'Variantes de guion ilimitadas',
      'Prompts de replicación listos para copiar',
      'Biblioteca de creativos',
    ],
    stripePriceEnvMonthly: 'STRIPE_PRICE_STARTER_MONTHLY',
    stripePriceEnvAnnual: 'STRIPE_PRICE_STARTER_ANNUAL',
  },
  {
    id: 'growth',
    name: 'Growth',
    priceMonthly: 99,
    priceAnnual: 82,
    blurb: 'Para escalar creativos en serio, marca por marca.',
    featured: true,
    cta: 'Probar Growth',
    features: [
      '3 marcas / workspaces',
      '150 análisis al mes',
      'Análisis de video + imagen',
      'Fórmula maestra (análisis cruzado)',
      'Export listo para Seedance',
      'Soporte prioritario',
    ],
    stripePriceEnvMonthly: 'STRIPE_PRICE_GROWTH_MONTHLY',
    stripePriceEnvAnnual: 'STRIPE_PRICE_GROWTH_ANNUAL',
  },
  {
    id: 'scale',
    name: 'Scale',
    priceMonthly: 249,
    priceAnnual: 207,
    blurb: 'Para equipos y agencias que corren muchas marcas.',
    cta: 'Hablar con ventas',
    features: [
      'Marcas / workspaces ilimitados',
      '500 análisis al mes',
      'Equipo: hasta 5 asientos',
      'Acceso a API',
      'Onboarding + soporte dedicado',
    ],
    stripePriceEnvMonthly: 'STRIPE_PRICE_SCALE_MONTHLY',
    stripePriceEnvAnnual: 'STRIPE_PRICE_SCALE_ANNUAL',
  },
];
