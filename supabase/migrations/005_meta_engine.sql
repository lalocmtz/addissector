-- =============================================================================
-- AdDNA v3 — Motor Meta + Cerebro + Research (plataforma personal)
-- (Ya aplicada en el proyecto bjnogzwwtpyetoyrjfwu el 2026-08-06 vía MCP)
-- =============================================================================

alter table public.brands add column if not exists economics jsonb;
alter table public.creatives add column if not exists video_url text;
alter table public.creatives add column if not exists ad_name text;

insert into storage.buckets (id, name, public)
values ('creative-videos', 'creative-videos', true)
on conflict (id) do nothing;

create table if not exists public.meta_ads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  name text not null,
  status text,
  created_date date,
  first_seen date,
  last_seen date,
  dossier_meta text,
  dossier_video text,
  creative_id uuid references public.creatives(id) on delete set null,
  updated_at timestamptz default now(),
  unique (brand_id, name)
);
create index if not exists meta_ads_brand_idx on public.meta_ads (brand_id, last_seen desc);

create table if not exists public.meta_daily (
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  ad_name text not null,
  date date not null,
  status text,
  spend numeric default 0,
  revenue numeric,
  roas numeric,
  cpa numeric,
  cpc numeric,
  cpm numeric,
  v3s numeric,
  hook_rate numeric,
  v25 numeric,
  v50 numeric,
  v75 numeric,
  freq numeric,
  cost_atc numeric,
  link_clicks numeric,
  cvr numeric,
  result_rate numeric,
  created_at timestamptz default now(),
  primary key (brand_id, ad_name, date)
);
create index if not exists meta_daily_brand_date_idx on public.meta_daily (brand_id, date desc);

create table if not exists public.learnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  text text not null,
  evidence text,
  source_ad text,
  active boolean default true,
  created_at timestamptz default now()
);
create index if not exists learnings_brand_idx on public.learnings (brand_id, created_at desc);

create table if not exists public.brain_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  title text not null,
  content text not null default '',
  sort int default 0,
  updated_at timestamptz default now()
);
create index if not exists brain_brand_idx on public.brain_sections (brand_id, sort);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz default now()
);
create index if not exists chat_brand_idx on public.chat_messages (brand_id, created_at);

create table if not exists public.research_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  kind text not null default 'angulo',
  title text not null,
  body text,
  source text,
  status text not null default 'idea',
  created_at timestamptz default now()
);
create index if not exists research_brand_idx on public.research_notes (brand_id, created_at desc);

alter table public.meta_ads enable row level security;
alter table public.meta_daily enable row level security;
alter table public.learnings enable row level security;
alter table public.brain_sections enable row level security;
alter table public.chat_messages enable row level security;
alter table public.research_notes enable row level security;

drop policy if exists "meta_ads_own" on public.meta_ads;
create policy "meta_ads_own" on public.meta_ads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "meta_daily_own" on public.meta_daily;
create policy "meta_daily_own" on public.meta_daily for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "learnings_own" on public.learnings;
create policy "learnings_own" on public.learnings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "brain_own" on public.brain_sections;
create policy "brain_own" on public.brain_sections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "chat_own" on public.chat_messages;
create policy "chat_own" on public.chat_messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "research_own" on public.research_notes;
create policy "research_own" on public.research_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
