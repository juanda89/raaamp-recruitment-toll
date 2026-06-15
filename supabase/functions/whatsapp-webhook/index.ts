// =====================================================================
//  whatsapp-webhook  (PRD 9.5 / 7) — Agente de WhatsApp.
//  GET  -> verificación del webhook (Meta Cloud API).
//  POST -> mensajes entrantes: registra la conversación y conduce el guion de
//          cualificación (preguntas clave de la sección 7), paso a paso.
//
//  Nota: es un agente GUIADO POR GUION (determinista). Puede sustituirse por
//  un agente LLM más conversacional reutilizando `qualify` para persistir.
// =====================================================================
import { serviceClient, getSettings, type Candidate } from "../_shared/supabase.ts";
import { sendWhatsappText } from "../_shared/whatsapp.ts";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "raaamp-verify";

// Guion de cualificación (PRD 7). Cada paso recoge un dato.
const PASOS: { campo: string; pregunta: string; parse: (t: string) => unknown }[] = [
  { campo: "_interes", pregunta: "¿Quieres continuar en el proceso? (sí/no)", parse: parseSiNo },
  { campo: "expectativa_salarial", pregunta: "¿Cuál es tu expectativa salarial mensual (en números)?", parse: parseNum },
  { campo: "disponibilidad_inicio", pregunta: "¿Cuál es tu disponibilidad / posible fecha de inicio (preaviso)?", parse: (t) => t.trim() },
  { campo: "modalidad", pregunta: "¿Modalidad preferida: remoto, híbrido o presencial?", parse: parseModalidad },
  { campo: "nivel_ingles", pregunta: "¿Tu nivel de inglés: básico, intermedio o avanzado?", parse: parseIngles },
  { campo: "ubicacion", pregunta: "¿En qué ciudad y zona horaria estás?", parse: (t) => t.trim() },
  { campo: "experiencia_automatizacion", pregunta: "Cuéntame brevemente tu experiencia con automatización (n8n, Make, Python).", parse: (t) => t.trim() },
];

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // --- Verificación del webhook (Meta) ---
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
        await driveQualification(sb, candidate, msg.text);
      }
    }
    return new Response("ok", { status: 200 }); // Meta requiere 200 rápido
  } catch (e) {
    console.error(e);
    return new Response("ok", { status: 200 });
  }
});

// ---------------------------------------------------------------------
//  Conversación de cualificación guiada por guion
// ---------------------------------------------------------------------
async function driveQualification(sb: any, c: Candidate, texto: string) {
  const extra = (c.cualificacion_extra ?? {}) as Record<string, unknown>;
  let step = Number(extra._wa_step ?? 0);

  // Guarda la respuesta del paso actual (si ya habíamos preguntado algo).
  if (step > 0 && step <= PASOS.length) {
    const paso = PASOS[step - 1];
    const valor = paso.parse(texto);
    extra[paso.campo] = valor;

    // Confirmación de interés negativa -> retiro.
    if (paso.campo === "_interes" && valor === false) {
      await sb.from("rec_candidates").update({
        estado: "RETIRADO", rechazo_etapa: "cualificacion",
        motivo_rechazo: "El candidato declinó continuar", cualificacion_extra: extra,
      }).eq("id", c.id);
      await sendWhatsappText(c.whatsapp, "Entendido, gracias por avisar. ¡Te deseamos mucho éxito!");
      return;
    }
  }

  // ¿Quedan preguntas? Pregunta la siguiente.
  if (step < PASOS.length) {
    extra._wa_step = step + 1;
    await sb.from("rec_candidates").update({ cualificacion_extra: extra }).eq("id", c.id);
    await sendWhatsappText(c.whatsapp, PASOS[step].pregunta);
    return;
  }

  // Terminó el guion: consolidar respuestas y evaluar (función qualify).
  await sb.from("rec_candidates").update({ cualificacion_extra: extra }).eq("id", c.id);
  const respuestas = {
    expectativa_salarial: extra.expectativa_salarial,
    disponibilidad_inicio: extra.disponibilidad_inicio,
    modalidad: extra.modalidad,
    nivel_ingles: extra.nivel_ingles,
    ubicacion: extra.ubicacion,
    experiencia_automatizacion: extra.experiencia_automatizacion,
    extra: { otros_procesos: extra.otros_procesos ?? null },
  };
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/qualify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ candidate_id: c.id, respuestas }),
  });
}

// ---------------------------------------------------------------------
//  Helpers de parsing / extracción
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

function parseSiNo(t: string): boolean {
  return /\b(si|sí|s|yes|claro|dale|ok)\b/i.test(t);
}
function parseNum(t: string): number | null {
  const n = Number(t.replace(/[^\d.]/g, ""));
  return isFinite(n) && n > 0 ? n : null;
}
function parseModalidad(t: string): string | null {
  const s = t.toLowerCase();
  if (s.includes("remot")) return "remoto";
  if (s.includes("híbr") || s.includes("hibr")) return "hibrido";
  if (s.includes("presen")) return "presencial";
  return null;
}
function parseIngles(t: string): string | null {
  const s = t.toLowerCase();
  if (s.includes("avanz") || s.includes("c1") || s.includes("c2")) return "avanzado";
  if (s.includes("inter") || s.includes("b1") || s.includes("b2")) return "intermedio";
  if (s.includes("bás") || s.includes("bas") || s.includes("a1") || s.includes("a2")) return "basico";
  return null;
}
