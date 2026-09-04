-- =============================================================================
-- 016 · Review state for taxonomy entities (Phase D)
--
-- The Taxonomy Classifier proposes personas / angles / concepts / hooks. A
-- proposal is not strategy until a person accepts it. This adds one column
-- per bank that says where each row stands, independent of the legacy
-- Spanish `status` values, plus a pointer for merges (the row is kept; its
-- references move to the survivor).
--
-- Additive only. Existing classifier rows become 'proposed'; everything else
-- was created by a person or by the old brain ingest and stays 'accepted'.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array['personas', 'angles', 'concepts', 'hook'] loop
    execute format('alter table public.%I add column if not exists review_status text not null default ''accepted'' check (review_status in (''proposed'',''accepted'',''rejected'',''merged''))', t);
    execute format('alter table public.%I add column if not exists merged_into uuid', t);
    execute format('alter table public.%I add column if not exists reviewed_at timestamptz', t);
    execute format('create index if not exists %I on public.%I (brand_id, review_status)', t || '_review_idx', t);
  end loop;
end $$;

update public.personas set review_status = 'proposed' where source = 'classifier';
update public.angles   set review_status = 'proposed' where source = 'classifier';
update public.concepts set review_status = 'proposed' where origin = 'classifier';
update public.hook     set review_status = 'proposed' where source = 'classifier';

-- Concepts get a rollup-derived status too (angles already have one from 013).
alter table public.concepts add column if not exists derived_status text;
