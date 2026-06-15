# Sistema de Reclutamiento Automatizado — raaamp

Implementación del PRD v2.0 (*AI and Automation Specialist*). Automatiza el
embudo de extremo a extremo: captación → screening de CV con IA → cualificación
por WhatsApp → prueba técnica → test de personalidad (Eneagrama) → entrevista
final → contratación, con un tablero Kanban y scoring ponderado.

**Stack:** HTML estático (Vercel) + Supabase (Postgres, Storage, Auth, Edge
Functions en Deno/TS, pg_cron). Coincide con el patrón ya usado en `app.raaamp.co`.

> **Modo simulado:** sin las claves de servicios externos (WhatsApp, LLM, email)
> el sistema **no envía nada real** pero el pipeline avanza de punta a punta, así
> puedes probar todo el flujo antes de conectar los servicios del Apéndice A.

---

## Estructura

```
reclutamiento/
├─ web/                         Frontend estático (deploy en Vercel)
│  ├─ index.html                Landing + formulario + carga de CV  (/aplicar)
│  ├─ prueba.html               Entrega de la prueba técnica (token) (/prueba)
│  ├─ test.html                 Test de personalidad (token)         (/test)
│  ├─ candidates.html           Tablero del responsable (auth)       (/candidates)
│  └─ config.js                 URL + anon key de Supabase
├─ supabase/
│  ├─ migrations/               Esquema, seeds y cron (ejecutar en orden)
│  │  ├─ 0001_schema.sql        Tablas, enums, triggers (scoring, estado), RLS, buckets
│  │  ├─ 0002_seed_templates.sql  21 mensajes C01–C21 + 3 alertas I01–I03
│  │  ├─ 0003_seed_personality.sql  Banco placeholder del test (36 ítems)
│  │  ├─ 0004_cron.sql          pg_cron: recordatorios (15 min) + resumen diario
│  │  └─ 0005_storage_policies.sql  Lectura de CVs/entregas por el responsable
│  ├─ functions/                Edge Functions (Deno/TS)
│  │  ├─ _shared/               Utilidades: supabase, plantillas, whatsapp, email, llm, pipeline, personality
│  │  ├─ ingest-lead/           POST /api/leads (formulario)
│  │  ├─ cv-screening/          Screening de CV con LLM
│  │  ├─ qualify/               Evalúa la cualificación (filtros suaves)
│  │  ├─ whatsapp-webhook/      Agente de WhatsApp (guion de cualificación)
│  │  ├─ submit-prueba/         Entrega de la prueba técnica
│  │  ├─ evaluate-prueba/       Evaluación asistida de la prueba
│  │  ├─ submit-test/           Recibe el test y calcula personalidad
│  │  ├─ advance-stage/         Acciones del responsable (agendar, decidir, etc.)
│  │  └─ reminders-cron/        Recordatorios 24h/12h, vencimientos y digest
│  └─ config.toml               verify_jwt por función
├─ lib/rheti/                   Motor de personalidad (referencia + docs)
├─ .env.example                 Todas las variables/placeholders
└─ vercel.json                  cleanUrls + headers
```

---

## Puesta en marcha

### 1) Base de datos (Supabase SQL Editor)
Ejecuta **en orden** los archivos de `supabase/migrations/`. Crean tablas,
enums, triggers, RLS, buckets, los 21+3 mensajes y el banco de preguntas.

### 2) Usuario del responsable
En **Authentication → Users** crea el usuario (email + contraseña) que usará el
Kanban. Las políticas RLS dan acceso a los datos a cualquier usuario
`authenticated`. (Para varios roles, restringe por dominio o tabla de roles.)

### 3) Edge Functions
```bash
supabase link --project-ref lcqugobrchkenkawxlfj
supabase secrets set --env-file ./.env        # copia .env.example -> .env y rellénalo
supabase functions deploy                      # despliega todas
```
`config.toml` ya marca como públicas las funciones candidate-facing
(`ingest-lead`, `whatsapp-webhook`, `submit-prueba`, `submit-test`, `advance-stage`).

