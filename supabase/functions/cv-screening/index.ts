// =====================================================================
//  cv-screening  (PRD 5.2 / 9.4) — Screening de hoja de vida por IA.
//  Descarga el CV del candidato, lo evalúa contra una rúbrica con el modelo
//  de lenguaje, guarda score_cv + resumen + salida estructurada (auditoría)
//  y avanza/rechaza según el umbral.
// =====================================================================
import { json } from "../_shared/cors.ts";
import { serviceClient, getSettings } from "../_shared/supabase.ts";
import { evaluateDocument } from "../_shared/llm.ts";
import { afterCvScreening } from "../_shared/pipeline.ts";

const RUBRICA_DEFAULT = `
Evalúa al candidato para el cargo "AI and Automation Specialist":
- Experiencia con automatización (n8n, Make, Zapier) y scripting (Python).  [peso alto]
- Integración de APIs / LLMs y construcción de flujos/agentes.              [peso alto]
- Bases de datos, webhooks y despliegue (Vercel, Supabase o similares).      [peso medio]
- Comunicación, autonomía y claridad de logros cuantificados.                [peso medio]
- Nivel de inglés evidenciado.                                               [peso bajo]
Penaliza CV vago, sin logros medibles o sin experiencia técnica verificable.`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const { candidate_id } = await req.json();
    const sb = serviceClient();
    const settings = await getSettings(sb);

    const { data: c, error } = await sb.from("rec_candidates")
      .select("*").eq("id", candidate_id).single();
    if (error || !c) return json({ error: "candidato no encontrado" }, 404);
    if (!c.cv_url) return json({ error: "candidato sin CV" }, 400);

    // Descargar el CV del bucket privado.
    const { data: file, error: dlErr } = await sb.storage.from("rec-cvs").download(c.cv_url);
    if (dlErr || !file) return json({ error: `no se pudo leer el CV: ${dlErr?.message}` }, 500);

    const buf = new Uint8Array(await file.arrayBuffer());
    const base64 = bytesToB64(buf);
    const mediaType = guessMime(c.cv_url, file.type);

    const result = await evaluateDocument(base64, mediaType, RUBRICA_DEFAULT,
      `Cargo: ${settings.cargo} en ${settings.empresa}.`);

    const updated = await sb.from("rec_candidates").update({
      score_cv: result.score,
      cv_resumen: result.resumen,
      cv_evaluacion: result.detalle,
    }).eq("id", candidate_id).select("*").single();

    await sb.from("rec_candidate_events").insert({
      candidate_id, tipo: "scoring",
      detalle: { componente: "cv", score: result.score, simulado: result.simulado },
    });

    await afterCvScreening(sb, updated.data, settings);
    return json({ ok: true, score_cv: result.score, simulado: result.simulado });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function guessMime(path: string, fallback: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "txt") return "text/plain";
  return fallback || "application/pdf";
}
