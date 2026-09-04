-- =============================================================================
-- 017 · Team roles, products, hypothesis document and notes (Phase D)
--
--   member.role      gains the roles a creative team actually has
--   product          several products per brand, assignable to an experiment
--   experiment       hypothesis_doc (the fillable template), notes, product_id
--   idea             notes
--
-- Additive only.
-- =============================================================================

alter table public.member drop constraint if exists member_role_check;
alter table public.member add constraint member_role_check
  check (role in ('strategist','image_editor','video_editor','ugc_creator','media_buyer','designer','editor','ai','other'));

create table if not exists public.product (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  brand_id    uuid not null references public.brands(id) on delete cascade,
  name        text not null,
  description text,
  price       numeric,
  url         text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists product_brand_idx on public.product (brand_id);
alter table public.product enable row level security;
create policy product_own on public.product for all using (auth.uid() = user_id);

-- Seed one product per brand from the legacy brands.product text, when present.
insert into public.product (user_id, brand_id, name)
select b.user_id, b.id, left(b.product, 160) from public.brands b
where coalesce(b.product, '') <> '' and not exists (select 1 from public.product p where p.brand_id = b.id);

alter table public.experiment
  add column if not exists product_id uuid references public.product(id) on delete set null,
  add column if not exists hypothesis_doc jsonb,
  add column if not exists notes text;
alter table public.idea add column if not exists notes text;
