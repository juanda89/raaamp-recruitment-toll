// =====================================================================
//  Motor de automatización (PRD 6 y 9.4): transiciones de estado, umbrales,
//  programación de recordatorios y disparo de comunicaciones.
//
//  Las etapas y reglas siguen el PRD §5, §6.2 y §8.1. No hay corte porcentual:
//  avanza todo candidato que supere los umbrales configurables.
// =====================================================================
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Candidate, Settings } from "./supabase.ts";
import { notify } from "./notify.ts";

const INGLES_ORDEN: Record<string, number> = { basico: 1, intermedio: 2, avanzado: 3 };

async function reload(sb: SupabaseClient, id: string): Promise<Candidate> {
  const { data, error } = await sb.from("rec_candidates").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Candidate;
}

/** Actualiza el candidato y devuelve la versión recargada (con triggers aplicados). */
async function update(
  sb: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<Candidate> {
  const { error } = await sb.from("rec_candidates").update(patch).eq("id", id);
  if (error) throw error;
  return reload(sb, id);
}

function addHours(h: number): string {
  return new Date(Date.now() + h * 3600_000).toISOString();
}

/** Programa los recordatorios (24h/12h por defecto) antes de un vencimiento. */
async function scheduleReminders(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
  motivo: "prueba" | "test" | "entrevista",
  venceAt: string,
  codigos: string[], // p.ej. ["C05","C06"] alineados con offsets [24,12]
): Promise<void> {
  const offsets = settings.recordatorio_offsets_h ?? [24, 12];
  const vence = new Date(venceAt).getTime();
  const rows = offsets.map((h, i) => ({
    candidate_id: candidate.id,
    template_codigo: codigos[i] ?? codigos[codigos.length - 1],
    motivo,
    programado_at: new Date(vence - h * 3600_000).toISOString(),
  })).filter((r) => new Date(r.programado_at).getTime() > Date.now());
  if (rows.length) await sb.from("rec_reminders").insert(rows);
}

async function cancelReminders(sb: SupabaseClient, candidateId: string, motivo: string) {
  await sb.from("rec_reminders")
    .update({ cancelado: true })
    .eq("candidate_id", candidateId).eq("motivo", motivo).is("enviado_at", null);
}

async function makeToken(
  sb: SupabaseClient,
  candidateId: string,
  proposito: "prueba" | "test",
  venceAt: string,
): Promise<string> {
  const { data, error } = await sb.from("rec_access_tokens")
    .insert({ candidate_id: candidateId, proposito, expira_at: venceAt })
    .select("token").single();
  if (error) throw error;
  return data.token as string;
}

function publicUrl(path: string, token: string): string {
  const base = Deno.env.get("REC_PUBLIC_BASE_URL") ?? "https://raaamp.co";
  return `${base}${path}?token=${token}`;
}

// ---------------------------------------------------------------------
//  Rechazo / retiro genérico (PRD 11.1: motivo genérico al candidato)
// ---------------------------------------------------------------------
export async function rechazar(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
  etapa: string,
  motivoInterno: string,
  codigoMsg: string | null,
  estado: "RECHAZADO" | "RETIRADO" = "RECHAZADO",
): Promise<Candidate> {
  const c = await update(sb, candidate.id, {
    estado,
    rechazo_etapa: etapa,
    motivo_rechazo: motivoInterno,
  });
  await cancelReminders(sb, candidate.id, "prueba");
  await cancelReminders(sb, candidate.id, "test");
  await cancelReminders(sb, candidate.id, "entrevista");
  if (codigoMsg) await notify(sb, c, settings, codigoMsg, { motivo: "" });
  return c;
}

// ---------------------------------------------------------------------
//  Etapa 1 -> 2 : aplicación recibida -> screening de CV
// ---------------------------------------------------------------------
export async function onApplied(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
): Promise<Candidate> {
  // Knockout (PRD 5.1 / 6.2): requisitos mínimos del formulario.
  if (candidate.knockout_passed === false) {
    return rechazar(sb, candidate, settings, "knockout", "No cumple requisitos mínimos", "C02");
  }
  await notify(sb, candidate, settings, "C01"); // confirmación de recepción
  return update(sb, candidate.id, { estado: "SCREENING_CV" });
}

// ---------------------------------------------------------------------
//  Etapa 2 -> 3 : resultado del screening de CV
// ---------------------------------------------------------------------
export async function afterCvScreening(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
): Promise<Candidate> {
  const score = candidate.score_cv ?? 0;
  if (score < settings.umbral_cv) {
    return rechazar(sb, candidate, settings, "screening_cv",
      `score_cv ${score} < umbral ${settings.umbral_cv}`, "C02");
  }
  // Avanza a cualificación por WhatsApp e inicia la conversación (C03).
  const c = await update(sb, candidate.id, { estado: "CUALIFICACION_WA" });
  await notify(sb, c, settings, "C03");
  return c;
}

// ---------------------------------------------------------------------
//  Etapa 3 : evaluación de la cualificación (filtros suaves -> revisión)
//  PRD 5.3 / 6.2 / 7: fuera de parámetros NO descarta; marca revisión.
// ---------------------------------------------------------------------
export async function afterQualification(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
  notifyWhatsapp = true,
): Promise<Candidate> {
  const motivos: string[] = [];

  const sal = candidate.expectativa_salarial;
  if (sal != null) {
    if (settings.salario_max != null && sal > settings.salario_max) {
      motivos.push("expectativa salarial por encima del rango");
    }
    if (settings.salario_min != null && sal < settings.salario_min) {
      motivos.push("expectativa salarial por debajo del rango");
    }
  }
  const ing = candidate.nivel_ingles;
  if (ing && INGLES_ORDEN[ing] < INGLES_ORDEN[settings.nivel_ingles_min]) {
    motivos.push("nivel de inglés por debajo del requerido");
  }

  if (motivos.length > 0) {
    const motivo = motivos.join("; ");
    const c = await update(sb, candidate.id, {
      flag_revision: true,
      motivo_revision: motivo,
    });
    await notify(sb, c, settings, "I01", { motivo }); // alerta al responsable
    return c; // se mantiene en CUALIFICACION_WA hasta que el responsable decida
  }

  return sendPruebaTecnica(sb, candidate, settings, notifyWhatsapp);
}

// ---------------------------------------------------------------------
//  Envío de la prueba técnica (C04) + token + recordatorios
// ---------------------------------------------------------------------
export async function sendPruebaTecnica(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
  notifyWhatsapp = true,
): Promise<Candidate> {
  const venceAt = addHours(settings.plazo_prueba_horas);
  const token = await makeToken(sb, candidate.id, "prueba", venceAt);
  const c = await update(sb, candidate.id, {
    estado: "PRUEBA_TECNICA",
    flag_revision: false,
    motivo_revision: null,
    prueba_enviada_at: new Date().toISOString(),
    prueba_vence_at: venceAt,
  });
  const vars = { enlace_prueba: publicUrl("/prueba", token), fecha_limite: fmt(venceAt) };
  await notify(sb, c, settings, "E_PRUEBA", vars);          // la prueba va por CORREO
  if (notifyWhatsapp) await notify(sb, c, settings, "C04", vars); // WhatsApp solo la menciona
  await scheduleReminders(sb, c, settings, "prueba", venceAt, ["C05", "C06"]);
  return c;
}

/** Reenvía por correo la prueba técnica (correo equivocado / no llegó). */
export async function resendPruebaEmail(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
): Promise<string> {
  let token: string;
  let venceAt = candidate.prueba_vence_at ?? addHours(settings.plazo_prueba_horas);
  const { data } = await sb.from("rec_access_tokens")
    .select("token, expira_at").eq("candidate_id", candidate.id).eq("proposito", "prueba")
    .gt("expira_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1);
  if (data?.[0]) {
    token = data[0].token as string;
    venceAt = data[0].expira_at as string;
  } else {
    venceAt = addHours(settings.plazo_prueba_horas);
    token = await makeToken(sb, candidate.id, "prueba", venceAt);
    await update(sb, candidate.id, { prueba_vence_at: venceAt });
  }
  await notify(sb, candidate, settings, "E_PRUEBA", {
    enlace_prueba: publicUrl("/prueba", token),
    fecha_limite: fmt(venceAt),
  });
  return `Prueba reenviada al correo ${candidate.email ?? "(sin correo)"}.`;
}

// ---------------------------------------------------------------------
//  Etapa 4 : resultado de la prueba técnica
// ---------------------------------------------------------------------
export async function afterPruebaEntregada(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
): Promise<Candidate> {
  await cancelReminders(sb, candidate.id, "prueba");
  const score = candidate.score_prueba ?? 0;
  if (score < settings.umbral_prueba) {
    return rechazar(sb, candidate, settings, "prueba_tecnica",
      `score_prueba ${score} < umbral ${settings.umbral_prueba}`, "C09");
  }
  // Avanza al test de personalidad (C10) + token + recordatorios.
  const venceAt = addHours(settings.plazo_test_horas);
  const token = await makeToken(sb, candidate.id, "test", venceAt);
  const c = await update(sb, candidate.id, {
    estado: "TEST_PERSONALIDAD",
    test_enviado_at: new Date().toISOString(),
    test_vence_at: venceAt,
  });
  await notify(sb, c, settings, "C10", {
    enlace_test: publicUrl("/test", token),
    fecha_limite: fmt(venceAt),
  });
  await scheduleReminders(sb, c, settings, "test", venceAt, ["C11", "C12"]);
  return c;
}

// ---------------------------------------------------------------------
//  Etapa 5 : test completado -> evaluación total -> finalista o rechazo
// ---------------------------------------------------------------------
export async function afterTestPersonalidad(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
): Promise<Candidate> {
  await cancelReminders(sb, candidate.id, "test");
  // score_total ya fue recalculado por el trigger al guardar score_personalidad.
  const total = candidate.score_total ?? 0;
  if (total < settings.umbral_total) {
    return rechazar(sb, candidate, settings, "puntaje_total",
      `score_total ${total} < umbral ${settings.umbral_total}`, "C14");
  }
  // Finalista (PRD 5.6): invita a agendar (C15) y alerta al responsable (I02).
  const c = await update(sb, candidate.id, { estado: "FINALISTA" });
  await notify(sb, c, settings, "C15", { enlace_agenda: settings.enlace_agenda ?? "" });
  await notify(sb, c, settings, "I02");
  return c;
}

// ---------------------------------------------------------------------
//  Entrevista agendada (PRD 5.6) — disparado por el webhook de agenda
// ---------------------------------------------------------------------
export async function onEntrevistaAgendada(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
  inicioISO: string,
  enlaceVideollamada: string,
): Promise<Candidate> {
  const c = await update(sb, candidate.id, {
    estado: "ENTREVISTA_FINAL",
    entrevista_agendada_at: new Date().toISOString(),
    entrevista_inicio_at: inicioISO,
    enlace_videollamada: enlaceVideollamada,
  });
  await notify(sb, c, settings, "C16");
  await scheduleReminders(sb, c, settings, "entrevista", inicioISO, ["C17", "C18"]);
  return c;
}

// ---------------------------------------------------------------------
//  Decisión final (PRD 5.7) — humana, desde la UI del responsable
// ---------------------------------------------------------------------
export async function decisionFinal(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
  decision: "contratado" | "rechazado",
): Promise<Candidate> {
  await cancelReminders(sb, candidate.id, "entrevista");
  if (decision === "rechazado") {
    return rechazar(sb, candidate, settings, "entrevista_final", "Decisión negativa", "C20");
  }
  const c = await update(sb, candidate.id, { estado: "CONTRATADO" });
  await notify(sb, c, settings, "C19"); // oferta
  return c;
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      dateStyle: "long", timeStyle: "short", timeZone: "America/Bogota",
    });
  } catch { return iso; }
}
