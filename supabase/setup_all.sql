-- =====================================================================
--  SETUP COMPLETO — Sistema de Reclutamiento Automatizado (raaamp)
--  Pega TODO este archivo en el SQL Editor de Supabase y ejecútalo.
--  Incluye: esquema (0001) + plantillas (0002) + banco test (0003)
--           + políticas de Storage (0005).
--  El cron (0004_cron.sql) se ejecuta APARTE, tras desplegar las
--  Edge Functions (necesita la service_role key y la URL de funciones).
-- =====================================================================


-- ########## migrations/0001_schema.sql ##########

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


-- ########## migrations/0002_seed_templates.sql ##########

-- =====================================================================
--  Seed: plantillas de mensajes (PRD 11 y 12)
--  Texto (copy) exacto del PRD v2.0. Tono WhatsApp: cercano y breve.
--  Variables entre llaves: el sistema las reemplaza al enviar.
-- =====================================================================

insert into public.rec_message_templates
  (codigo, evento, canal, destinatario, proposito, asunto, cuerpo)
values
-- ---- Candidato (WhatsApp) ----
('C01', 'Aplicación recibida', 'whatsapp', 'candidato',
 'Confirmación de recepción', null,
 'Hola {nombre}, soy el asistente de selección de {empresa}. Recibimos tu aplicación al cargo de {cargo}. Estamos revisando tu perfil y te escribiré por aquí con los siguientes pasos. No necesitas hacer nada por ahora.'),

('C02', 'Falla knockout', 'whatsapp', 'candidato',
 'Rechazo (motivo genérico)', null,
 'Hola {nombre}, gracias por tu interés en el cargo de {cargo}. En esta ocasión no continuarás en el proceso. Agradecemos el tiempo que dedicaste y te deseamos mucho éxito.'),

('C03', 'Aprueba screening de CV', 'whatsapp', 'candidato',
 'Inicio de cualificación (preguntas clave)', null,
 'Hola {nombre}, buenas noticias: tu perfil avanzó a la siguiente etapa. Antes de enviarte la prueba técnica, quiero confirmar algunos datos rápidos. ¿Te parece si te hago unas preguntas cortas?'),

('C04', 'Completa cualificación', 'whatsapp', 'candidato',
 'Envío de la prueba técnica + plazo', null,
 'Gracias {nombre}, con eso seguimos. Aquí está tu prueba técnica: {enlace_prueba}. Tienes plazo hasta el {fecha_limite}. Si tienes dudas sobre el enunciado, están dentro del enlace. ¡Éxitos!'),

('C05', 'Prueba técnica T-24h', 'whatsapp', 'candidato',
 'Recordatorio (24 horas)', null,
 'Hola {nombre}, te recuerdo que tu prueba técnica vence en 24 horas, el {fecha_limite}. Puedes completarla aquí: {enlace_prueba}.'),

('C06', 'Prueba técnica T-12h', 'whatsapp', 'candidato',
 'Recordatorio (12 horas)', null,
 'Hola {nombre}, últimas 12 horas para entregar tu prueba técnica (vence el {fecha_limite}). Enlace: {enlace_prueba}.'),

('C07', 'Prueba recibida', 'whatsapp', 'candidato',
 'Confirmación de entrega', null,
 '¡Recibido, {nombre}! Tenemos tu prueba técnica. La revisamos y te aviso por aquí con el resultado.'),

('C08', 'No entrega a tiempo', 'whatsapp', 'candidato',
 'Retiro del proceso', null,
 'Hola {nombre}, no recibimos tu prueba dentro del plazo, así que tu proceso queda cerrado por ahora. Si tu situación cambió, puedes volver a aplicar a futuras vacantes.'),

('C09', 'Prueba bajo umbral', 'whatsapp', 'candidato',
 'Rechazo', null,
 'Hola {nombre}, gracias por completar la prueba técnica. Tras revisarla, en esta ocasión no continuarás en el proceso. Valoramos tu tiempo y te animamos a aplicar a futuras oportunidades.'),

