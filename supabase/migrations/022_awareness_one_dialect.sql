-- 022 — One dialect for awareness.
--
-- ad_dimension has been writing the canonical English values since the
-- classifier shipped (problem_aware, solution_aware, product_aware) while
-- angles.awareness_stage held free Spanish text, including one row that said
-- "consciente_del_problema / consciente_de_la_solución" — two stages in one
-- field. Two dialects for one concept is how a report quietly splits in half.
--
-- The stage is now an enum in code, Spanish is a locale, and the constraint
-- keeps it that way.

update angles set awareness_stage = case
  when awareness_stage ilike 'consciente_del_problema%'   then 'problem_aware'
  when awareness_stage ilike 'consciente_de_la_soluci%'   then 'solution_aware'
  when awareness_stage ilike 'consciente_del_producto%'   then 'product_aware'
  when awareness_stage ilike 'inconsciente%'              then 'unaware'
  when awareness_stage ilike 'totalmente_consciente%'     then 'most_aware'
  else awareness_stage
end
where awareness_stage is not null;

alter table angles drop constraint if exists angles_awareness_stage_chk;
alter table angles add constraint angles_awareness_stage_chk
  check (awareness_stage is null or awareness_stage in
    ('unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware'));

comment on column angles.awareness_stage is
  'Canonical English enum, same vocabulary as ad_dimension. Spanish is a locale, not a stored value.';
