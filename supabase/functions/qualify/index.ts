// =====================================================================
//  qualify  (PRD 5.3 / 7) — Registra las respuestas de cualificación del
//  candidato (recogidas por el agente de WhatsApp o un formulario) y evalúa
//  los filtros suaves. Dentro de parámetros -> envía la prueba técnica;
//  fuera de parámetros -> marca revisión del responsable (no descarta).
// =====================================================================
import { json } from "../_shared/cors.ts";
import { serviceClient, getSettings } from "../_shared/supabase.ts";
import { afterQualification } from "../_shared/pipeline.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const body = await req.json();
    const { candidate_id, respuestas } = body;
    if (!candidate_id || !respuestas) return json({ error: "faltan datos" }, 400);

    const sb = serviceClient();
    const settings = await getSettings(sb);

    const patch: Record<string, unknown> = {
      expectativa_salarial: numOrNull(respuestas.expectativa_salarial),
      disponibilidad_inicio: respuestas.disponibilidad_inicio ?? null,
      modalidad: enumOrNull(respuestas.modalidad, ["remoto", "hibrido", "presencial"]),
      nivel_ingles: enumOrNull(respuestas.nivel_ingles, ["basico", "intermedio", "avanzado"]),
      ubicacion: respuestas.ubicacion ?? null,
      experiencia_automatizacion: respuestas.experiencia_automatizacion ?? null,
      cualificacion_extra: respuestas.extra ?? {},
    };

    const { data: c, error } = await sb.from("rec_candidates")
      .update(patch).eq("id", candidate_id).select("*").single();
    if (error || !c) return json({ error: "candidato no encontrado" }, 404);

    const updated = await afterQualification(sb, c, settings);
    return json({ ok: true, estado: updated.estado, flag_revision: updated.flag_revision });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return isFinite(n) && v != null && v !== "" ? n : null;
}
function enumOrNull(v: unknown, allowed: string[]): string | null {
  return typeof v === "string" && allowed.includes(v) ? v : null;
}
