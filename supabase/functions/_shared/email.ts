// Notificaciones por correo (PRD 9.8). Por defecto usa Resend (HTTP simple).
// Sin API key -> MODO SIMULADO.
const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("REC_EMAIL_FROM") ?? "Reclutamiento raaamp <no-reply@raaamp.co>";

export interface EmailResult { ok: boolean; simulado: boolean; error?: string }

export async function sendEmail(to: string, subject: string, html: string): Promise<EmailResult> {
  if (!RESEND_KEY) {
    console.log(`[EMAIL SIMULADO] -> ${to} | ${subject}`);
    return { ok: true, simulado: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!res.ok) return { ok: false, simulado: false, error: await res.text() };
    return { ok: true, simulado: false };
  } catch (e) {
    return { ok: false, simulado: false, error: String(e) };
  }
}

/** Correo del responsable de contratación (destinatario de alertas internas). */
export function responsableEmail(): string {
  return Deno.env.get("REC_RESPONSABLE_EMAIL") ?? "";
}
