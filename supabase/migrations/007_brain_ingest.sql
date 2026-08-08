-- =============================================================================
-- AdDNA v5 — El cerebro se alimenta solo.
-- Cada anuncio ganador que se analiza deja rastro en los bancos del Cerebro
-- (personas, ángulos, hooks, pruebas efectivas). Esta migración añade lo mínimo
-- para saber QUÉ ya se ingirió y QUÉ lo escribió la plataforma en vez de Eduardo.
-- =============================================================================

-- Marca de agua: cuándo leyó el cerebro este análisis (null = pendiente).
alter table public.creatives add column if not exists ingested_at timestamptz;

-- Procedencia: 'manual' (lo escribió Eduardo) | 'ia' (lo extrajo la plataforma).
-- angles y research_notes ya tienen la columna source.
alter table public.learnings add column if not exists source text default 'manual';
alter table public.personas add column if not exists source text default 'manual';

-- De qué análisis salió el aprendizaje (para poder rastrearlo o borrarlo).
alter table public.learnings add column if not exists source_creative uuid references public.creatives(id) on delete set null;

-- research_notes no tenía dónde guardar la evidencia (el anuncio y sus números).
alter table public.research_notes add column if not exists evidence text;

create index if not exists creatives_ingested_idx on public.creatives (brand_id, ingested_at);
