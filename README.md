# AdDNA — La inteligencia detrás de tus anuncios ganadores

SaaS multi-tenant para dueños de ecommerce/DTC: sube el creativo que ya te funciona (video o imagen), entiende **por qué vende** en lenguaje simple, y recibe **prompts de IA o un brief para tu equipo creativo** para producir más variantes. Next.js 16 + Supabase (Auth + DB + Storage) + Anthropic Claude + Stripe.

## Arranque rápido

```bash
cp .env.example .env.local   # rellena los valores (ver secciones abajo)
npm install
npm run dev
```

## 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. SQL Editor → corre en orden:
   - `supabase/schema.sql` (tabla `creatives` + bucket de previews)
   - `supabase/migrations/002_saas.sql` (profiles, brands, subscriptions, usage_counters, RLS y trigger de registro)
3. Authentication → Providers: habilita **Email** y **Google** (para Google configura el OAuth client en Google Cloud y pega el client ID/secret).
4. Authentication → URL Configuration: agrega `http://localhost:3000/auth/callback` y tu dominio de producción (`https://tudominio.com/auth/callback`).
5. Copia a `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_URL`.

Al registrarse un usuario, el trigger `handle_new_user` crea su perfil, una marca por defecto ("Mi marca") y un **trial de 7 días con 3 análisis**.

### Backfill (opcional)

Si ya tenías filas en `creatives`, asígnalas a tu usuario:

```sql
update public.creatives set user_id = '<TU-USER-UUID>' where user_id is null;
```

## 2. Stripe

1. **Crea los productos/precios** en [dashboard.stripe.com](https://dashboard.stripe.com) (modo test primero):
   - Starter — $39/mes y $384/año ($32/mes equivalente)
   - Growth — $99/mes y $984/año ($82/mes)
   - Scale — $249/mes y $2,484/año ($207/mes)
2. Copia los 6 price IDs a `.env.local` (`STRIPE_PRICE_*_MONTHLY` / `_ANNUAL`).
3. Copia tu `STRIPE_SECRET_KEY` (sk_test_... / sk_live_...).
4. **Webhook**: Developers → Webhooks → Add endpoint:
   - URL: `https://tudominio.com/api/stripe/webhook`
   - Eventos: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copia el signing secret a `STRIPE_WEBHOOK_SECRET`.
   - En local: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
5. **Customer Portal**: Settings → Billing → Customer portal → actívalo (permite cancelar/cambiar plan). El botón "Gestionar suscripción" vive en `/app/cuenta`.

Flujo completo: registro → `/api/checkout` crea/reusa el customer y abre Stripe Checkout → el webhook actualiza la tabla `subscriptions` → el gating de `/api/analyze*` lee el plan efectivo.

## 3. Planes y límites

| Plan    | Análisis/mes | Marcas      |
|---------|--------------|-------------|
| Trial   | 3 (7 días)   | 1           |
| Starter | 30           | 1           |
| Growth  | 150          | 3           |
| Scale   | 500          | Ilimitadas  |

Un "análisis" = una llamada exitosa a `/api/analyze` o `/api/analyze-image`. Si se excede el límite, la API responde `402` con CTA a upgrade. Los contadores viven en `usage_counters` (se reinician el día 1 de cada mes).

## 4. Estructura

- `/` landing · `/login` `/signup` auth · `/studio` subir y analizar · `/analyze` `/analyze-image` resultados (veredicto → receta → análisis completo) · `/biblioteca` biblioteca por marca · `/app/marcas` CRUD de marcas · `/app/cuenta` plan, uso y Customer Portal.
- El middleware (`src/middleware.ts`) protege `/studio`, `/analyze*`, `/biblioteca` y `/app*`.
- La vista de resultados tiene 3 capas: **Capa 1** veredicto (frase + score 0-100 + semáforos), **Capa 2** receta ganadora + "cómo hacer más" con toggle **Modo IA** (prompts) / **Modo Equipo** (briefs), **Capa 3** análisis técnico completo (colapsado).

## 5. Variables de entorno

Ver `.env.example`. Resumen: Supabase (4), Anthropic/Groq (2), Stripe (8), `NEXT_PUBLIC_SITE_URL`.

## Deploy (Vercel)

Configura todas las envs en Vercel, apunta el webhook de Stripe al dominio de producción y agrega el callback de producción en Supabase Auth.
