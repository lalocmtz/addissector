-- =============================================================================
-- AdDNA — Etapa 2: SaaS multi-tenant (cuentas, marcas, suscripciones, uso)
-- Córrelo en Supabase → SQL Editor → New query → Run.
-- Requiere el schema base (supabase/schema.sql) ya aplicado.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Perfiles (1:1 con auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  stripe_customer_id text,
  created_at timestamptz default now()
);

create unique index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Marcas / workspaces
-- ---------------------------------------------------------------------------
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  tone text,
  palette text,
  product text,
  created_at timestamptz default now()
);

create index if not exists brands_user_idx on public.brands (user_id);

-- ---------------------------------------------------------------------------
-- 3. Suscripciones (estado sincronizado desde Stripe vía webhook)
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial',        -- trial | starter | growth | scale
  status text not null default 'trialing',   -- trialing | active | past_due | canceled
  stripe_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 4. Contadores de uso mensuales
-- ---------------------------------------------------------------------------
create table if not exists public.usage_counters (
  user_id uuid references auth.users(id) on delete cascade,
  period_start date not null,                -- primer día del mes
  analyses_used int not null default 0,
  primary key (user_id, period_start)
);

-- Incremento atómico (lo llama el servidor tras un análisis exitoso).
create or replace function public.increment_usage(p_user_id uuid, p_period date)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.usage_counters (user_id, period_start, analyses_used)
  values (p_user_id, p_period, 1)
  on conflict (user_id, period_start)
  do update set analyses_used = usage_counters.analyses_used + 1;
$$;

-- ---------------------------------------------------------------------------
-- 5. creatives → multi-tenant
-- ---------------------------------------------------------------------------
alter table public.creatives add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.creatives add column if not exists brand_id uuid references public.brands(id) on delete set null;

create index if not exists creatives_user_idx on public.creatives (user_id);
create index if not exists creatives_brand_idx on public.creatives (brand_id);

-- Backfill opcional: asignar filas existentes a un usuario concreto.
-- update public.creatives set user_id = '<TU-USER-UUID>' where user_id is null;

-- ---------------------------------------------------------------------------
-- 6. Trigger de registro: perfil + marca por defecto + trial de 7 días
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  insert into public.brands (user_id, name)
  values (new.id, 'Mi marca');

  insert into public.subscriptions (user_id, plan, status, current_period_end)
  values (new.id, 'trial', 'trialing', now() + interval '7 days')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 7. RLS — cada usuario ve solo lo suyo (el service-role del server la omite)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_counters enable row level security;
alter table public.creatives enable row level security;

drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "brands_own" on public.brands;
create policy "brands_own" on public.brands
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "subscriptions_own_read" on public.subscriptions;
create policy "subscriptions_own_read" on public.subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "usage_own_read" on public.usage_counters;
create policy "usage_own_read" on public.usage_counters
  for select using (auth.uid() = user_id);

drop policy if exists "creatives_own" on public.creatives;
create policy "creatives_own" on public.creatives
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
