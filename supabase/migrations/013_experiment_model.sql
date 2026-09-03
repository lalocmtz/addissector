-- =============================================================================
-- 013 · The model that closes the loop.
--
--   member              real people with a role (owners stop being a string)
--   hook                its own table (was research_notes.kind = 'hook')
--   experiment          what we are trying to find out: variable + control +
--                       success criteria declared BEFORE results
--   experiment_variant  the ads to produce (replaces planned_ads), pinned by meta_ad_id
--   ad_dimension        ad ↔ dimension ↔ value, with confidence — the bridge that
--                       makes every transversal axis measurable without migrations
--   meta_ads            gains persona/angle/concept assignment + confidence
--   learnings           gains FKs to what it explains + the ad_ids that back it
--   angles              mechanism semantics fixed: psychology ≠ product mechanism
--   brands              Brand DNA (claims, competitors, positioning, restrictions)
--
-- Nothing is dropped. planned_ads (0 rows) is copied and archived.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- member
-- ---------------------------------------------------------------------------
create table public.member (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,   -- workspace owner
  brand_id    uuid references public.brands(id) on delete cascade,          -- null = every brand of the workspace
  name        text not null,
  email       text,
  role        text not null check (role in ('strategist','designer','editor','media_buyer','ai','other')),
  is_ai       boolean not null default false,
  auth_user_id uuid references auth.users(id) on delete set null,          -- when the member has a login
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index member_user_idx on public.member (user_id);
alter table public.member enable row level security;
create policy member_own on public.member for all using (auth.uid() = user_id);

-- Seed: the workspace owner as strategist (name from the profile) and the AI.
insert into public.member (user_id, name, email, role, auth_user_id)
select p.id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)), p.email, 'strategist', p.id
from public.profiles p;
insert into public.member (user_id, name, role, is_ai)
select p.id, 'AI', 'ai', true from public.profiles p;

