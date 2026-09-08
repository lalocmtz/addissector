-- 019 — Snapshot of ad_daily as it stood under metrics_version 1, taken before
-- the v6 re-sync rewrites conversions and revenue.
--
-- Why: v5 of meta-sync summed omni_purchase + purchase +
-- offsite_conversion.fb_pixel_purchase, which are nested rather than disjoint,
-- so every purchase and every unit of revenue was counted up to three times.
-- v6 picks the widest family instead. The re-sync overwrites ad_daily in place;
-- this table keeps the old numbers so any historical claim can be traced back
-- and the size of the correction can be measured per ad and per day.
--
-- It is a frozen copy. Nothing writes to it after this migration.

create table if not exists ad_daily_v1_snapshot as
  select id, user_id, brand_id, ad_id, ad_name, date, source, metrics_version,
         legacy_ambiguous, status, adset_id, adset_name, campaign_id, campaign_name,
         spend, revenue, purchases, atc, impressions, reach, freq, link_clicks,
         plays, v3s, thruplay, v15s, v25, v50, v75, v100,
         roas, cpa, cvr, updated_at,
         now() as snapshot_at
  from ad_daily;

create index if not exists ad_daily_v1_snapshot_key
  on ad_daily_v1_snapshot (brand_id, ad_id, date);

comment on table ad_daily_v1_snapshot is
  'Frozen copy of ad_daily before the meta-sync v6 conversion fix (2026-09-08). Read-only.';

alter table ad_daily_v1_snapshot enable row level security;

create policy ad_daily_v1_snapshot_own on ad_daily_v1_snapshot
  for select using (user_id = auth.uid());
