-- =============================================================================
-- 015 · Idea inbox + experiment lifecycle columns (Phase C)
--
--   idea        the inbox: anything worth testing, from anyone (a person, the
--               AI, a chat, a Meta ad). An idea becomes an experiment when it
--               gets a variable and a control; until then it costs nothing.
--   experiment  gains close_reason and evaluated_at so auto-close is auditable.
--
-- Additive only. Nothing is dropped. ugcly_* untouched.
-- =============================================================================

create table public.idea (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  brand_id        uuid not null references public.brands(id) on delete cascade,
  text            text not null,
  rationale       text,                                   -- why it might work
  source          text not null default 'manual' check (source in ('manual','ai','chat','meta','research','coverage')),
  status          text not null default 'inbox' check (status in ('inbox','promoted','discarded')),
  variable        text check (variable in ('hook','concept','angle','persona','format','creator','offer','cta','visual_style','proof_type')),
  persona_id      uuid references public.personas(id) on delete set null,
  angle_id        uuid references public.angles(id) on delete set null,
  concept_id      uuid references public.concepts(id) on delete set null,
  hook_id         uuid references public.hook(id) on delete set null,
  dimension       text,
  dimension_value text,
  evidence        jsonb not null default '[]',            -- [{ad_id, ad_name, spend, roas, hook_rate, note}]
  experiment_id   uuid references public.experiment(id) on delete set null,
  owner_id        uuid references public.member(id) on delete set null,
  created_by      uuid references public.member(id) on delete set null,
  discarded_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idea_brand_status_idx on public.idea (brand_id, status);
alter table public.idea enable row level security;
create policy idea_own on public.idea for all using (auth.uid() = user_id);

alter table public.experiment
  add column if not exists close_reason text,             -- criteria_met | criteria_failed | manual | stale
  add column if not exists evaluated_at timestamptz,
  add column if not exists idea_id uuid references public.idea(id) on delete set null;

-- A variant can be claimed from an existing Meta ad: record where it came from.
alter table public.experiment_variant
  add column if not exists claimed_from text;             -- 'meta' when the ad existed before the experiment
