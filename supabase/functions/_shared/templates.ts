// Renderizado de plantillas de mensajes (PRD 12). Reemplaza {variables}.
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Candidate, Settings } from "./supabase.ts";

export interface RenderedMessage {
  codigo: string;
  canal: "whatsapp" | "email" | "whatsapp_email";
  destinatario: "candidato" | "responsable";
  asunto: string | null;
  cuerpo: string;
}

/** Construye el mapa de variables disponibles para un candidato (PRD 12.1). */
export function buildVars(
  c: Candidate,
  s: Settings,
  extra: Record<string, string | null | undefined> = {},
): Record<string, string> {
  const vars: Record<string, string | null | undefined> = {
    nombre: c.nombre,
    email: c.email,
    cargo: s.cargo,
    empresa: s.empresa,
    enlace_tablero: s.enlace_tablero ?? "",
    enlace_agenda: s.enlace_agenda ?? "",
    fecha_hora_entrevista: c.entrevista_inicio_at
      ? formatFecha(c.entrevista_inicio_at)
      : "",
    enlace_videollamada: c.enlace_videollamada ?? "",
    ...extra,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = v ?? "";
  return out;
}

export function applyVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** Carga una plantilla y la renderiza con las variables dadas. */
export async function render(
  sb: SupabaseClient,
  codigo: string,
  vars: Record<string, string>,
): Promise<RenderedMessage> {
  const { data, error } = await sb
    .from("rec_message_templates")
    .select("*")
    .eq("codigo", codigo)
    .eq("activo", true)
    .single();
  if (error || !data) throw new Error(`Plantilla ${codigo} no encontrada: ${error?.message}`);
  return {
    codigo,
    canal: data.canal,
    destinatario: data.destinatario,
    asunto: data.asunto ? applyVars(data.asunto, vars) : null,
    cuerpo: applyVars(data.cuerpo, vars),
  };
}

export function formatFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "America/Bogota",
    });
  } catch {
    return iso;
  }
}
