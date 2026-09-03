-- =============================================================================
-- 010 · The truth layer: ad_account (currency from Meta), ad_daily (counts +
-- canonical rates), meta_ads keyed by meta ad_id.
--
-- Why a new table instead of ALTERing meta_daily:
--   * meta_daily's primary key was (brand_id, ad_name, date). Two ads with the
--     same name on the same day collapsed into one row — that is BUG-2 at the
--     storage level, not just in the joins. ad_daily is keyed by ad_id.
--   * meta_daily had THREE row semantics living together: CSV rows, rows from
--     the Vercel sync (v3s = video plays, v25..v75 = counts) and rows from the
--     hourly Supabase edge function meta-sync v4 (v3s = 3-second views,
--     v25..v75 = percentages). ad_daily stores COUNTS only; every rate is a
--     generated column with one definition, mirrored by src/lib/metrics.ts.
--
-- Nothing is dropped. meta_daily and meta_accounts move to schema `archive`
-- with every row, after being copied.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ad_account — owns the currency and timezone, derived from Meta
-- ---------------------------------------------------------------------------
create table public.ad_account (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete cascade,
  ad_account_id    text not null,                          -- "act_123"
  name             text,
  currency         text,                                   -- ISO 4217, from Meta
  currency_source  text not null default 'pending' check (currency_source in ('meta','pending')),
  timezone         text,                                   -- from Meta (timezone_name)
  access_token     text,                                   -- user token used by the edge sync
  active           boolean not null default true,
  last_synced_at   timestamptz,
  last_sync_error  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (brand_id, ad_account_id)
);
alter table public.ad_account enable row level security;
create policy ad_account_own on public.ad_account for all using (auth.uid() = user_id);

-- Existing account rows (token included) + brands that had an account id but no row.
insert into public.ad_account (brand_id, user_id, ad_account_id, access_token, active, last_synced_at, created_at)
select m.brand_id, b.user_id, m.ad_account_id, m.access_token, m.active, m.last_synced_at, m.created_at
from public.meta_accounts m join public.brands b on b.id = m.brand_id;

insert into public.ad_account (brand_id, user_id, ad_account_id, access_token, active)
select b.id, b.user_id, b.meta_ad_account_id,
       (select access_token from public.meta_accounts order by created_at limit 1),
       true
from public.brands b
where b.meta_ad_account_id is not null
  and not exists (select 1 from public.ad_account a where a.brand_id = b.id and a.ad_account_id = b.meta_ad_account_id);