-- ---------------------------------------------------------------------------
-- hook
-- ---------------------------------------------------------------------------
create table public.hook (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  brand_id    uuid not null references public.brands(id) on delete cascade,
  title       text not null,
  body        text,
  hook_type   text,                       -- visual | text_overlay | spoken | pattern_interrupt | question | claim | social_proof | other
  status      text not null default 'idea' check (status in ('idea','testing','validated','retired')),
  source      text not null default 'manual',   -- manual | ia | research | classifier
  evidence    text,
  ad_ids      text[] not null default '{}',     -- Meta ad ids that used this hook
  legacy_note_id uuid,                          -- research_notes.id it came from
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index hook_brand_idx on public.hook (brand_id);
alter table public.hook enable row level security;
create policy hook_own on public.hook for all using (auth.uid() = user_id);

insert into public.hook (user_id, brand_id, title, body, status, source, evidence, legacy_note_id, created_at)
select user_id, brand_id, title, body,
       case status when 'funciona' then 'validated' when 'probando' then 'testing' when 'descartado' then 'retired' else 'idea' end,
       coalesce(source, 'manual'), evidence, id, created_at
from public.research_notes where kind = 'hook';
delete from public.research_notes where kind = 'hook';

-- ---------------------------------------------------------------------------
-- experiment
-- ---------------------------------------------------------------------------
create table public.experiment (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  brand_id         uuid not null references public.brands(id) on delete cascade,
  number           integer not null,
  code             text not null,                     -- EXP-012
  name             text not null,
  hypothesis       text,                              -- "I believe [persona] responds to [message] because [reason]"
  prior_evidence   jsonb not null default '[]',       -- [{ad_id, ad_name, spend, roas, hook_rate, note}]
  variable         text not null check (variable in ('hook','concept','angle','persona','format','creator','offer','cta','visual_style','proof_type')),
  persona_id       uuid references public.personas(id) on delete set null,
  angle_id         uuid references public.angles(id) on delete set null,
  concept_id       uuid references public.concepts(id) on delete set null,
  control_ad_id    text,                              -- Meta ad id of the control
  control_note     text,
  success_criteria jsonb not null default '{}',       -- {min_spend, roas_min, hook_rate_min, hold_rate_min, cpa_max, window_days}
  owner_id         uuid references public.member(id) on delete set null,
  status           text not null default 'draft' check (status in ('draft','planned','producing','live','evaluating','closed','archived')),
  result           jsonb,                             -- {verdict: 'validated'|'refuted'|'inconclusive', metrics: {...}, control: {...}, closed_at}
  learning_id      uuid,                              -- FK added after learnings columns below
  brief            jsonb,                             -- generated brief document
  planned_for      date,
  started_at       timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (brand_id, number)
);
create index experiment_brand_status_idx on public.experiment (brand_id, status);
alter table public.experiment enable row level security;
create policy experiment_own on public.experiment for all using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- experiment_variant (replaces planned_ads)
-- ---------------------------------------------------------------------------
create table public.experiment_variant (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  brand_id       uuid not null references public.brands(id) on delete cascade,
  experiment_id  uuid references public.experiment(id) on delete cascade,
  concept_id     uuid references public.concepts(id) on delete set null,
  ad_name        text not null,                      -- generated: SG_028_YAPROBE_A
  variant        text,                               -- A, B, C…
  hook_id        uuid references public.hook(id) on delete set null,
  hook           text,                               -- free-text hook when not yet in the bank
  format         text,
  script         text,
  visual_notes   text,
  status         text not null default 'planned' check (status in ('planned','producing','ready','uploaded','live','evaluated','killed')),
  owner_id       uuid references public.member(id) on delete set null,
  meta_ad_id     text,                               -- pinned once detected in Meta; the name stops mattering
  matched_at     timestamptz,
  uploaded_at    date,
  result         jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (brand_id, ad_name)
);
create index experiment_variant_meta_idx on public.experiment_variant (brand_id, meta_ad_id);
create index experiment_variant_exp_idx on public.experiment_variant (experiment_id);
alter table public.experiment_variant enable row level security;
create policy experiment_variant_own on public.experiment_variant for all using (auth.uid() = user_id);

insert into public.experiment_variant (user_id, brand_id, concept_id, ad_name, variant, hook, format, script, visual_notes, status, meta_ad_id, matched_at, uploaded_at, created_at, updated_at)
select user_id, brand_id, concept_id, ad_name, variant, hook, format, script, visual_notes,
       case status when 'subido' then 'uploaded' when 'con_datos' then 'live' when 'evaluado' then 'evaluated' when 'produccion' then 'producing' when 'listo' then 'ready' else 'planned' end,
       meta_ad_id, matched_at, uploaded_at, created_at, coalesce(updated_at, created_at)
from public.planned_ads;
alter table public.planned_ads set schema archive;

-- ---------------------------------------------------------------------------
-- ad_dimension — the bridge
-- ---------------------------------------------------------------------------
create table public.ad_dimension (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  brand_id     uuid not null references public.brands(id) on delete cascade,
  ad_id        text,                                 -- Meta ad id
  creative_id  uuid references public.creatives(id) on delete cascade,   -- when the creative has no Meta id (yet)
  dimension    text not null check (dimension in (
                 'hook','format','narrative_structure','creator','proof_type','offer','cta',
                 'visual_style','duration_bucket','pacing','awareness_level','emotional_driver')),
  value        text not null,
  confidence   numeric,                              -- 0..1
  source       text not null default 'classifier',   -- classifier | manual
  version      text,                                 -- classifier version
  hook_id      uuid references public.hook(id) on delete set null,       -- when dimension = hook and it maps to the bank
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ad_id is not null or creative_id is not null)
);
create unique index ad_dimension_ad_key on public.ad_dimension (brand_id, ad_id, dimension) where ad_id is not null;
create unique index ad_dimension_creative_key on public.ad_dimension (brand_id, creative_id, dimension) where ad_id is null;
create index ad_dimension_lookup_idx on public.ad_dimension (brand_id, dimension, value);
alter table public.ad_dimension enable row level security;
create policy ad_dimension_own on public.ad_dimension for all using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- meta_ads: taxonomy assignment (backbone levels 1–3) with confidence
-- ---------------------------------------------------------------------------
alter table public.meta_ads
  add column persona_id uuid references public.personas(id) on delete set null,
  add column angle_id   uuid references public.angles(id) on delete set null,
  add column concept_id uuid references public.concepts(id) on delete set null,
  add column taxonomy_confidence numeric,
  add column taxonomy_source text,          -- classifier | manual | experiment
  add column taxonomy_version text,
  add column classified_at timestamptz;
