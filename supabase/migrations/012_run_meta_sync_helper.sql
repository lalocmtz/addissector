-- =============================================================================
-- 012 · Helper to invoke the meta-sync edge function from SQL (backfills,
-- manual runs, the hourly cron). Uses the same anon JWT the cron job already
-- carries. Async: returns the pg_net request id; the response lands in
-- net._http_response.
--
--   select public.addissector_run_meta_sync('since=2026-03-01&until=2026-03-31');
--   select public.addissector_run_meta_sync('days=7&brand=<brand uuid>');
-- =============================================================================
create or replace function public.addissector_run_meta_sync(qs text)
returns bigint language sql security definer set search_path to 'public' as $$
  select net.http_post(
    url := 'https://bjnogzwwtpyetoyrjfwu.supabase.co/functions/v1/meta-sync?' || qs,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (regexp_match((select command from cron.job where jobname = 'meta-sync-hourly'), 'Bearer ([A-Za-z0-9._-]+)'))[1],
      'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 170000);
$$;
revoke all on function public.addissector_run_meta_sync(text) from public, anon, authenticated;
