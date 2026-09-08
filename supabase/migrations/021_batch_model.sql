-- 021 — Three objects instead of seven: Angle → Batch → Piece.
--
-- The old model asked the strategist to fill Persona, Angle, Concept, Hook,
-- Experiment, Variant and Learning before a single ad could be made. Seven
-- levels; every published operator runs two or three. The result was 53
-- concepts with no offer, 60 "hooks" that were descriptions of hooks, 149
-- learnings none of which came from a test, and one experiment named PRUEBA
-- with zero variants. Meanwhile 97% of Feel Ink's spend was mapped to nothing.
--
-- This migration collapses the model WITHOUT moving a row:
--
--   ANGLE  — the strategy. Already carries persona_id and awareness_stage, so
--            persona stops being a level and becomes a field. angles is
--            untouched here.
--   BATCH  — the unit of work. This is the `experiment` table: one angle, ONE
--            declared variable, 4-8 pieces launched together, one verdict, one
--            learning. `name` is what used to be called the concept.
--   PIECE  — one ad. This is `experiment_variant`: a literal hook, a format, an
--            awareness stage, an owner, and a minted name.
--
-- The table names stay. Renaming them would break every route, every policy and
-- every foreign key for a vocabulary change, and vocabulary belongs in i18n.
--
-- What is genuinely new here:
--   · a four-state verdict per piece, so the mid-range creative that carries the
--     account floor stops being classified as a loser and killed;
--   · an archive reason, because a piece retired for frequency is a winner worth
--     relaunching and one retired for fatigue is done;
--   · a wall between what an agent OBSERVED and what a closed batch PROVED.

-- ---------------------------------------------------------------------------
-- BATCH (experiment)
-- ---------------------------------------------------------------------------
alter table experiment add column if not exists awareness text;
alter table experiment add column if not exists impression_cap integer not null default 1500;
alter table experiment add column if not exists closed_note text;

comment on table experiment is
  'BATCH. One angle, one declared variable, 4-8 pieces launched together into the lateral test campaign, one verdict, one learning. `name` is the concept.';
comment on column experiment.impression_cap is
  'Impressions at which the batch is turned off in CT so every piece is scored apples-to-apples.';
comment on column experiment.awareness is
  'Awareness stage the whole batch addresses. Feeds the minted ad name.';

-- ---------------------------------------------------------------------------
-- PIECE (experiment_variant)
-- ---------------------------------------------------------------------------
alter table experiment_variant add column if not exists awareness text;
alter table experiment_variant add column if not exists verdict text;
alter table experiment_variant add column if not exists verdict_at timestamptz;
alter table experiment_variant add column if not exists archived_reason text;

alter table experiment_variant drop constraint if exists experiment_variant_verdict_chk;
alter table experiment_variant add constraint experiment_variant_verdict_chk
  check (verdict is null or verdict in ('breakthrough', 'kpi_winner', 'spend_winner', 'loser'));

alter table experiment_variant drop constraint if exists experiment_variant_archived_reason_chk;
alter table experiment_variant add constraint experiment_variant_archived_reason_chk
  check (archived_reason is null or archived_reason in ('frequency', 'fatigue', 'offer_ended', 'never_delivered', 'other'));

comment on table experiment_variant is
  'PIECE. One ad. `hook` is the literal line that goes on screen, not a description of it. `ad_name` is minted by the platform and pasted into Meta unchanged.';
comment on column experiment_variant.verdict is
  'breakthrough: above target AND took the volume. kpi_winner: hits the economics, no volume yet. spend_winner: Meta gives it volume below target — the account floor, do not kill. loser: turned off before it could be judged.';
comment on column experiment_variant.archived_reason is
  'Why it stopped. frequency is relaunchable; fatigue is done. Without the reason an archive is a landfill.';

create index if not exists experiment_variant_verdict_idx
  on experiment_variant (brand_id, verdict) where verdict is not null;

-- ---------------------------------------------------------------------------
-- THE WALL: observations vs learnings
-- ---------------------------------------------------------------------------
-- An observation is what an agent noticed about one ad. It is raw material for
-- writing a brief and it is never evidence. A learning is what a closed batch
-- proved, with the pieces and the numbers behind it. Only a learning may change
-- a decision. Everything that exists today is an observation, because none of
-- it came from a test.
alter table learnings add column if not exists kind text not null default 'observation';
alter table learnings add column if not exists stale_metrics boolean not null default false;

alter table learnings drop constraint if exists learnings_kind_chk;
alter table learnings add constraint learnings_kind_chk
  check (kind in ('observation', 'learning'));

comment on column learnings.kind is
  'observation: an agent looked at an ad and wrote this down. learning: a closed batch proved it. Only learnings are evidence.';
comment on column learnings.stale_metrics is
  'true when the figures quoted in the text predate the meta-sync v6 conversion fix and are inflated roughly 3x.';

create index if not exists learnings_kind_idx on learnings (brand_id, kind, active);

-- ---------------------------------------------------------------------------
-- HOOK BANK: same wall, same reason
-- ---------------------------------------------------------------------------
-- A hook marked "validated" with zero spend behind it is a label, not a
-- measurement. `verified` is the honest field: it can only be set true by a
-- closed batch.
alter table hook add column if not exists verified boolean not null default false;
alter table hook add column if not exists literal boolean not null default false;

comment on column hook.verified is
  'Only a closed batch sets this. Distinct from status, which an agent could write.';
comment on column hook.literal is
  'true when `body` is the line as it appears on screen. false when it is a description OF a hook, which an editor cannot shoot.';
