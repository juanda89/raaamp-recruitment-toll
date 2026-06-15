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