('C10', 'Aprueba prueba técnica', 'whatsapp', 'candidato',
 'Invitación al test de personalidad + plazo', null,
 '¡Buen trabajo en la prueba, {nombre}! Siguiente paso: un breve test (10 a 15 minutos). Complétalo aquí: {enlace_test} antes del {fecha_limite}.'),

('C11', 'Test T-24h', 'whatsapp', 'candidato',
 'Recordatorio (24 horas)', null,
 'Hola {nombre}, te recuerdo que tu test pendiente vence en 24 horas, el {fecha_limite}. Enlace: {enlace_test}.'),

('C12', 'Test T-12h', 'whatsapp', 'candidato',
 'Recordatorio (12 horas)', null,
 'Hola {nombre}, últimas 12 horas para completar tu test (vence el {fecha_limite}). Enlace: {enlace_test}.'),

('C13', 'Test recibido', 'whatsapp', 'candidato',
 'Confirmación', null,
 '¡Listo, {nombre}! Registramos tu test. Estamos consolidando tu evaluación y te aviso por aquí con el siguiente paso.'),

('C14', 'Puntaje total bajo umbral', 'whatsapp', 'candidato',
 'Rechazo', null,
 'Hola {nombre}, gracias por completar todo el proceso. Tras evaluar tu candidatura en conjunto, en esta ocasión no avanzaremos. Apreciamos mucho tu interés y nos gustaría tenerte en cuenta a futuro.'),

('C15', 'Pasa a finalista', 'whatsapp', 'candidato',
 'Invitación a entrevista + enlace de agenda', null,
 '¡Felicitaciones, {nombre}! Pasaste a la entrevista final con el responsable de contratación. Agenda el horario que mejor te quede aquí: {enlace_agenda}.'),

('C16', 'Cita agendada', 'whatsapp_email', 'candidato',
 'Confirmación + archivo de calendario', 'Tu entrevista con {empresa} quedó agendada',
 'Listo {nombre}, tu entrevista quedó agendada para el {fecha_hora_entrevista}. Te conectarás en {enlace_videollamada}. Si necesitas reagendar, usa el mismo enlace: {enlace_agenda}.'),

('C17', 'Entrevista T-24h', 'whatsapp', 'candidato',
 'Recordatorio (24 horas)', null,
 'Hola {nombre}, te recuerdo tu entrevista mañana, {fecha_hora_entrevista}. Enlace: {enlace_videollamada}.'),

('C18', 'Entrevista T-12h', 'whatsapp', 'candidato',
 'Recordatorio (12 horas)', null,
 'Hola {nombre}, tu entrevista es hoy, {fecha_hora_entrevista}. Enlace: {enlace_videollamada}. ¡Nos vemos!'),

('C19', 'Decisión positiva', 'whatsapp_email', 'candidato',
 'Oferta', 'Oferta para unirte a {empresa} como {cargo}',
 '{nombre}, ¡tenemos una oferta para ti! Nos encantaría que te unas a {empresa} como {cargo}. Te enviaré los detalles también por correo. ¿Tienes un momento para conversarlos?'),

('C20', 'Decisión negativa', 'whatsapp', 'candidato',
 'Rechazo post-entrevista', null,
 'Hola {nombre}, gracias por tu tiempo en la entrevista. Fue una decisión difícil y en esta ocasión avanzaremos con otro candidato. Nos quedó una impresión muy positiva de tu perfil y nos gustaría considerarte a futuro.'),

('C21', 'Acepta oferta', 'whatsapp_email', 'candidato',
 'Bienvenida / onboarding', '¡Bienvenido(a) a {empresa}!',
 '¡Bienvenido(a) al equipo, {nombre}! Estamos felices de tenerte en {empresa} como {cargo}. Te envié por correo los primeros pasos de tu onboarding. Cualquier duda, por aquí estoy.'),

