-- =====================================================================
--  Tareas programadas (PRD 9.4 / 11) con pg_cron + pg_net.
--  Invocan la Edge Function `reminders-cron`.
--
--  Requisitos:
--   1) Habilitar las extensiones pg_cron y pg_net (Dashboard > Database >
--      Extensions, o las sentencias de abajo).
--   2) Guardar la SERVICE_ROLE key y la URL del proyecto como settings de la
--      base de datos (se leen abajo). Ejecútalas UNA vez, reemplazando valores:
--
--      alter database postgres set app.settings.service_role_key = '<SERVICE_ROLE_KEY>';
--      alter database postgres set app.settings.functions_url     = 'https://<PROJECT-REF>.functions.supabase.co';
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper: invoca una Edge Function con la service_role key.
create or replace function public.rec_invoke_function(fn text, query text default '')
returns void language plpgsql security definer as $$
declare
  base text := current_setting('app.settings.functions_url', true);
  key  text := current_setting('app.settings.service_role_key', true);
begin
  if base is null or key is null then
    raise notice 'app.settings.functions_url / service_role_key no configurados';
    return;
  end if;
  perform net.http_post(
    url     := base || '/' || fn || query,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || key,
                 'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
end; $$;

-- Recordatorios + vencimientos: cada 15 minutos.
select cron.schedule(
  'rec-reminders',
  '*/15 * * * *',
  $$ select public.rec_invoke_function('reminders-cron'); $$
);

-- Resumen diario del pipeline (I03): 19:00 hora de Colombia (= 00:00 UTC).
select cron.schedule(
  'rec-digest',
  '0 0 * * *',
  $$ select public.rec_invoke_function('reminders-cron', '?task=digest'); $$
);

-- Para desprogramar:  select cron.unschedule('rec-reminders');
