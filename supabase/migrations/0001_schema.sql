-- =====================================================================
--  Sistema de Reclutamiento Automatizado — Esquema de base de datos
--  Cargo objetivo: AI and Automation Specialist
--  PRD v2.0 — secciones 6 (scoring), 8 (pipeline), 10 (modelo de datos),
--  11 (comunicaciones) y 12 (settings).
--
--  Ejecutar en el SQL Editor del proyecto Supabase.
--  Prefijo `rec_` para no colisionar con las tablas `kanban_*` existentes.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos (enums)
-- ---------------------------------------------------------------------

-- Estado interno del candidato en la máquina de estados (PRD 8.1).
-- El rechazo es un único estado; la etapa donde ocurrió queda en `rechazo_etapa`.
do $$ begin
  create type rec_status as enum (
    'APLICADO',          -- Nuevos: lead recién ingresado por el formulario
    'SCREENING_CV',      -- En evaluación de hoja de vida por IA
    'CUALIFICACION_WA',  -- El agente conversa y recoge respuestas clave
    'PRUEBA_TECNICA',    -- Reto enviado, en espera de entrega y evaluación
    'TEST_PERSONALIDAD', -- Test enviado; se calcula el puntaje de personalidad
    'FINALISTA',         -- Superó el umbral total; invitado a agendar
    'ENTREVISTA_FINAL',  -- Cita confirmada con el responsable
    'CONTRATADO',        -- Decisión positiva; dispara onboarding
    'RECHAZADO',         -- Descartado en cualquier etapa (ver motivo_rechazo)
    'RETIRADO'           -- Se retiró / no entregó a tiempo
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type rec_modalidad as enum ('remoto', 'hibrido', 'presencial');
exception when duplicate_object then null; end $$;

do $$ begin
  create type rec_nivel_ingles as enum ('basico', 'intermedio', 'avanzado');
exception when duplicate_object then null; end $$;

-- Canal de una plantilla / comunicación.
do $$ begin
  create type rec_canal as enum ('whatsapp', 'email', 'whatsapp_email');
exception when duplicate_object then null; end $$;

do $$ begin
  create type rec_destinatario as enum ('candidato', 'responsable');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Configuración global (singleton) — PRD 6 y 12
-- ---------------------------------------------------------------------
create table if not exists public.rec_settings (
  id                      boolean primary key default true,           -- siempre una sola fila (id = true)
  empresa                 text    not null default 'raaamp',
  cargo                   text    not null default 'AI and Automation Specialist',

  -- Pesos del puntaje total (PRD 6.1). Deben sumar 1.0.
  peso_cv                 numeric not null default 0.25,
  peso_prueba             numeric not null default 0.45,
  peso_personalidad       numeric not null default 0.30,

  -- Umbrales por etapa (PRD 6.2). Escala 0-100.
  umbral_cv               numeric not null default 60,
  umbral_prueba           numeric not null default 60,
  umbral_total            numeric not null default 65,

  -- Parámetros de cualificación (PRD 7) — filtros suaves -> marcan revisión.
  salario_min             numeric,
  salario_max             numeric,
  nivel_ingles_min        rec_nivel_ingles not null default 'intermedio',

  -- Test de personalidad (PRD 6.3) — tipos objetivo del Eneagrama y sus pesos.
  tipos_objetivo          jsonb   not null default '{"1": 1, "3": 1, "5": 1}'::jsonb,

  -- Plazos (horas) para cada entregable y offsets de recordatorio (PRD 11).
  plazo_prueba_horas      integer not null default 72,
  plazo_test_horas        integer not null default 48,
  recordatorio_offsets_h  integer[] not null default array[24, 12],

  -- Enlaces / contenido configurable.
  enlace_agenda           text,    -- herramienta de agendamiento (entrevista final)
  enlace_tablero          text default 'https://app.raaamp.co',
  enunciado_prueba_url    text,    -- enunciado y rúbrica de la prueba técnica

  updated_at              timestamptz not null default now(),
  constraint rec_settings_pesos_suman_uno
    check (abs((peso_cv + peso_prueba + peso_personalidad) - 1.0) < 0.001)
);

-- ---------------------------------------------------------------------
-- Plantillas de mensajes — PRD 11 y 12
-- ---------------------------------------------------------------------
create table if not exists public.rec_message_templates (
  codigo        text primary key,           -- C01..C21, I01..I03
  evento        text not null,              -- evento disparador (descripción)
  canal         rec_canal not null,
  destinatario  rec_destinatario not null,
  proposito     text not null,
  asunto        text,                       -- solo para email
  cuerpo        text not null,              -- copy con variables {nombre}, {cargo}, ...
  activo        boolean not null default true,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Candidato — PRD 10
-- ---------------------------------------------------------------------
create table if not exists public.rec_candidates (
  id                    uuid primary key default gen_random_uuid(),

  -- Captación / contacto
  fuente                text,                       -- Indeed, LinkedIn, etc. (UTM source)
  utm                   jsonb default '{}'::jsonb,  -- parámetros de seguimiento completos
  nombre                text not null,
  email                 text,
  whatsapp              text not null,              -- E.164
  whatsapp_optin        boolean not null default false,
  fecha_aplicacion      timestamptz not null default now(),
  cv_url                text,                       -- ubicación del archivo en Storage

  -- Knockout (requisitos mínimos del formulario)
  knockout_respuestas   jsonb default '{}'::jsonb,
  knockout_passed       boolean,

  -- Screening de CV (IA)
  score_cv              numeric,                    -- 0-100
  cv_resumen            text,                       -- fortalezas y banderas (salida IA)
  cv_evaluacion         jsonb,                      -- salida estructurada de la IA (auditoría)

  -- Cualificación por WhatsApp (PRD 7)
  expectativa_salarial  numeric,
  disponibilidad_inicio text,                       -- fecha posible / preaviso
  modalidad             rec_modalidad,
  nivel_ingles          rec_nivel_ingles,
  ubicacion             text,                       -- ciudad y zona horaria
  experiencia_automatizacion text,
  cualificacion_extra   jsonb default '{}'::jsonb,  -- otras respuestas (otros procesos, jornada...)

  -- Prueba técnica
  prueba_enviada_at     timestamptz,
  prueba_vence_at       timestamptz,
  prueba_entregada_at   timestamptz,
  prueba_entrega_url    text,
  score_prueba          numeric,                    -- 0-100
  prueba_evaluacion     jsonb,

  -- Test de personalidad (Eneagrama)
  test_enviado_at       timestamptz,
  test_vence_at         timestamptz,
  test_completado_at    timestamptz,
  enn_ranking           jsonb,                      -- afinidad por los 9 tipos {"1":..,"9":..}
  score_personalidad    numeric,                    -- 0-100

  -- Puntaje total ponderado (recalculado por trigger desde rec_settings)
  score_total           numeric,

  -- Estado / pipeline
  estado                rec_status not null default 'APLICADO',
  flag_revision         boolean not null default false,  -- requiere atención del responsable
  motivo_revision       text,
  rechazo_etapa         text,                            -- etapa donde se rechazó/retiró
  motivo_rechazo        text,                            -- causa interna (auditoría)

  -- Entrevista final
  entrevista_agendada_at timestamptz,
  entrevista_inicio_at   timestamptz,
  enlace_videollamada    text,

  estado_changed_at     timestamptz not null default now(),  -- para "tiempo en etapa"
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists rec_candidates_estado_idx on public.rec_candidates(estado);
create index if not exists rec_candidates_revision_idx on public.rec_candidates(flag_revision) where flag_revision;
create index if not exists rec_candidates_whatsapp_idx on public.rec_candidates(whatsapp);
create index if not exists rec_candidates_total_idx on public.rec_candidates(score_total desc);

-- ---------------------------------------------------------------------
-- Bitácora de estados / auditoría — PRD 10 (historial_estados) y 13
-- ---------------------------------------------------------------------
create table if not exists public.rec_candidate_events (
  id            bigint generated always as identity primary key,
  candidate_id  uuid not null references public.rec_candidates(id) on delete cascade,
  tipo          text not null,            -- 'transicion' | 'scoring' | 'comunicacion' | 'nota' | 'revision'
  estado_anterior rec_status,
  estado_nuevo  rec_status,
  detalle       jsonb default '{}'::jsonb,-- insumo de la decisión (puntajes, salida IA, etc.)
  actor         text not null default 'sistema',  -- 'sistema' | email del responsable
  created_at    timestamptz not null default now()
);
create index if not exists rec_events_candidate_idx on public.rec_candidate_events(candidate_id, created_at desc);

-- ---------------------------------------------------------------------
-- Conversación / comunicaciones de WhatsApp — PRD 8.2 (ver conversación)
-- ---------------------------------------------------------------------
create table if not exists public.rec_messages (
  id            bigint generated always as identity primary key,
  candidate_id  uuid not null references public.rec_candidates(id) on delete cascade,
  direccion     text not null check (direccion in ('saliente', 'entrante')),
  canal         rec_canal not null default 'whatsapp',
  template_codigo text references public.rec_message_templates(codigo),
  cuerpo        text not null,            -- texto renderizado / recibido
  provider_id   text,                     -- id del mensaje en el BSP
  estado_envio  text default 'pendiente', -- pendiente | enviado | entregado | leido | fallido
  payload       jsonb,                    -- payload crudo del proveedor (auditoría)
  created_at    timestamptz not null default now()
);
create index if not exists rec_messages_candidate_idx on public.rec_messages(candidate_id, created_at);

-- ---------------------------------------------------------------------
-- Recordatorios programados (24h / 12h) — PRD 9.4 y 11
-- ---------------------------------------------------------------------
create table if not exists public.rec_reminders (
  id            bigint generated always as identity primary key,
  candidate_id  uuid not null references public.rec_candidates(id) on delete cascade,
  template_codigo text not null references public.rec_message_templates(codigo),
  motivo        text not null,            -- 'prueba' | 'test' | 'entrevista'
  programado_at timestamptz not null,     -- cuándo debe enviarse
  enviado_at    timestamptz,              -- null = pendiente
  cancelado     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists rec_reminders_pendientes_idx
  on public.rec_reminders(programado_at)
  where enviado_at is null and not cancelado;

-- ---------------------------------------------------------------------
-- Banco de preguntas del test de personalidad — PRD 9.6
--  Cuestionario forced-choice (RHETI-like). El banco DEBE reemplazarse
--  por uno con licencia comercial o uno propio equivalente (PRD 13).
-- ---------------------------------------------------------------------
create table if not exists public.rec_personality_questions (
  id          integer primary key,        -- número de ítem
  orden       integer not null,
  opcion_a    text not null,
  opcion_b    text not null,
  -- A qué tipo del Eneagrama suma cada opción (1..9).
  tipo_a      smallint not null check (tipo_a between 1 and 9),
  tipo_b      smallint not null check (tipo_b between 1 and 9),
  activo      boolean not null default true
);

-- Respuestas del candidato al test.
create table if not exists public.rec_personality_responses (
  id            bigint generated always as identity primary key,
  candidate_id  uuid not null references public.rec_candidates(id) on delete cascade,
  question_id   integer not null references public.rec_personality_questions(id),
  eleccion      char(1) not null check (eleccion in ('A', 'B')),
  created_at    timestamptz not null default now(),
  unique (candidate_id, question_id)
);

-- ---------------------------------------------------------------------
-- Tokens de acceso del candidato (prueba técnica y test, sin login) — PRD 9
-- ---------------------------------------------------------------------
create table if not exists public.rec_access_tokens (
  token         uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references public.rec_candidates(id) on delete cascade,
  proposito     text not null check (proposito in ('prueba', 'test')),
  expira_at     timestamptz not null,
  usado_at      timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists rec_tokens_candidate_idx on public.rec_access_tokens(candidate_id);

-- =====================================================================
--  Triggers
-- =====================================================================

-- updated_at genérico
create or replace function public.rec_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_rec_candidates_updated on public.rec_candidates;
create trigger trg_rec_candidates_updated
  before update on public.rec_candidates
  for each row execute function public.rec_touch_updated_at();

drop trigger if exists trg_rec_settings_updated on public.rec_settings;
create trigger trg_rec_settings_updated
  before update on public.rec_settings
  for each row execute function public.rec_touch_updated_at();

-- Marca de tiempo de cambio de estado (para "tiempo en etapa")
create or replace function public.rec_track_estado_change()
returns trigger language plpgsql as $$
begin
  if new.estado is distinct from old.estado then
    new.estado_changed_at = now();
    insert into public.rec_candidate_events
      (candidate_id, tipo, estado_anterior, estado_nuevo, detalle, actor)
    values
      (new.id, 'transicion', old.estado, new.estado,
       jsonb_build_object('motivo_rechazo', new.motivo_rechazo,
                          'rechazo_etapa', new.rechazo_etapa),
       coalesce(current_setting('rec.actor', true), 'sistema'));
  end if;
  return new;
end; $$;

drop trigger if exists trg_rec_estado_change on public.rec_candidates;
create trigger trg_rec_estado_change
  before update on public.rec_candidates
  for each row execute function public.rec_track_estado_change();

-- Recalcular score_total cuando cambia algún componente, usando los pesos de rec_settings.
-- score_total = peso_cv*score_cv + peso_prueba*score_prueba + peso_personalidad*score_personalidad
-- (PRD 6.1). Solo se calcula con los componentes disponibles; los faltantes cuentan como 0.
create or replace function public.rec_compute_total()
returns trigger language plpgsql as $$
declare s public.rec_settings%rowtype;
begin
  -- Sin ningún componente todavía: deja score_total en NULL (no 0).
  if new.score_cv is null and new.score_prueba is null and new.score_personalidad is null then
    new.score_total = null;
    return new;
  end if;

  select * into s from public.rec_settings where id = true;
  if not found then return new; end if;

  new.score_total = round(
      s.peso_cv          * coalesce(new.score_cv, 0)
    + s.peso_prueba      * coalesce(new.score_prueba, 0)
    + s.peso_personalidad* coalesce(new.score_personalidad, 0)
  );
  return new;
end; $$;

drop trigger if exists trg_rec_compute_total on public.rec_candidates;
create trigger trg_rec_compute_total
  before insert or update of score_cv, score_prueba, score_personalidad on public.rec_candidates
  for each row execute function public.rec_compute_total();

-- =====================================================================
--  Storage buckets
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('rec-cvs',         'rec-cvs',         false, 10485760),  -- 10 MB, privado
  ('rec-submissions', 'rec-submissions', false, 26214400)   -- 25 MB, privado
on conflict (id) do nothing;

-- =====================================================================
--  Row Level Security
--  Estrategia: los datos del candidato son privados.
--   - El rol `authenticated` (responsable) puede leer/escribir desde la UI.
--   - Todo lo que es candidate-facing (landing, test, webhook) pasa por
--     Edge Functions con la service_role key, que ignora RLS.
--   - `anon` NO tiene acceso a datos de candidatos.
-- =====================================================================
alter table public.rec_settings              enable row level security;
alter table public.rec_message_templates     enable row level security;
alter table public.rec_candidates            enable row level security;
alter table public.rec_candidate_events      enable row level security;
alter table public.rec_messages              enable row level security;
alter table public.rec_reminders             enable row level security;
alter table public.rec_personality_questions enable row level security;
alter table public.rec_personality_responses enable row level security;
alter table public.rec_access_tokens         enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'rec_settings','rec_message_templates','rec_candidates','rec_candidate_events',
    'rec_messages','rec_reminders','rec_personality_questions',
    'rec_personality_responses','rec_access_tokens'
  ] loop
    execute format('drop policy if exists %I_auth_all on public.%I;', t, t);
    execute format($p$
      create policy %I_auth_all on public.%I
        for all to authenticated using (true) with check (true);
    $p$, t, t);
  end loop;
end $$;

-- =====================================================================
--  Fila singleton de configuración
-- =====================================================================
insert into public.rec_settings (id) values (true)
on conflict (id) do nothing;
