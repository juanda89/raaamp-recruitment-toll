// =====================================================================
//  evaluate-prueba  (PRD 5.4 / 9.4) — Evaluación ASISTIDA por IA de la entrega.
//  La IA SUGIERE un puntaje (0-100) + notas y avisa al responsable; NO avanza el
//  pipeline. El responsable revisa, ajusta y decide (aprobar/rechazar) desde el
//  Kanban. Así la evaluación de la prueba técnica NO es automática.
// =====================================================================
import { json } from "../_shared/cors.ts";
import { serviceClient, getSettings } from "../_shared/supabase.ts";
import { evaluateAgainstRubric } from "../_shared/llm.ts";
import { notify } from "../_shared/notify.ts";

const RUBRICA_PRUEBA = `
Evalúa la entrega de la prueba técnica del cargo "AI and Automation Specialist".
El reto es sobre Google Sheets + Apps Script:
- Menú "Admin" con control de acceso por código que funciona correctamente.   [peso alto]
- Herramienta "Monthly Comparative Report": actual vs. planeado por categoría,
  detección de desviaciones (~15-20%+), resalta los ítems responsables y genera
  el reporte en una pestaña o borrador de Gmail.                               [peso alto]
- Buenas prácticas: código limpio, modular y mantenible; manejo de errores.    [peso medio]
- Claridad del RESUMEN en lenguaje no técnico (para un fundador): explica la
  lógica, las decisiones y cómo la automatización resuelve el problema.        [peso medio-alto]
- Bonus: script de despliegue masivo a copias de clientes (escalabilidad).     [peso bajo]
Penaliza entregas incompletas, que no corran, o sin el resumen explicativo.`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const { candidate_id } = await req.json();
    const sb = serviceClient();
    const settings = await getSettings(sb);

    const { data: c, error } = await sb.from("rec_candidates")
      .select("*").eq("id", candidate_id).single();
    if (error || !c) return json({ error: "candidato no encontrado" }, 404);

    const material =
      `Enlace/archivo de entrega: ${c.prueba_entrega_url}\n` +
      `Enunciado/rúbrica de referencia: ${settings.enunciado_prueba_url ?? "(no configurado)"}\n` +
      `Este puntaje es SOLO una SUGERENCIA; el revisor humano decide y puede ajustarlo.`;

    const result = await evaluateAgainstRubric(material, RUBRICA_PRUEBA,
      `Cargo: ${settings.cargo} en ${settings.empresa}.`);

    // La IA solo SUGIERE: guarda el puntaje propuesto + notas y marca revisión.
    // NO avanza el pipeline; eso lo decide el responsable desde el Kanban.
    const { data: updated } = await sb.from("rec_candidates").update({
      score_prueba: result.score,
      prueba_evaluacion: result.detalle,
      flag_revision: true,
      motivo_revision: "Prueba técnica entregada — pendiente de tu evaluación",
    }).eq("id", candidate_id).select("*").single();

    await sb.from("rec_candidate_events").insert({
      candidate_id, tipo: "scoring",
      detalle: { componente: "prueba", score: result.score, simulado: result.simulado, sugerido: true },
    });

    // Avisar al responsable que hay una prueba lista para revisar.
    await notify(sb, updated, settings, "I01", {
      motivo: `entregó la prueba técnica (sugerencia IA: ${result.score}/100). Revísala y decide.`,
    });

    return json({ ok: true, score_prueba_sugerido: result.score, simulado: result.simulado });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
