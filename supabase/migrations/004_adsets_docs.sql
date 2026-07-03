-- =============================================================================
-- AdDNA — Etapa 4: Conjuntos de anuncios (Meta) + documentos de marca
-- =============================================================================

create table if not exists public.ad_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  name text not null,
  pain text,                                 -- dolor/ángulo del conjunto
  notes text,                                -- estrategia / hipótesis general
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists ad_sets_user_idx on public.ad_sets (user_id, created_at desc);

create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  ad_set_id uuid references public.ad_sets(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,                        -- debe coincidir con el nombre en Meta
  funnel_stage text default 'tofu',          -- tofu | mofu | bofu
  pain text,                                 -- dolor específico del anuncio
  hypothesis text,                           -- explicación / planificación
  script text,                               -- qué dice el anuncio
  is_winner boolean default false,
  metrics jsonb,                             -- fila cruda del export de Meta
  created_at timestamptz default now()
);
create index if not exists ads_set_idx on public.ads (ad_set_id);

create table if not exists public.brand_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  filename text not null,
  extracted_text text,                       -- texto extraído (contexto creativo)
  created_at timestamptz default now()
);
create index if not exists brand_docs_brand_idx on public.brand_docs (brand_id);

alter table public.ad_sets enable row level security;
alter table public.ads enable row level security;
alter table public.brand_docs enable row level security;

drop policy if exists "ad_sets_own" on public.ad_sets;
create policy "ad_sets_own" on public.ad_sets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "ads_own" on public.ads;
create policy "ads_own" on public.ads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "brand_docs_own" on public.brand_docs;
create policy "brand_docs_own" on public.brand_docs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
