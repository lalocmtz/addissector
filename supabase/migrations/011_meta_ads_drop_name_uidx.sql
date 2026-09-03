-- =============================================================================
-- 011 · meta_ads: the (brand_id, name) uniqueness also lived as a plain unique
-- index (meta_ads_brand_name_uidx), not only as the constraint dropped in 010.
-- Two ads may share a name; only the Meta ad_id is unique.
-- =============================================================================
drop index if exists public.meta_ads_brand_name_uidx;