### 4) Tareas programadas
En `0004_cron.sql` guarda una sola vez la URL de funciones y la service_role key
como settings de la base, luego ejecuta el archivo. Programa recordatorios
(cada 15 min) y el resumen diario.

### 5) Frontend (Vercel)
Despliega la carpeta `web/` como proyecto Vercel (sin build). `cleanUrls` sirve
`/aplicar`, `/prueba`, `/test`, `/candidates`. Apunta `REC_PUBLIC_BASE_URL` al dominio
donde quede (p. ej. `https://raaamp.co` o `https://aplica.raaamp.co`). Edita la
landing en `web/config.js` si cambias de proyecto Supabase.

### 6) WhatsApp
En Meta (o tu BSP) configura el webhook hacia
`https://<PROJECT-REF>.functions.supabase.co/whatsapp-webhook` con el
`WHATSAPP_VERIFY_TOKEN`. Aprueba las plantillas de mensajes (proceso de Meta).

---

## Modelo de scoring (PRD §6)

```
score_total = 0.25·score_cv + 0.45·score_prueba + 0.30·score_personalidad
```

Pesos y umbrales son configurables en el panel **⚙ Configuración** del Kanban
(tabla `rec_settings`). No hay corte porcentual: avanza todo candidato que supere
los umbrales. `score_personalidad` pondera la afinidad hacia los tipos objetivo
del Eneagrama (por defecto {1, 3, 5}).

## Máquina de estados (PRD §8.1)

```
APLICADO ──knockout✓──▶ SCREENING_CV ──cv≥umbral──▶ CUALIFICACION_WA
   │knockout✗               │cv<umbral                 │  ├─fuera de rango─▶ (revisión)
   ▼                        ▼                           ▼  └─en rango──────▶ PRUEBA_TECNICA
 RECHAZADO               RECHAZADO                                              │prueba≥umbral
                                                                                ▼
ENTREVISTA_FINAL ◀─agenda─ FINALISTA ◀─total≥umbral─ TEST_PERSONALIDAD ◀───────┘
   │decisión                                              │total<umbral
   ├─contratado─▶ CONTRATADO                              ▼
   └─rechazado──▶ RECHAZADO                            RECHAZADO
```

---

## Apéndice A — Configuración manual (no automatizable)

| Tarea | Dónde se refleja aquí |
|---|---|
| Alta y verificación de WhatsApp Business API + plantillas (Meta) | `WHATSAPP_*`, webhook |
| Dominio `raaamp.co` y DNS | Vercel + `REC_PUBLIC_BASE_URL` / `REC_ALLOWED_ORIGINS` |
| API keys (LLM, email, BSP, hosting, DB) | `.env` (secrets) |
| Métodos de pago / facturación de servicios | Externo |
| Cuentas de empleador y pauta en Indeed / LinkedIn | UTM en la landing (`?utm_source=...`) |
| Documentos legales (habeas data, consentimientos) | Texto de consentimiento en `web/index.html` |
| Licencia del banco del test de personalidad | Reemplazar `0003_seed_personality.sql` (ver `lib/rheti/README.md`) |
| Contenido de negocio (enunciado/rúbrica, rango salarial, inglés) | `rec_settings` + rúbricas en `cv-screening`/`evaluate-prueba` |
| Calendario/correo corporativo (OAuth) | `enlace_agenda`, `RESEND_API_KEY` |
| Decisión final de contratación | Humana, en el Kanban |

## Cumplimiento (PRD §13)

- **Habeas data (Ley 1581):** consentimiento explícito en el formulario; opt-in de
  WhatsApp obligatorio (`whatsapp_optin`). Define retención/borrado según política.
- **Auditoría:** cada transición y scoring queda en `rec_candidate_events` con su
  insumo (puntajes y salida estructurada de la IA).
- **Seguridad:** RLS estricto (datos de candidatos solo para `authenticated`);
  buckets privados; la service_role nunca se expone al navegador.
- **Rechazos:** siempre con motivo genérico al candidato (nunca el puntaje).
