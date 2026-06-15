// Mapeo de los códigos de mensaje (C01…) a los TEMPLATES de Meta aprobados,
// con el orden de sus variables posicionales {{1}}, {{2}}…
//
// Se usa cuando WHATSAPP_USE_TEMPLATES=true (mensajes business-initiated /
// fuera de la ventana de 24h). Las respuestas del agente dentro de la ventana
// siguen siendo texto libre.

export interface WaTemplateRef {
  name: string;       // nombre del template en Meta
  params: string[];   // claves de `vars` en orden {{1}},{{2}},…
}

export const WA_TEMPLATE_MAP: Record<string, WaTemplateRef> = {
  C01: { name: "aplicacion_recibida",     params: ["nombre", "empresa", "cargo"] },
  C02: { name: "rechazo_generico",        params: ["nombre", "cargo"] },
  C03: { name: "inicio_cualificacion",    params: ["nombre"] },
  C04: { name: "prueba_enviada",          params: ["nombre", "email", "fecha_limite"] },
  C05: { name: "recordatorio_prueba",     params: ["nombre", "fecha_limite", "enlace_prueba"] },
  C06: { name: "recordatorio_prueba",     params: ["nombre", "fecha_limite", "enlace_prueba"] },
  C07: { name: "confirmacion_recepcion",  params: ["nombre"] },
  C08: { name: "retiro_no_entrega",       params: ["nombre"] },
  C09: { name: "rechazo_generico",        params: ["nombre", "cargo"] },
  C10: { name: "invitacion_test",         params: ["nombre", "enlace_test", "fecha_limite"] },
  C11: { name: "recordatorio_test",       params: ["nombre", "fecha_limite", "enlace_test"] },
  C12: { name: "recordatorio_test",       params: ["nombre", "fecha_limite", "enlace_test"] },
  C13: { name: "confirmacion_recepcion",  params: ["nombre"] },
  C14: { name: "rechazo_generico",        params: ["nombre", "cargo"] },
  C15: { name: "invitacion_entrevista",   params: ["nombre", "enlace_agenda"] },
  C16: { name: "confirmacion_entrevista", params: ["nombre", "fecha_hora_entrevista", "enlace_videollamada"] },
  C17: { name: "recordatorio_entrevista", params: ["nombre", "fecha_hora_entrevista", "enlace_videollamada"] },
  C18: { name: "recordatorio_entrevista", params: ["nombre", "fecha_hora_entrevista", "enlace_videollamada"] },
  C19: { name: "oferta",                  params: ["nombre", "empresa", "cargo"] },
  C20: { name: "rechazo_generico",        params: ["nombre", "cargo"] },
  C21: { name: "bienvenida",              params: ["nombre", "empresa", "cargo"] },
};

export function templatesEnabled(): boolean {
  return (Deno.env.get("WHATSAPP_USE_TEMPLATES") ?? "false").toLowerCase() === "true";
}
