-- =============================================================================
-- 009 · Archive the tables of the removed subsystems.
--
-- Rule: no DROP on a table with rows. These tables belong to features that were
-- deleted from the codebase (generation engine, Stripe/plans, the old
-- ads/ad_sets model) but they still hold rows, so they move to an `archive`
-- schema untouched instead of being dropped. Nothing in the app reads them.
--
--   ads (27) · ad_sets (7) · generations (13) · subscriptions (1) · usage_counters (2)
--
-- The auth trigger used to create a trial subscription on signup; it now only
-- creates the profile and the default brand.
-- =============================================================================

create schema if not exists archive;

alter table public.ads            set schema archive;
alter table public.ad_sets        set schema archive;
alter table public.generations    set schema archive;
alter table public.subscriptions  set schema archive;
alter table public.usage_counters set schema archive;

-- increment_usage wrote to usage_counters; nothing calls it anymore.
drop function if exists public.increment_usage(uuid, date);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- UGCLY shares this database but is another application: its users must not
  -- get addissector profiles or brands.
  if (new.raw_user_meta_data ->> 'app') = 'ugcly' then
    return new;
  end if;

  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  insert into public.brands (user_id, name)
  values (new.id, 'My brand');

  return new;
end;
$$;
