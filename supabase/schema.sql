-- =============================================================================
-- AdDissector — Esquema de Supabase (Etapa 1: memoria + biblioteca)
-- Córrelo en Supabase → SQL Editor → New query → Run.
-- =============================================================================

-- Tabla de creativos analizados
create table if not exists public.creatives (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  name         text not null default 'Creativo',
  type         text not null default 'video',      -- 'video' | 'image'
  preview_url  text,                                -- miniatura en storage
  duration     numeric,
  aspect_ratio text,
  transcript   text,
  analysis     jsonb not null,                      -- resultado completo del análisis
  meta_metrics jsonb,                               -- métricas de Meta (Etapa 4)
  product      text,                                -- denormalizado para la biblioteca
  video_type   text,
  hook_score   numeric
);

create index if not exists creatives_created_at_idx
  on public.creatives (created_at desc);

-- Bucket público para las miniaturas de vista previa
insert into storage.buckets (id, name, public)
values ('creative-previews', 'creative-previews', true)
on conflict (id) do nothing;

-- Nota: el acceso a la tabla es solo desde el servidor (service-role key),
-- por eso no se habilita RLS. La anon key nunca se usa en el cliente.
