// Envío por WhatsApp Business API (PRD 9.5).
// Soporta dos proveedores, autodetectados por variables de entorno:
//   - KAPSO  (recomendado aquí): proxy de la Graph API de Meta.
//        KAPSO_API_KEY + WHATSAPP_PHONE_NUMBER_ID
//        Base: https://api.kapso.ai/meta/whatsapp/<version>  · auth: X-API-Key
//   - META directo (Cloud API):
//        WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID
//        Base: https://graph.facebook.com/<version>  · auth: Bearer
// Sin credenciales -> MODO SIMULADO.
//
// Ambos usan el MISMO formato de mensaje (Meta), por eso el body es idéntico.

export interface WaSendResult {
  ok: boolean;
  simulado: boolean;
  provider_id: string | null;
  error?: string;
}

const KAPSO_KEY = Deno.env.get("KAPSO_API_KEY");
const META_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const VERSION = Deno.env.get("WHATSAPP_API_VERSION") ?? "v24.0";

type Provider = "kapso" | "meta" | null;
function provider(): Provider {
  if (KAPSO_KEY && PHONE_ID) return "kapso";
  if (META_TOKEN && PHONE_ID) return "meta";
  return null;
}

export function whatsappConfigured(): boolean {
  return provider() !== null;
}

/** Envía un mensaje de texto libre (válido dentro de la ventana de 24h). */
export async function sendWhatsappText(to: string, body: string): Promise<WaSendResult> {
  const p = provider();
  if (!p) {
    console.log(`[WA SIMULADO] -> ${to}: ${body}`);
    return { ok: true, simulado: true, provider_id: null };
  }

  const url = p === "kapso"
    ? `https://api.kapso.ai/meta/whatsapp/${VERSION}/${PHONE_ID}/messages`
    : `https://graph.facebook.com/${VERSION}/${PHONE_ID}/messages`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (p === "kapso") headers["X-API-Key"] = KAPSO_KEY!;
  else headers["Authorization"] = `Bearer ${META_TOKEN}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalize(to),
        type: "text",
        text: { body, preview_url: true },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, simulado: false, provider_id: null, error: JSON.stringify(data) };
    }
    return { ok: true, simulado: false, provider_id: data?.messages?.[0]?.id ?? null };
  } catch (e) {
    return { ok: false, simulado: false, provider_id: null, error: String(e) };
  }
}

/**
 * Envía un TEMPLATE aprobado por Meta (necesario para iniciar conversación o
 * fuera de la ventana de 24h). `params` son los valores posicionales {{1}}, {{2}}…
 */
export async function sendWhatsappTemplate(
  to: string, name: string, lang: "es" | "en", params: string[],
): Promise<WaSendResult> {
  const p = provider();
  if (!p) {
    console.log(`[WA TEMPLATE SIMULADO] -> ${to}: ${name}(${params.join(", ")})`);
    return { ok: true, simulado: true, provider_id: null };
  }
  const url = p === "kapso"
    ? `https://api.kapso.ai/meta/whatsapp/${VERSION}/${PHONE_ID}/messages`
    : `https://graph.facebook.com/${VERSION}/${PHONE_ID}/messages`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (p === "kapso") headers["X-API-Key"] = KAPSO_KEY!;
  else headers["Authorization"] = `Bearer ${META_TOKEN}`;

  const components = params.length
    ? [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }]
    : [];

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalize(to),
        type: "template",
        template: { name, language: { code: lang }, components },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, simulado: false, provider_id: null, error: JSON.stringify(data) };
    return { ok: true, simulado: false, provider_id: data?.messages?.[0]?.id ?? null };
  } catch (e) {
    return { ok: false, simulado: false, provider_id: null, error: String(e) };
  }
}

/** Quita caracteres no numéricos (Meta espera el número sin '+'). */
function normalize(to: string): string {
  return to.replace(/[^\d]/g, "");
}