-- ---------------------------------------------------------------------------
-- 2. ad_daily — one row per ad per day, counts only, rates generated
-- ---------------------------------------------------------------------------
create table public.ad_daily (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,
  brand_id         uuid not null references public.brands(id) on delete cascade,
  ad_id            text,                    -- Meta ad id. NULL only on legacy CSV rows that could not be resolved.
  ad_name          text not null,
  date             date not null,
  source           text not null check (source in ('api','csv')),
  -- 0 = migrated from the mixed-semantics meta_daily (video metrics untrusted)
  -- 1 = written by the canonical sync (all counts real)
  metrics_version  smallint not null default 1,
  legacy_ambiguous boolean not null default false,  -- CSV row whose name maps to >1 ad_id

  status           text,
  adset_id         text,
  adset_name       text,
  campaign_id      text,
  campaign_name    text,

  -- counts / money (what Meta actually reports)
  spend            numeric not null default 0,
  revenue          numeric,
  purchases        numeric,
  atc              numeric,
  impressions      numeric,
  reach            numeric,
  freq             numeric,
  link_clicks      numeric,
  plays            numeric,   -- video_play_actions: any start (autoplay counts). Not the hook.
  v3s              numeric,   -- actions[video_view]: 3-second views. THE hook numerator.
  thruplay         numeric,   -- video_thruplay_watched_actions
  v15s             numeric,   -- video_15_sec_watched_actions
  v25              numeric,
  v50              numeric,
  v75              numeric,
  v100             numeric,
  play_curve       jsonb,     -- video_play_curve_actions (retention curve), when available

  -- canonical rates — definitions mirrored in src/lib/metrics.ts
  roas        numeric generated always as (case when spend > 0 and revenue is not null then revenue / spend end) stored,
  cpa         numeric generated always as (case when purchases > 0 then spend / purchases end) stored,
  cpc         numeric generated always as (case when link_clicks > 0 then spend / link_clicks end) stored,
  cpm         numeric generated always as (case when impressions > 0 then spend / impressions * 1000 end) stored,
  cost_atc    numeric generated always as (case when atc > 0 then spend / atc end) stored,
  hook_rate   numeric generated always as (case when impressions > 0 and v3s is not null then v3s / impressions * 100 end) stored,
  hold_rate   numeric generated always as (case when v3s > 0 and thruplay is not null then thruplay / v3s * 100 end) stored,
  ret25       numeric generated always as (case when v3s > 0 and v25 is not null then v25 / v3s * 100 end) stored,
  ret50       numeric generated always as (case when v3s > 0 and v50 is not null then v50 / v3s * 100 end) stored,
  ret75       numeric generated always as (case when v3s > 0 and v75 is not null then v75 / v3s * 100 end) stored,
  ret100      numeric generated always as (case when v3s > 0 and v100 is not null then v100 / v3s * 100 end) stored,
  cvr         numeric generated always as (case when link_clicks > 0 and purchases is not null then purchases / link_clicks * 100 end) stored,
  result_rate numeric generated always as (case when impressions > 0 and link_clicks is not null then link_clicks / impressions * 100 end) stored,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- API rows: one per (brand, ad, day). NULL ad_id never conflicts here.
create unique index ad_daily_brand_ad_date_key on public.ad_daily (brand_id, ad_id, date);
-- Legacy CSV rows without an id: one per (brand, name, day).
create unique index ad_daily_legacy_name_date_key on public.ad_daily (brand_id, ad_name, date) where ad_id is null;
create index ad_daily_brand_date_idx on public.ad_daily (brand_id, date);
create index ad_daily_ad_idx on public.ad_daily (ad_id);
alter table public.ad_daily enable row level security;
create policy ad_daily_own on public.ad_daily for all using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Copy meta_daily → ad_daily, faithfully, flagging what cannot be trusted
-- ---------------------------------------------------------------------------
-- Names that map to exactly one ad_id (safe to resolve CSV rows with).
create temp table _name_to_id as
select brand_id, ad_name, min(ad_id) as ad_id
from public.meta_daily where ad_id is not null
group by brand_id, ad_name having count(distinct ad_id) = 1;

create temp table _ambiguous as
select brand_id, ad_name
from public.meta_daily where ad_id is not null
group by brand_id, ad_name having count(distinct ad_id) > 1;

insert into public.ad_daily (
  user_id, brand_id, ad_id, ad_name, date, source, metrics_version, legacy_ambiguous,
  status, adset_name, campaign_name,
  spend, revenue, purchases, atc, impressions, freq, link_clicks,
  plays, v3s, v25, v50, v75, created_at
)
select
  d.user_id, d.brand_id,
  coalesce(d.ad_id, n.ad_id)                                   as ad_id,
  d.ad_name, d.date,
  case when d.ad_id is null then 'csv' else 'api' end          as source,
  0                                                            as metrics_version,
  (d.ad_id is null and a.ad_name is not null)                  as legacy_ambiguous,
  d.status, d.adset_name, d.campaign_name,
  coalesce(d.spend, 0),
  d.revenue,
  coalesce(d.purchases, case when d.cpa > 0 then d.spend / d.cpa end),
  case when d.cost_atc > 0 then d.spend / d.cost_atc end,
  coalesce(d.impressions, case when d.cpm > 0 then d.spend / d.cpm * 1000 end),
  d.freq,
  d.link_clicks,
  -- Video fields by row lineage:
  --   recent rows (>= 2026-08-27) were last written by edge meta-sync v4:
  --     v3s = real 3s views, v25..v75 = percentages of v3s → invert to counts.
  --   older API rows were last written by the Vercel sync: v3s = plays.
  --   CSV rows: v3s and v25..v75 are counts as exported.
  case when d.ad_id is not null and d.date < date '2026-08-27' then d.v3s end             as plays,
  case when d.ad_id is null or d.date >= date '2026-08-27' then d.v3s end                 as v3s,
  case when d.ad_id is null then d.v25 when d.date >= date '2026-08-27' then round(d.v25 / 100 * d.v3s) end as v25,
  case when d.ad_id is null then d.v50 when d.date >= date '2026-08-27' then round(d.v50 / 100 * d.v3s) end as v50,
  case when d.ad_id is null then d.v75 when d.date >= date '2026-08-27' then round(d.v75 / 100 * d.v3s) end as v75,
  coalesce(d.created_at, now())
from public.meta_daily d
left join _name_to_id n on n.brand_id = d.brand_id and n.ad_name = d.ad_name and d.ad_id is null
left join _ambiguous a on a.brand_id = d.brand_id and a.ad_name = d.ad_name and d.ad_id is null;

-- ---------------------------------------------------------------------------
-- 4. meta_ads: the Meta ad id is the key, the name is an attribute
-- ---------------------------------------------------------------------------
alter table public.meta_ads alter column ad_id set not null;
alter table public.meta_ads drop constraint meta_ads_brand_id_name_key;
alter table public.meta_ads add constraint meta_ads_brand_id_ad_id_key unique (brand_id, ad_id);
create index meta_ads_brand_name_idx on public.meta_ads (brand_id, name);

-- planned_ads: the pin. Once matched, the name stops mattering.
alter table public.planned_ads add column meta_ad_id text;
alter table public.planned_ads add column matched_at timestamptz;
create index planned_ads_meta_ad_id_idx on public.planned_ads (brand_id, meta_ad_id);

-- ---------------------------------------------------------------------------
-- 5. Dependents of meta_daily: rebuild on ad_daily
-- ---------------------------------------------------------------------------
drop view if exists public.v_ads_para_analizar;
create view public.v_ads_para_analizar as
with ult7 as (
  select brand_id, ad_id,
         sum(spend) as spend7, sum(revenue) as revenue7, sum(purchases) as purchases7,
         case when sum(spend) > 0 then sum(revenue) / sum(spend) end as roas7,
         min(date) as primer_dia, max(date) as ultimo_dia
  from public.ad_daily
  where date >= current_date - 7 and ad_id is not null
  group by brand_id, ad_id
), edad as (
  select brand_id, ad_id, min(date) as primer_dia_historico
  from public.ad_daily where ad_id is not null group by brand_id, ad_id
)
select a.brand_id, a.name, a.ad_id, a.media_url, a.media_type, a.thumbnail_url,
       u.spend7, u.revenue7, u.purchases7, round(u.roas7, 2) as roas7,
       (current_date - e.primer_dia_historico) as dias_de_vida,
       case
         when u.roas7 >= coalesce((b.economics->>'target')::numeric, 2) and u.spend7 >= coalesce((b.economics->>'kill')::numeric, 58) then 'ganador'
         when u.spend7 >= 2 * coalesce((b.economics->>'kill')::numeric, 58) and (u.roas7 is null or u.roas7 < coalesce((b.economics->>'breakeven')::numeric, 1.46)) and (current_date - e.primer_dia_historico) >= 7 then 'antivideo'
       end as categoria,
       (a.dossier_meta is not null or a.dossier_video is not null or a.fusion is not null) as analizado
from public.meta_ads a
join ult7 u on u.brand_id = a.brand_id and u.ad_id = a.ad_id
join edad e on e.brand_id = a.brand_id and e.ad_id = a.ad_id
join public.brands b on b.id = a.brand_id
where (u.roas7 >= coalesce((b.economics->>'target')::numeric, 2) and u.spend7 >= coalesce((b.economics->>'kill')::numeric, 58))
   or (u.spend7 >= 2 * coalesce((b.economics->>'kill')::numeric, 58) and (u.roas7 is null or u.roas7 < coalesce((b.economics->>'breakeven')::numeric, 1.46)) and (current_date - e.primer_dia_historico) >= 7);

create or replace function public.addna_resumen7()
returns table(brand_id uuid, brand text, spend numeric, revenue numeric, roas numeric, compras numeric)
language sql stable security definer set search_path to 'public'
as $$
  select d.brand_id, b.name as brand,
         round(sum(d.spend)::numeric, 2) as spend,
         round(sum(d.revenue)::numeric, 2) as revenue,
         round((sum(d.revenue) / nullif(sum(d.spend), 0))::numeric, 2) as roas,
         sum(d.purchases) as compras
  from public.ad_daily d join public.brands b on b.id = d.brand_id
  where d.date >= current_date - 7
  group by d.brand_id, b.name;
$$;

-- ---------------------------------------------------------------------------
-- 6. Retire the old tables (rows preserved) and the duplicate asset cron
-- ---------------------------------------------------------------------------
alter table public.meta_daily    set schema archive;
alter table archive.meta_daily   rename to meta_daily_legacy;
alter table public.meta_accounts set schema archive;
alter table archive.meta_accounts rename to meta_accounts_legacy;

-- meta-creatives (edge) resolved assets through /advideos + title matching and
-- wrote media_url; the Vercel resolver (page tokens, 5 fallbacks) is the one
-- that works. One asset writer. The 128 files it stored stay in storage.
select cron.unschedule('meta-creatives-hourly');