-- ---- Responsable (Email) ----
('I01', 'Candidato requiere revisión', 'email', 'responsable',
 'Alerta (p. ej., salario fuera de rango)', '[Revisión] Candidato requiere atención — {cargo}',
 'El candidato {nombre} requiere revisión manual: {motivo} (por ejemplo, expectativa salarial fuera de rango o nivel de inglés por debajo del requerido). Revísalo en {enlace_tablero}.'),

('I02', 'Nuevo finalista', 'email', 'responsable',
 'Listo para agendar', 'Nuevo finalista listo para agendar — {cargo}',
 '{nombre} superó el umbral total y fue invitado a agendar su entrevista. Revisa su ficha en {enlace_tablero}.'),

('I03', 'Cierre de lote diario', 'email', 'responsable',
 'Estado del pipeline', 'Resumen diario del pipeline — {cargo}',
 'Estado del pipeline al cierre del día por etapa (nuevos, screening, cualificación, prueba técnica, test, finalistas y rechazados). Desglose completo en {enlace_tablero}.')

on conflict (codigo) do update set
  evento       = excluded.evento,
  canal        = excluded.canal,
  destinatario = excluded.destinatario,
  proposito    = excluded.proposito,
  asunto       = excluded.asunto,
  cuerpo       = excluded.cuerpo,
  updated_at   = now();


-- ########## migrations/0003_seed_personality.sql ##########

-- =====================================================================
--  Seed: banco de preguntas del test de personalidad (PLACEHOLDER)
--  Forced-choice tipo RHETI. 36 ítems (todos los pares de tipos),
--  cada tipo aparece 8 veces => banco balanceado.
--  IMPORTANTE (PRD 13): este banco es de ejemplo. Reemplazar por uno
--  con licencia de uso comercial o un cuestionario propio equivalente.
-- =====================================================================

