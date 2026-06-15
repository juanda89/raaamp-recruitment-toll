// =====================================================================
//  advance-stage  (PRD 5.6 / 5.7 / 8) — Acciones del RESPONSABLE desde el
//  tablero Kanban. Requiere sesión autenticada (Supabase Auth).
//  Acciones: agendar_entrevista, decision, aprobar_revision, rechazar,
//            aceptar_oferta, set_scores, reenviar_prueba.
// =====================================================================
import { preflight, json } from "../_shared/cors.ts";
import { serviceClient, getSettings } from "../_shared/supabase.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notify } from "../_shared/notify.ts";
import {
  onEntrevistaAgendada, decisionFinal, sendPruebaTecnica, rechazar,
} from "../_shared/pipeline.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

  // --- Guard: requiere un usuario autenticado (responsable) ---
  const actor = await requireUser(req);
  if (!actor) return json({ error: "no autorizado" }, 401, origin);

  try {
    const { action, candidate_id, ...args } = await req.json();
    const sb = serviceClient();
    const settings = await getSettings(sb);

    const { data: c, error } = await sb.from("rec_candidates")
      .select("*").eq("id", candidate_id).single();
    if (error || !c) return json({ error: "candidato no encontrado" }, 404, origin);

    // Auditoría de la acción humana (PRD 13).
    await sb.from("rec_candidate_events").insert({
      candidate_id, tipo: "accion_responsable", actor,
      detalle: { action, args },
    });

    let result;
    switch (action) {
      case "agendar_entrevista":
        result = await onEntrevistaAgendada(sb, c, settings, args.inicio, args.enlace_videollamada ?? "");
        break;
      case "decision":
        result = await decisionFinal(sb, c, settings, args.decision);
        break;
      case "aprobar_revision": // limpia la bandera y envía la prueba
        result = await sendPruebaTecnica(sb, c, settings);
        break;
      case "rechazar":
        result = await rechazar(sb, c, settings, args.etapa ?? c.estado.toLowerCase(),
          args.motivo ?? "Rechazo manual", args.codigo ?? null);
        break;
      case "aceptar_oferta":
        await notify(sb, c, settings, "C21"); // bienvenida / onboarding
        result = c;
        break;
      case "set_scores": {
        const patch: Record<string, unknown> = {};
        if (args.score_cv != null) patch.score_cv = args.score_cv;
        if (args.score_prueba != null) patch.score_prueba = args.score_prueba;
        if (args.score_personalidad != null) patch.score_personalidad = args.score_personalidad;
        const { data } = await sb.from("rec_candidates").update(patch)
          .eq("id", candidate_id).select("*").single();
        result = data;
        break;
      }
      case "reenviar_prueba":
        result = await sendPruebaTecnica(sb, c, settings);
        break;
      default:
        return json({ error: `acción desconocida: ${action}` }, 400, origin);
    }

    return json({ ok: true, candidate: result }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500, origin);
  }
});

/** Verifica el JWT del usuario y devuelve su email, o null. */
async function requireUser(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  try {
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return data.user.email ?? data.user.id;
  } catch {
    return null;
  }
}
