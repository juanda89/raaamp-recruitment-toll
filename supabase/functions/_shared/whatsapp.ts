// Envío por WhatsApp Business API (PRD 9.5).
// Implementación por defecto: WhatsApp Cloud API de Meta (un BSP común).
// Si no hay credenciales configuradas, opera en MODO SIMULADO: no envía pero
// devuelve ok para que el pipeline siga funcionando en desarrollo.
//
// ⚠️ Apéndice A: el alta del número y la APROBACIÓN DE PLANTILLAS por Meta es
// un proceso manual. En producción, los mensajes fuera de la ventana de 24h
// deben enviarse como `template` aprobado, no como texto libre.

export interface WaSendResult {
  ok: boolean;
  simulado: boolean;
  provider_id: string | null;
  error?: string;
}

const TOKEN = Deno.env.get("WHATSAPP_TOKEN");
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const API_VERSION = Deno.env.get("WHATSAPP_API_VERSION") ?? "v21.0";

export function whatsappConfigured(): boolean {
  return Boolean(TOKEN && PHONE_ID);
}

/** Envía un mensaje de texto libre (válido dentro de la ventana de 24h). */
export async function sendWhatsappText(to: string, body: string): Promise<WaSendResult> {
  if (!whatsappConfigured()) {
    console.log(`[WA SIMULADO] -> ${to}: ${body}`);
    return { ok: true, simulado: true, provider_id: null };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: normalize(to),
          type: "text",
          text: { body, preview_url: true },
        }),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, simulado: false, provider_id: null, error: JSON.stringify(data) };
    }
    return { ok: true, simulado: false, provider_id: data?.messages?.[0]?.id ?? null };
  } catch (e) {
    return { ok: false, simulado: false, provider_id: null, error: String(e) };
  }
}

/** Quita caracteres no numéricos (Meta espera el número sin '+'). */
function normalize(to: string): string {
  return to.replace(/[^\d]/g, "");
}
