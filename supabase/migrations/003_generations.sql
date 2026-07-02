-- =============================================================================
-- AdDNA — Etapa 3: Estudio de clonación (generaciones con Kie.ai + activos de marca)
-- Córrelo en Supabase → SQL Editor → New query → Run.
-- =============================================================================

-- Generaciones (imágenes y videos producidos vía Kie.ai)
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  creative_id uuid references public.creatives(id) on delete set null,
  parent_id uuid references public.generations(id) on delete set null, -- imagen origen de un video
  kind text not null,                        -- 'image' | 'video'
  status text not null default 'pending',    -- pending | processing | success | failed
  prompt text not null,
  spoken_script text,                        -- guion hablado (videos)
  variant_label text,                        -- ej. "Variante 2 — mamá joven en cocina"
  kie_task_id text,
  kie_model text,
  result_url text,                           -- URL final (nuestro storage)
  error text,
  duration_seconds int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists generations_user_idx on public.generations (user_id, created_at desc);
create index if not exists generations_creative_idx on public.generations (creative_id);

-- Fotos de producto / referencias de la marca
create table if not exists public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  kind text not null default 'product',      -- 'product' | 'creator' | 'logo'
  url text not null,
  created_at timestamptz default now()
);

create index if not exists brand_assets_brand_idx on public.brand_assets (brand_id);

-- Buckets públicos (Kie necesita URLs públicas para las referencias)
insert into storage.buckets (id, name, public) values ('generations', 'generations', true)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('brand-assets', 'brand-assets', true)
on conflict (id) do nothing;

-- RLS
alter table public.generations enable row level security;
alter table public.brand_assets enable row level security;

drop policy if exists "generations_own" on public.generations;
create policy "generations_own" on public.generations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "brand_assets_own" on public.brand_assets;
create policy "brand_assets_own" on public.brand_assets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
