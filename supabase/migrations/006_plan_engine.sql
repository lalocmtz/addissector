-- =============================================================================
-- AdDNA v4 — Motor de Planificación
-- Persona → Ángulo → Concepto → Anuncio planeado → (se cierra con meta_daily)
--
-- La pieza que faltaba: un objeto entre el ángulo (abstracto) y el anuncio
-- (granular). El concepto es la unidad que se briefea y la unidad que se aprende.
-- El puente con Meta es planned_ads.ad_name = meta_daily.ad_name.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PERSONAS (avatares)
-- ---------------------------------------------------------------------------
create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  name text not null,                 -- "Mujer 30-40 con manchas por depilación"
  description text,                   -- quién es, qué vive el día que ve el anuncio
  pains text,                         -- dolores en palabras textuales del cliente
  desires text,                       -- lo que realmente quiere (no el producto)
  objections text,                    -- lo que la detiene
  awareness_stage text,               -- inconsciente|problema|solucion|producto|total
  evidence text,                      -- de dónde salió: DM, reseña, llamada
  status text not null default 'activa',  -- activa | pausada | descartada
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists personas_brand_idx on public.personas (brand_id, created_at desc);

-- ---------------------------------------------------------------------------
-- ÁNGULOS (razón de compra — vive meses, genera N conceptos)
-- ---------------------------------------------------------------------------
create table if not exists public.angles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  code text not null,                 -- MAYÚSCULAS sin espacios: YAPROBE, ROCE
  name text not null,
  persona_id uuid references public.personas(id) on delete set null,
  pain text,
  mechanism text,                     -- por qué NUESTRO producto lo resuelve mejor
  objection text,
  awareness_stage text,
  funnel_stage text default 'tofu',   -- tofu | mofu | bofu
  status text not null default 'sin_probar', -- sin_probar|probando|ganador|descansando|muerto
  priority text default 'media',      -- alta | media | baja
  evidence text,
  learnings text,                     -- qué se comprobó con datos reales
  source text default 'manual',       -- manual | ia | research | ganador
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (brand_id, code)
);
create index if not exists angles_brand_idx on public.angles (brand_id, status);

-- ---------------------------------------------------------------------------
-- CONCEPTOS (la unidad que se briefea y se aprende)
-- ---------------------------------------------------------------------------
create table if not exists public.concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  angle_id uuid references public.angles(id) on delete set null,
  persona_id uuid references public.personas(id) on delete set null,
  number int not null,                -- correlativo por marca (28)
  code text not null,                 -- SG_028_YAPROBE (generado)
  name text not null,                 -- "Duelo de productos"
  narrative_format text,              -- duelo | testimonio | listicle | demo | reseña
  hypothesis text,                    -- "Creo que X responde a Y porque Z. Espero…"
  offer text,
  status text not null default 'idea', -- idea|brief|produccion|listo|subido|evaluado
  origin text not null default 'manual', -- manual|ganador|research|ia
  origin_ad_name text,                -- de qué anuncio ganador nació
  brief text,                         -- el brief completo en markdown
  do_not_change text,                 -- lo que NO se toca del original
  owner text,                         -- diseñador | editor | ia | eduardo
  target_assets int default 3,
  planned_for date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (brand_id, number)
);
create index if not exists concepts_brand_idx on public.concepts (brand_id, status);
create index if not exists concepts_angle_idx on public.concepts (angle_id);

-- ---------------------------------------------------------------------------
-- ANUNCIOS PLANEADOS — el puente con Meta
-- planned_ads.ad_name debe ser IDÉNTICO al nombre en Meta Ads Manager.
-- Ese string es lo único que conecta la planificación con los resultados.
-- ---------------------------------------------------------------------------
create table if not exists public.planned_ads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade,
  concept_id uuid references public.concepts(id) on delete cascade,
  ad_name text not null,              -- SG_028_YAPROBE_C
  variant text,                       -- A | B | C
  format text default 'video',        -- video | imagen | carrusel
  hook text,                          -- los primeros 2 segundos, literal
  script text,                        -- qué dice
  visual_notes text,                  -- qué se ve
  status text not null default 'planeado', -- planeado|produccion|listo|subido|con_datos
  owner text,
  uploaded_at date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (brand_id, ad_name)
);
create index if not exists planned_ads_concept_idx on public.planned_ads (concept_id);
create index if not exists planned_ads_brand_idx on public.planned_ads (brand_id, status);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.personas enable row level security;
alter table public.angles enable row level security;
alter table public.concepts enable row level security;
alter table public.planned_ads enable row level security;

drop policy if exists "personas_own" on public.personas;
create policy "personas_own" on public.personas for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "angles_own" on public.angles;
create policy "angles_own" on public.angles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "concepts_own" on public.concepts;
create policy "concepts_own" on public.concepts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "planned_ads_own" on public.planned_ads;
create policy "planned_ads_own" on public.planned_ads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Hooks ganadores: banco alimentado desde los análisis (kind en research_notes)
-- Se reutiliza research_notes con kind = 'hook' | 'angulo' | 'externo'.
