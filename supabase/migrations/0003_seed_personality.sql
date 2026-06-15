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
