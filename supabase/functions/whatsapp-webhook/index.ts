// =====================================================================
//  whatsapp-webhook  (PRD 9.5 / 7) — Agente de WhatsApp con HERRAMIENTAS.
//  GET  -> verificación del webhook (Meta/Kapso).
//  POST -> mensajes entrantes: registra la conversación y deja que un agente
//          con IA conduzca la charla como un humano y resuelva excepciones
//          (corregir correo, reenviar prueba, reprogramar, escalar, cualificar).
// =====================================================================
import { serviceClient, getSettings, type Candidate } from "../_shared/supabase.ts";
import { sendWhatsappText } from "../_shared/whatsapp.ts";
import { runConversation, type AgentHandlers, type ChatMsg } from "../_shared/agent.ts";
import { afterQualification, resendPruebaEmail } from "../_shared/pipeline.ts";
import { notify } from "../_shared/notify.ts";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "raaamp-verify";

// Etapas donde el agente conversa con el candidato.
const ACTIVE = new Set([
  "CUALIFICACION_WA", "PRUEBA_TECNICA", "TEST_PERSONALIDAD", "FINALISTA", "ENTREVISTA_FINAL",
]);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.get("hub.mode") === "subscribe" &&
        url.searchParams.get("hub.verify_token") === VERIFY_TOKEN) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  try {
    const body = await req.json();
    const msg = extractInbound(body);
    if (!msg) return new Response("ok", { status: 200 });

    const sb = serviceClient();
    const candidate = await findByPhone(sb, msg.from);
    if (candidate) {
      await sb.from("rec_messages").insert({
        candidate_id: candidate.id, direccion: "entrante", canal: "whatsapp",
        cuerpo: msg.text, provider_id: msg.id, estado_envio: "recibido",
      });
      if (ACTIVE.has(candidate.estado)) await runAgent(sb, candidate);
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response("ok", { status: 200 });
  }
});

async function runAgent(sb: any, c0: Candidate) {
  const settings = await getSettings(sb);

  // Historial de conversación.
  const { data: msgs } = await sb.from("rec_messages")
    .select("direccion, cuerpo").eq("candidate_id", c0.id).order("created_at", { ascending: true });
  const history: ChatMsg[] = (msgs ?? []).map((m: any) => ({
    role: m.direccion === "saliente" ? "assistant" : "user", content: m.cuerpo as string,
  }));

  // Datos ya conocidos (no re-preguntar).
  const extra = (c0.cualificacion_extra ?? {}) as Record<string, unknown>;
  const known: Record<string, string> = {
    "Experiencia con automatización (n8n/Make/Python)": "sí",
    "Disponible tiempo completo y en exclusividad": "sí",
  };
  if (c0.nivel_ingles) {
    known["Nivel de inglés"] = `${c0.nivel_ingles}${extra.nivel_ingles_cefr ? ` (${extra.nivel_ingles_cefr})` : ""}`;
  }
  if (c0.expectativa_salarial != null) known["Expectativa salarial"] = `USD ${c0.expectativa_salarial} al año`;
  if (c0.email) known["Correo"] = c0.email;

  const faltan: string[] = [];
  if (c0.estado === "CUALIFICACION_WA") {
    if (!c0.disponibilidad_inicio) faltan.push("su disponibilidad / posible fecha de inicio");
    if (!c0.ubicacion) faltan.push("su ciudad y zona horaria");
  }

  const reload = async (): Promise<Candidate> => {
    const { data } = await sb.from("rec_candidates").select("*").eq("id", c0.id).single();
    return data as Candidate;
  };

  const handlers: AgentHandlers = {
    async actualizar_correo({ email }) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? "")) return "El correo no parece válido, pídelo de nuevo.";
      await sb.from("rec_candidates").update({ email }).eq("id", c0.id);
      await sb.from("rec_candidate_events").insert({
        candidate_id: c0.id, tipo: "nota", actor: "candidato",
        detalle: { accion: "actualizar_correo", email },
      });
      return `Correo actualizado a ${email}.`;
    },
    async reenviar_prueba() {
      const c = await reload();
      if (c.estado !== "PRUEBA_TECNICA") return "Aún no corresponde la prueba en esta etapa.";
      if (!c.email) return "No hay correo registrado; pídelo primero y usa actualizar_correo.";
      return await resendPruebaEmail(sb, c, settings);
    },
    async compartir_agenda() {
      if (!settings.enlace_agenda) return "El enlace de agenda no está configurado todavía; escala a un humano.";
      return `Comparte este enlace para agendar/reprogramar: ${settings.enlace_agenda}`;
    },
    async registrar_cualificacion(a) {
      const patch: Record<string, unknown> = {};
      if (a.disponibilidad_inicio) patch.disponibilidad_inicio = a.disponibilidad_inicio;
      if (a.ubicacion) patch.ubicacion = a.ubicacion;
      if (a.modalidad) patch.modalidad = a.modalidad;
      if (Object.keys(patch).length) await sb.from("rec_candidates").update(patch).eq("id", c0.id);
      return "Datos de cualificación guardados.";
    },
    async completar_cualificacion() {
      const c = await reload();
      if (c.estado !== "CUALIFICACION_WA") return "La cualificación ya no está en curso.";
      if (!c.disponibilidad_inicio || !c.ubicacion) return "Aún falta disponibilidad o ubicación; pídelas antes de completar.";
      await afterQualification(sb, c, settings, /* notifyWhatsapp */ false);
      return "Cualificación completa. Prueba técnica enviada al correo del candidato.";
    },
    async escalar_humano({ motivo }) {
      const c = await reload();
      await sb.from("rec_candidates").update({ flag_revision: true, motivo_revision: motivo ?? "Solicitud del candidato" }).eq("id", c0.id);
      await notify(sb, c, settings, "I01", { motivo: motivo ?? "Solicitud del candidato" });
      return "Listo, avisé a una persona del equipo para que te ayude.";
    },
  };

  const reply = await runConversation(
    { nombre: c0.nombre, empresa: settings.empresa, cargo: settings.cargo,
      idioma: c0.idioma === "en" ? "en" : "es",
      estado: c0.estado, known, faltan, tieneAgenda: Boolean(settings.enlace_agenda) },
    history, handlers,
  );

  if (reply) {
    const r = await sendWhatsappText(c0.whatsapp, reply);
    await sb.from("rec_messages").insert({
      candidate_id: c0.id, direccion: "saliente", canal: "whatsapp", cuerpo: reply,
      provider_id: r.provider_id, estado_envio: r.ok ? (r.simulado ? "simulado" : "enviado") : "fallido",
      payload: r.error ? { error: r.error } : null,
    });
  }
}

function extractInbound(body: any): { from: string; text: string; id: string } | null {
  try {
    const m = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!m || m.type !== "text") return null;
    return { from: m.from, text: m.text?.body ?? "", id: m.id };
  } catch { return null; }
}

async function findByPhone(sb: any, phone: string): Promise<Candidate | null> {
  const digits = phone.replace(/[^\d]/g, "");
  const { data } = await sb.from("rec_candidates").select("*")
    .or(`whatsapp.eq.${phone},whatsapp.eq.+${digits},whatsapp.eq.${digits}`)
    .order("created_at", { ascending: false }).limit(1);
  return data?.[0] ?? null;
}
