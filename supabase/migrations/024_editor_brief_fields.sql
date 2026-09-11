-- Pieces carry what the editor needs: the base format code (F13, UGC…), the
-- beat sheet for videos and the failure mode. Tanda-level fields (concepto,
-- funnel, formato base, win condition) live in experiment.hypothesis_doc.
alter table public.experiment_variant
  add column if not exists format_code text,
  add column if not exists beats jsonb,
  add column if not exists failure_mode text;
