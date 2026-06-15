-- =====================================================================
--  Políticas de Storage para los buckets privados de reclutamiento.
--  El responsable (rol authenticated) puede leer CVs y entregas desde la UI;
--  la escritura la hacen las Edge Functions con service_role (ignora RLS).
-- =====================================================================

drop policy if exists rec_cvs_read on storage.objects;
create policy rec_cvs_read on storage.objects
  for select to authenticated
  using (bucket_id in ('rec-cvs', 'rec-submissions'));
