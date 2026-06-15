// Orquesta el envío de una comunicación: renderiza la plantilla, la envía por
// el canal correcto (WhatsApp y/o email) y la registra en rec_messages
// (auditoría + "ver conversación de WhatsApp" del PRD 8.2).
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Candidate, Settings } from "./supabase.ts";
import { buildVars, render } from "./templates.ts";
import { sendWhatsappText, sendWhatsappTemplate } from "./whatsapp.ts";
import { sendEmail, responsableEmail } from "./email.ts";
import { WA_TEMPLATE_MAP, templatesEnabled } from "./wa_templates.ts";

/**
 * Envía la comunicación `codigo` al destinatario que indique la plantilla.
 * @param extra variables adicionales (enlace_prueba, fecha_limite, motivo, ...)
 */
export async function notify(
  sb: SupabaseClient,
  candidate: Candidate,
  settings: Settings,
  codigo: string,
  extra: Record<string, string | null | undefined> = {},
): Promise<void> {
  const vars = buildVars(candidate, settings, extra);
  const lang = (candidate.idioma === "en" ? "en" : "es") as "es" | "en";
  const msg = await render(sb, codigo, vars, lang);

  const wantsWa = msg.canal === "whatsapp" || msg.canal === "whatsapp_email";
  const wantsEmail = msg.canal === "email" || msg.canal === "whatsapp_email";

  // --- WhatsApp (al candidato) ---
  if (wantsWa && msg.destinatario === "candidato") {
    if (!candidate.whatsapp_optin) {
      console.warn(`Candidato ${candidate.id} sin opt-in de WhatsApp; se omite ${codigo}`);
    } else {
      // Fuera de la ventana de 24h (notificaciones del pipeline) se usa el
      // TEMPLATE aprobado por Meta; si los templates no están habilitados, texto libre.
      const tref = WA_TEMPLATE_MAP[codigo];
      const r = (templatesEnabled() && tref)
        ? await sendWhatsappTemplate(candidate.whatsapp, tref.name, lang,
            tref.params.map((k) => vars[k] ?? ""))
        : await sendWhatsappText(candidate.whatsapp, msg.cuerpo);
      await sb.from("rec_messages").insert({
        candidate_id: candidate.id,
        direccion: "saliente",
        canal: "whatsapp",
        template_codigo: codigo,
        cuerpo: msg.cuerpo,
        provider_id: r.provider_id,
        estado_envio: r.ok ? (r.simulado ? "simulado" : "enviado") : "fallido",
        payload: r.error ? { error: r.error } : null,
      });
    }
  }

  // --- Email ---
  if (wantsEmail) {
    const to = msg.destinatario === "responsable"
      ? responsableEmail()
      : (candidate.email ?? "");
    if (to) {
      const html = `<p>${msg.cuerpo.replace(/\n/g, "<br>")}</p>`;
      const r = await sendEmail(to, msg.asunto ?? settings.cargo, html);
      await sb.from("rec_messages").insert({
        candidate_id: candidate.id,
        direccion: "saliente",
        canal: "email",
        template_codigo: codigo,
        cuerpo: `${msg.asunto ?? ""}\n\n${msg.cuerpo}`,
        estado_envio: r.ok ? (r.simulado ? "simulado" : "enviado") : "fallido",
        payload: r.error ? { error: r.error } : null,
      });
    }
  }
}
