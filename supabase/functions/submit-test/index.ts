// =====================================================================
//  submit-test  (PRD 5.5 / 6.3 / 9.6) — Recibe las respuestas del test de
//  personalidad (acceso por TOKEN), calcula la afinidad por los 9 tipos del
//  Eneagrama y el score_personalidad ponderado a los tipos objetivo, guarda
//  todo y avanza el pipeline (finalista o rechazo por puntaje total).
// =====================================================================
import { preflight, json } from "../_shared/cors.ts";
import { serviceClient, getSettings } from "../_shared/supabase.ts";
import { scorePersonality, type QuestionDef, type ResponseInput } from "../_shared/personality.ts";
import { notify } from "../_shared/notify.ts";
import { afterTestPersonalidad } from "../_shared/pipeline.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  const origin = req.headers.get("origin");

  // GET ?token=... -> devuelve el banco de preguntas para renderizar el test.
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    const sb = serviceClient();
    const cand = await resolveToken(sb, token, "test");
    if (!cand) return json({ error: "token inválido o expirado" }, 403, origin);
    const { data } = await sb.from("rec_personality_questions")
      .select("id, orden, opcion_a, opcion_b").eq("activo", true).order("orden");
    return json({ ok: true, nombre: cand.nombre, preguntas: data ?? [] }, 200, origin);
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

  try {
    const { token, respuestas } = await req.json();
    // respuestas: [{ question_id, eleccion: "A"|"B" }, ...]
    if (!token || !Array.isArray(respuestas)) return json({ error: "datos inválidos" }, 400, origin);

    const sb = serviceClient();
    const cand = await resolveToken(sb, token, "test");
    if (!cand) return json({ error: "token inválido o expirado" }, 403, origin);
    if (cand.estado !== "TEST_PERSONALIDAD") return json({ error: "etapa no válida" }, 409, origin);

    // Guardar respuestas individuales (auditoría).
    const rows = (respuestas as ResponseInput[]).map((r) => ({
      candidate_id: cand.id,
      question_id: r.question_id,
      eleccion: r.eleccion,
    }));
    await sb.from("rec_personality_responses")
      .upsert(rows, { onConflict: "candidate_id,question_id" });

    // Cargar definición de preguntas para el scoring.
    const { data: qs } = await sb.from("rec_personality_questions")
      .select("id, tipo_a, tipo_b").eq("activo", true);
    const questions = (qs ?? []) as QuestionDef[];

    const settings = await getSettings(sb);
    const result = scorePersonality(questions, respuestas as ResponseInput[], settings.tipos_objetivo);

    const { data: c } = await sb.from("rec_candidates").update({
      enn_ranking: result.ranking,
      score_personalidad: result.score_personalidad,  // dispara recálculo de score_total
      test_completado_at: new Date().toISOString(),
    }).eq("id", cand.id).select("*").single();

    await sb.from("rec_access_tokens").update({ usado_at: new Date().toISOString() }).eq("token", token);
    await sb.from("rec_candidate_events").insert({
      candidate_id: cand.id, tipo: "scoring",
      detalle: { componente: "personalidad", score: result.score_personalidad, ranking: result.ranking },
    });

    await notify(sb, c, settings, "C13"); // test recibido
    await afterTestPersonalidad(sb, c, settings);

    return json({ ok: true, score_personalidad: result.score_personalidad }, 201, origin);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500, origin);
  }
});

async function resolveToken(sb: any, token: string, proposito: string) {
  const { data } = await sb.from("rec_access_tokens").select("*, rec_candidates(*)")
    .eq("token", token).eq("proposito", proposito).single();
  if (!data || new Date(data.expira_at).getTime() < Date.now()) return null;
  return data.rec_candidates;
}