insert into public.rec_personality_questions (id, orden, opcion_a, opcion_b, tipo_a, tipo_b) values
  (1, 1, 'Procuro hacer las cosas correctamente y mejorar lo que está mal.', 'Disfruto apoyar a los demás y que cuenten conmigo.', 1, 2),
  (2, 2, 'Me molesta la falta de rigor; busco el estándar correcto.', 'Me enfoco en lograr metas y destacar por mis resultados.', 1, 3),
  (3, 3, 'Prefiero un trabajo ordenado, preciso y bien hecho.', 'Valoro ser auténtico y expresar lo que siento.', 1, 4),
  (4, 4, 'Siento la responsabilidad de corregir los errores que veo.', 'Prefiero entender a fondo antes de actuar.', 1, 5),
  (5, 5, 'Procuro hacer las cosas correctamente y mejorar lo que está mal.', 'Me preparo para los problemas y valoro la confianza.', 1, 6),
  (6, 6, 'Me molesta la falta de rigor; busco el estándar correcto.', 'Busco experiencias nuevas y mantengo el ánimo arriba.', 1, 7),
  (7, 7, 'Prefiero un trabajo ordenado, preciso y bien hecho.', 'Tomo el control y defiendo lo que creo justo.', 1, 8),
  (8, 8, 'Siento la responsabilidad de corregir los errores que veo.', 'Busco armonía y evito conflictos innecesarios.', 1, 9),
  (9, 9, 'Me anticipo a lo que las personas necesitan.', 'Me motiva ser eficiente y alcanzar objetivos ambiciosos.', 2, 3),
  (10, 10, 'Me siento bien cuando soy útil para el equipo.', 'Busco que mi trabajo tenga un sello personal y con sentido.', 2, 4),
  (11, 11, 'Pongo las relaciones por delante de la tarea.', 'Me gusta investigar y dominar un tema por completo.', 2, 5),
  (12, 12, 'Disfruto apoyar a los demás y que cuenten conmigo.', 'Pienso en los riesgos antes de avanzar.', 2, 6),
  (13, 13, 'Me anticipo a lo que las personas necesitan.', 'Me entusiasman las posibilidades y los proyectos variados.', 2, 7),
  (14, 14, 'Me siento bien cuando soy útil para el equipo.', 'Voy directo al punto y asumo decisiones difíciles.', 2, 8),
  (15, 15, 'Pongo las relaciones por delante de la tarea.', 'Escucho todas las posturas antes de tomar partido.', 2, 9),
  (16, 16, 'Cuido cómo me perciben por mi desempeño.', 'Me atraen las ideas originales más que lo convencional.', 3, 4),
  (17, 17, 'Convierto los planes en logros concretos rápido.', 'Necesito espacio y datos para decidir con criterio.', 3, 5),
  (18, 18, 'Me enfoco en lograr metas y destacar por mis resultados.', 'Soy leal y comprometido con el equipo.', 3, 6),
  (19, 19, 'Me motiva ser eficiente y alcanzar objetivos ambiciosos.', 'Prefiero mantener las opciones abiertas.', 3, 7),
  (20, 20, 'Cuido cómo me perciben por mi desempeño.', 'Protejo a mi equipo y no rehúyo la confrontación.', 3, 8),
  (21, 21, 'Convierto los planes en logros concretos rápido.', 'Mantengo la calma y ayudo a que el grupo fluya.', 3, 9),
  (22, 22, 'Presto atención a los matices y las emociones.', 'Disfruto resolver problemas complejos de forma analítica.', 4, 5),
  (23, 23, 'Valoro ser auténtico y expresar lo que siento.', 'Busco claridad y seguridad antes de comprometerme.', 4, 6),
  (24, 24, 'Busco que mi trabajo tenga un sello personal y con sentido.', 'Aporto energía y optimismo al equipo.', 4, 7),
  (25, 25, 'Me atraen las ideas originales más que lo convencional.', 'Me siento cómodo liderando bajo presión.', 4, 8),
  (26, 26, 'Presto atención a los matices y las emociones.', 'Prefiero el acuerdo y la estabilidad.', 4, 9),
  (27, 27, 'Prefiero entender a fondo antes de actuar.', 'Me preparo para los problemas y valoro la confianza.', 5, 6),
  (28, 28, 'Me gusta investigar y dominar un tema por completo.', 'Busco experiencias nuevas y mantengo el ánimo arriba.', 5, 7),
  (29, 29, 'Necesito espacio y datos para decidir con criterio.', 'Tomo el control y defiendo lo que creo justo.', 5, 8),
  (30, 30, 'Disfruto resolver problemas complejos de forma analítica.', 'Busco armonía y evito conflictos innecesarios.', 5, 9),
  (31, 31, 'Pienso en los riesgos antes de avanzar.', 'Me entusiasman las posibilidades y los proyectos variados.', 6, 7),
  (32, 32, 'Soy leal y comprometido con el equipo.', 'Voy directo al punto y asumo decisiones difíciles.', 6, 8),
  (33, 33, 'Busco claridad y seguridad antes de comprometerme.', 'Escucho todas las posturas antes de tomar partido.', 6, 9),
  (34, 34, 'Prefiero mantener las opciones abiertas.', 'Protejo a mi equipo y no rehúyo la confrontación.', 7, 8),
  (35, 35, 'Aporto energía y optimismo al equipo.', 'Mantengo la calma y ayudo a que el grupo fluya.', 7, 9),
  (36, 36, 'Me siento cómodo liderando bajo presión.', 'Prefiero el acuerdo y la estabilidad.', 8, 9)
on conflict (id) do update set
  orden = excluded.orden, opcion_a = excluded.opcion_a,
  opcion_b = excluded.opcion_b, tipo_a = excluded.tipo_a, tipo_b = excluded.tipo_b;


-- ########## migrations/0005_storage_policies.sql ##########

-- =====================================================================
--  Políticas de Storage para los buckets privados de reclutamiento.
--  El responsable (rol authenticated) puede leer CVs y entregas desde la UI;
--  la escritura la hacen las Edge Functions con service_role (ignora RLS).
-- =====================================================================

drop policy if exists rec_cvs_read on storage.objects;
create policy rec_cvs_read on storage.objects
  for select to authenticated
  using (bucket_id in ('rec-cvs', 'rec-submissions'));

