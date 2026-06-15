// =====================================================================
//  whatsapp-webhook  (PRD 9.5 / 7) — Agente de WhatsApp CONVERSACIONAL.
//  GET  -> verificación del webhook (Meta/Kapso).
//  POST -> mensajes entrantes: registra la conversación y, si el candidato
//          está en cualificación, deja que un agente con IA conduzca la charla
//          (humano, breve, responde dudas y reencauza). Solo pide lo que falta;
//          inglés y expectativa salarial ya vienen del formulario.
// =====================================================================
import { serviceClient, getSettings, type Candidate } from "../_shared/supabase.ts";
import { sendWhatsappText } from "../_shared/whatsapp.ts";
import { qualifyAgent } from "../_shared/agent.ts";
import { afterQualification } from "../_shared/pipeline.ts";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "raaamp-verify";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // --- Verificación del webhook (estilo Meta) ---
  if (req.method === "GET") {
    if (
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === VERIFY_TOKEN
    ) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  try {
    const body = await req.json();
    const msg = extractInbound(body);
    if (!msg) return new Response("ok", { status: 200 }); // estados de entrega, etc.

    const sb = serviceClient();
    const candidate = await findByPhone(sb, msg.from);
    if (candidate) {
      await sb.from("rec_messages").insert({
        candidate_id: candidate.id, direccion: "entrante", canal: "whatsapp",
        cuerpo: msg.text, provider_id: msg.id, estado_envio: "recibido",
      });
      if (candidate.estado === "CUALIFICACION_WA") {
        await runAgent(sb, candidate);
      }
    }
    return new Response("ok", { status: 200 }); // responder 200 rápido
  } catch (e) {
    console.error(e);
    return new Response("ok", { status: 200 });
  }
});

// ---------------------------------------------------------------------
//  Agente conversacional de cualificación
// ---------------------------------------------------------------------
async function runAgent(sb: any, c: Candidate) {
  const settings = await getSettings(sb);

  // Historial de la conversación (para contexto).
  const { data: msgs } = await sb.from("rec_messages")
    .select("direccion, cuerpo").eq("candidate_id", c.id)
    .order("created_at", { ascending: true });
  const history = (msgs ?? []).map((m: any) => ({
    role: m.direccion === "saliente" ? "assistant" : "user",
    content: m.cuerpo as string,
  }));

  // Lo que YA sabemos del formulario (no se vuelve a preguntar).
  const extra = (c.cualificacion_extra ?? {}) as Record<string, unknown>;
  const known: Record<string, string> = {
    "Experiencia con automatización (n8n/Make/Python)": "sí",
    "Disponible tiempo completo y en exclusividad": "sí",
  };
  if (c.nivel_ingles) {
    const cefr = extra.nivel_ingles_cefr ? ` (${extra.nivel_ingles_cefr})` : "";
    known["Nivel de inglés"] = `${c.nivel_ingles}${cefr}`;
  }
  if (c.expectativa_salarial != null) {
    known["Expectativa salarial"] = `USD ${c.expectativa_salarial} al año`;
  }

  const turn = await qualifyAgent({
    nombre: c.nombre,
    cargo: settings.cargo,
    empresa: settings.empresa,
    known,
    yaTengo: {
      disponibilidad_inicio: Boolean(c.disponibilidad_inicio),
      ubicacion: Boolean(c.ubicacion),
    },
    history,
  });

  // Persistir lo que el agente haya recogido.
  const patch: Record<string, unknown> = {};
  if (turn.fields.disponibilidad_inicio) patch.disponibilidad_inicio = turn.fields.disponibilidad_inicio;
  if (turn.fields.ubicacion) patch.ubicacion = turn.fields.ubicacion;
  if (turn.fields.modalidad) patch.modalidad = turn.fields.modalidad;
  if (turn.fields.otros_procesos) {
    patch.cualificacion_extra = { ...extra, otros_procesos: turn.fields.otros_procesos };
  }
  if (Object.keys(patch).length) {
    await sb.from("rec_candidates").update(patch).eq("id", c.id);
  }

  // Enviar la respuesta del agente.
  if (turn.reply) {
    const r = await sendWhatsappText(c.whatsapp, turn.reply);
    await sb.from("rec_messages").insert({
      candidate_id: c.id, direccion: "saliente", canal: "whatsapp",
      cuerpo: turn.reply,
      provider_id: r.provider_id,
      estado_envio: r.ok ? (r.simulado ? "simulado" : "enviado") : "fallido",
      payload: r.error ? { error: r.error } : null,
    });
  }

  // Si terminó la cualificación, evaluar filtros y enviar la prueba técnica.
  if (turn.complete) {
    const { data: fresh } = await sb.from("rec_candidates").select("*").eq("id", c.id).single();
    if (fresh && fresh.estado === "CUALIFICACION_WA") {
      await afterQualification(sb, fresh, settings);
    }
  }
}

// ---------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------
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
