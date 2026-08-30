-- =============================================================================
-- AdDNA v4 — Lectura automática desde la Meta Marketing API.
-- Sustituye el CSV manual por sync directo y agrega la cola de barrido de
-- creativos que alimenta el Cerebro sin intervención.
-- =============================================================================

-- --- Marca: a qué cuenta publicitaria y página apunta -----------------------
alter table public.brands add column if not exists meta_ad_account_id text;
alter table public.brands add column if not exists meta_page_id text;
alter table public.brands add column if not exists auto_sync boolean default true;

-- --- Dimensión de anuncios: ids REALES de Meta ------------------------------
alter table public.meta_ads add column if not exists ad_id text;
alter table public.meta_ads add column if not exists adset_id text;
alter table public.meta_ads add column if not exists campaign_id text;
alter table public.meta_ads add column if not exists creative_meta_id text;
alter table public.meta_ads add column if not exists video_id text;
alter table public.meta_ads add column if not exists page_id text;

-- Asset descargable resuelto por la cadena de estrategias
alter table public.meta_ads add column if not exists asset_url text;
alter table public.meta_ads add column if not exists asset_kind text;      -- video | image | none
alter table public.meta_ads add column if not exists asset_strategy text;  -- qué ruta funcionó
alter table public.meta_ads add column if not exists asset_error text;
alter table public.meta_ads add column if not exists thumbnail_url text;
alter table public.meta_ads add column if not exists duration numeric;

-- Cola del barrido automático
alter table public.meta_ads add column if not exists queue_status text default 'pendiente';
  -- pendiente | procesando | listo | error | omitido
alter table public.meta_ads add column if not exists queue_error text;
alter table public.meta_ads add column if not exists queue_attempts int default 0;
alter table public.meta_ads add column if not exists analyzed_at timestamptz;

create index if not exists meta_ads_queue_idx
  on public.meta_ads (brand_id, queue_status, last_seen desc);
create index if not exists meta_ads_ad_id_idx on public.meta_ads (ad_id);
create index if not exists meta_ads_video_idx on public.meta_ads (video_id);
create index if not exists meta_ads_page_idx on public.meta_ads (page_id);

-- --- Hechos diarios: ad_id real --------------------------------------------
alter table public.meta_daily add column if not exists ad_id text;
alter table public.meta_daily add column if not exists impressions numeric;
create index if not exists meta_daily_ad_id_idx on public.meta_daily (ad_id, date desc);

-- --- Creativos: vínculo duro con Meta (mata el matching por nombre) --------
alter table public.creatives add column if not exists meta_ad_id text;
alter table public.creatives add column if not exists meta_video_id text;
alter table public.creatives add column if not exists source text default 'manual'; -- manual | auto
create index if not exists creatives_meta_video_idx on public.creatives (meta_video_id);
create index if not exists creatives_meta_ad_idx on public.creatives (meta_ad_id);

-- --- Bitácora de sincronización --------------------------------------------
create table if not exists public.meta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  kind text not null,                 -- numeros | creativos | analisis
  status text not null default 'ok',  -- ok | error
  ads_vistos int default 0,
  dias_escritos int default 0,
  encolados int default 0,
  analizados int default 0,
  detalle jsonb,
  error text,
  started_at timestamptz default now(),
  finished_at timestamptz
);
create index if not exists meta_sync_brand_idx
  on public.meta_sync_runs (brand_id, started_at desc);

alter table public.meta_sync_runs enable row level security;
drop policy if exists "meta_sync_own" on public.meta_sync_runs;
create policy "meta_sync_own" on public.meta_sync_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
