-- 018 — Triple Whale: the second opinion on revenue.
--
-- Meta grades its own homework. Triple Whale attributes with its own pixel and
-- its own model, so the two numbers disagree — and the gap between them is the
-- point of this table, not a defect to be smoothed over.
--
-- triple_daily runs in parallel to ad_daily. Nothing joins them by default:
-- a reader asks for one source or the other, on purpose.

create table if not exists triple_account (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade,
  brand_id       uuid not null references brands(id) on delete cascade,
  shop_domain    text not null,
  api_key        text not null,
  active         boolean not null default true,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (brand_id)
);

create table if not exists triple_daily (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  brand_id   uuid not null references brands(id) on delete cascade,
  ad_id      text not null,
  date       date not null,
  spend      numeric,
  revenue    numeric,
  purchases  numeric,
  roas       numeric,
  raw        jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_id, date)
);

create table if not exists triple_sync_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  brand_id    uuid references brands(id) on delete cascade,
  status      text not null,
  http_status integer,
  error       text,
  detalle     jsonb,
  started_at  timestamptz not null default now()
);

create index if not exists triple_daily_brand_date on triple_daily (brand_id, date);
create index if not exists triple_daily_ad on triple_daily (ad_id, date);

alter table triple_account   enable row level security;
alter table triple_daily     enable row level security;
alter table triple_sync_runs enable row level security;

create policy triple_account_own   on triple_account   for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy triple_daily_own     on triple_daily     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy triple_sync_runs_own on triple_sync_runs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
