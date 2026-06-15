// =====================================================================
//  evaluate-prueba  (PRD 5.4 / 9.4) — Evaluación asistida por IA de la entrega
//  de la prueba técnica. Produce score_prueba (0-100), lo guarda con su salida
//  estructurada (auditoría) y avanza/rechaza según el umbral.
//
//  Nota: si la entrega es un enlace (repo), aquí se evalúa la URL/los metadatos.
//  Para evaluar contenido descargado, ampliar para leer rec-submissions.
// =====================================================================
import { json } from "../_shared/cors.ts";
import { serviceClient, getSettings } from "../_shared/supabase.ts";
import { evaluateAgainstRubric } from "../_shared/llm.ts";
import { afterPruebaEntregada } from "../_shared/pipeline.ts";

const RUBRICA_PRUEBA = `
Evalúa la entrega de la prueba técnica del cargo "AI and Automation Specialist":
- Cumple el objetivo del reto y los requisitos del enunciado.        [peso alto]
- Calidad de la automatización/flujo y manejo de errores.            [peso alto]
- Buenas prácticas, legibilidad y estructura del código.             [peso medio]
- Documentación y claridad de la entrega.                            [peso medio]
- Creatividad y robustez de la solución.                             [peso bajo]`;

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
      `El revisor humano puede ajustar este puntaje en la ficha del candidato.`;

    const result = await evaluateAgainstRubric(material, RUBRICA_PRUEBA,
      `Cargo: ${settings.cargo} en ${settings.empresa}.`);

    const { data: updated } = await sb.from("rec_candidates").update({
      score_prueba: result.score,
      prueba_evaluacion: result.detalle,
    }).eq("id", candidate_id).select("*").single();

    await sb.from("rec_candidate_events").insert({
      candidate_id, tipo: "scoring",
      detalle: { componente: "prueba", score: result.score, simulado: result.simulado },
    });

    await afterPruebaEntregada(sb, updated, settings);
    return json({ ok: true, score_prueba: result.score, simulado: result.simulado });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