create index meta_ads_angle_idx on public.meta_ads (brand_id, angle_id);

-- ---------------------------------------------------------------------------
-- learnings: attach to what they explain + the ads that back them
-- ---------------------------------------------------------------------------
alter table public.learnings
  add column persona_id      uuid references public.personas(id) on delete set null,
  add column angle_id        uuid references public.angles(id) on delete set null,
  add column concept_id      uuid references public.concepts(id) on delete set null,
  add column hook_id         uuid references public.hook(id) on delete set null,
  add column experiment_id   uuid references public.experiment(id) on delete set null,
  add column dimension       text,
  add column dimension_value text,
  add column ad_ids          text[] not null default '{}',
  add column status          text not null default 'candidate' check (status in ('candidate','confirmed','expired','rejected')),
  add column linked_at       timestamptz,
  add column suspect         boolean not null default false,
  add column suspect_reason  text;
alter table public.experiment add constraint experiment_learning_fkey foreign key (learning_id) references public.learnings(id) on delete set null;

-- Learnings whose evidence cites a hook rate computed with the wrong definition
-- (video plays / impressions, ~80–95%) are flagged: their numbers are not to be trusted.
update public.learnings
set suspect = true,
    suspect_reason = 'evidence cites a hook rate computed as video plays / impressions (pre-Fase A definition)'
where (evidence ~* 'hook( rate)?[^0-9]{0,12}([6-9][0-9]|100)(\.[0-9]+)?%' or text ~* 'hook( rate)?[^0-9]{0,12}([6-9][0-9]|100)(\.[0-9]+)?%');

-- Resolve source_ad (free text) to Meta ad ids where the name is unambiguous.
with names as (
  select brand_id, name, min(ad_id) as ad_id from public.meta_ads group by brand_id, name having count(distinct ad_id) = 1
)
update public.learnings l
set ad_ids = array[n.ad_id]
from names n
where n.brand_id = l.brand_id and n.name = l.source_ad and l.ad_ids = '{}';

-- ---------------------------------------------------------------------------
-- angles: mechanism = why the PRODUCT solves the pain; psychology = why it converts
-- ---------------------------------------------------------------------------
alter table public.angles rename column mechanism to psychology;
alter table public.angles add column mechanism text;      -- product mechanism (the kojic acid), filled by the classifier / human
alter table public.angles add column desire text;
alter table public.angles add column derived_status text; -- rollup-derived (Phase D); never set by an LLM
comment on column public.angles.psychology is 'Psychological reason the angle converts (was: mechanism). Lives in the analysis, not the taxonomy.';
comment on column public.angles.mechanism is 'Why the product resolves the pain (ingredient, feature, process).';

-- ---------------------------------------------------------------------------
-- concepts: link to experiments, owner as member
-- ---------------------------------------------------------------------------
alter table public.concepts add column owner_id uuid references public.member(id) on delete set null;
alter table public.concepts add column origin_ad_id text;     -- meta ad id that spawned the concept (origin = 'ganador')

-- ---------------------------------------------------------------------------
-- brands: Brand DNA
-- ---------------------------------------------------------------------------
alter table public.brands add column dna jsonb not null default '{}';
comment on column public.brands.dna is '{claims:[], competitors:[], positioning:"", restrictions:[], voice:"", proof_points:[]}';

-- ---------------------------------------------------------------------------
-- creatives: pin the Meta id by unambiguous name where still missing
-- ---------------------------------------------------------------------------
with names as (
  select brand_id, name, min(ad_id) as ad_id from public.meta_ads group by brand_id, name having count(distinct ad_id) = 1
)
update public.creatives c
set meta_ad_id = n.ad_id
from names n
where c.meta_ad_id is null and c.brand_id = n.brand_id
  and lower(regexp_replace(coalesce(c.ad_name, c.name), '\.(mp4|mov|webm|m4v|png|jpe?g)$', '', 'i')) = lower(regexp_replace(n.name, '\.(mp4|mov|webm|m4v|png|jpe?g)$', '', 'i'));
