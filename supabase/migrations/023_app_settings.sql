-- 023 — app_settings: per-user key/value (first use: the Gemini API key that
-- powers the fast server-side analysis engine of /meta/barrido).
--
-- One row per (user, key). The value is never echoed back whole by any API:
-- /api/meta/account only reports whether it exists and its last 4 chars.

create table if not exists public.app_settings (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,
  value      text,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_own on public.app_settings;
create policy app_settings_own on public.app_settings for all using (auth.uid() = user_id);

comment on table public.app_settings is 'Per-user settings (e.g. gemini_api_key). Read/written only from server routes.';
