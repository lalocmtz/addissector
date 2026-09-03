-- =============================================================================
-- 014 · Coverage — "what have we tested?" as a query, not an intuition.
--
-- v_ad_rollup     lifetime counts per ad (spend, revenue, purchases, 3s views…)
-- v_coverage      persona × angle × dimension × value with the ads and spend
--                 that back each cell. A cell with spend ≥ the brand's kill is
--                 "tested"; the cartesian product minus these cells is the gap
--                 list the Experiment Generator works from (Phase E).
-- =============================================================================
create or replace view public.v_ad_rollup as
select brand_id, ad_id,
       max(ad_name) as ad_name,
       count(*) as days,
       sum(spend) as spend, sum(revenue) as revenue, sum(purchases) as purchases,
       sum(impressions) as impressions, sum(v3s) as v3s, sum(thruplay) as thruplay, sum(v75) as v75,
       sum(link_clicks) as link_clicks,
       min(date) as first_date, max(date) as last_date
from public.ad_daily
where ad_id is not null
group by brand_id, ad_id;

create or replace view public.v_coverage as
select m.brand_id,
       m.persona_id, p.name as persona,
       m.angle_id, a.code as angle_code, a.name as angle,
       d.dimension, d.value,
       count(distinct m.ad_id) as ads,
       coalesce(sum(r.spend), 0) as spend,
       case when sum(r.spend) > 0 then sum(r.revenue) / sum(r.spend) end as roas,
       case when sum(r.impressions) > 0 then sum(r.v3s) / sum(r.impressions) * 100 end as hook_rate,
       coalesce(sum(r.spend), 0) >= coalesce((b.economics->>'kill')::numeric, 58) as tested,
       array_agg(distinct m.ad_id) as ad_ids
from public.meta_ads m
join public.brands b on b.id = m.brand_id
left join public.personas p on p.id = m.persona_id
left join public.angles a on a.id = m.angle_id
join public.ad_dimension d on d.brand_id = m.brand_id and d.ad_id = m.ad_id
left join public.v_ad_rollup r on r.brand_id = m.brand_id and r.ad_id = m.ad_id
group by m.brand_id, m.persona_id, p.name, m.angle_id, a.code, a.name, d.dimension, d.value, b.economics;
