// =====================================================================
//  POST /api/leads  (PRD 9.3) — Endpoint de ingesta del formulario público.
//  Recibe multipart/form-data: campos del candidato + el archivo de CV.
//  Valida, almacena el CV, crea el candidato en estado APLICADO, dispara la
//  confirmación por WhatsApp (C01) y lanza el screening de CV.
// =====================================================================
import { preflight, json } from "../_shared/cors.ts";
import { serviceClient, getSettings } from "../_shared/supabase.ts";
import { onApplied } from "../_shared/pipeline.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

  try {
    const form = await req.formData();
    const nombre = str(form.get("nombre"));
    const whatsapp = str(form.get("whatsapp"));
    const optin = bool(form.get("whatsapp_optin"));

    if (!nombre || !whatsapp) return json({ error: "nombre y whatsapp son obligatorios" }, 400, origin);
    if (!optin) return json({ error: "se requiere consentimiento de WhatsApp" }, 400, origin);

    const sb = serviceClient();

    // --- Knockout (PRD 5.1): pasa si ninguna respuesta mínima es negativa. ---
    const knockout = parseJson(form.get("knockout")) as Record<string, unknown>;
    const knockoutPassed = Object.values(knockout).every((v) =>
      v === true || v === "si" || v === "sí" || v === "true"
    );

    // --- Subir CV a Storage (bucket privado rec-cvs) ---
    let cvUrl: string | null = null;
    const cv = form.get("cv");
    if (cv instanceof File && cv.size > 0) {
      const ext = (cv.name.split(".").pop() || "pdf").toLowerCase();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await sb.storage.from("rec-cvs").upload(
        path, await cv.arrayBuffer(),
        { contentType: cv.type || "application/octet-stream", upsert: false },
      );
      if (upErr) console.error("Error subiendo CV:", upErr.message);
      else cvUrl = path;
    }

    // Nivel de inglés capturado en el formulario (dropdown MCER -> enum).
    const nivelInglesRaw = str(form.get("nivel_ingles"));
    const nivelIngles = ["basico", "intermedio", "avanzado"].includes(nivelInglesRaw)
      ? nivelInglesRaw : null;
    const cefr = str(form.get("nivel_ingles_cefr"));

    // --- Crear candidato en APLICADO ---
    const { data: candidate, error } = await sb.from("rec_candidates").insert({
      nombre,
      email: str(form.get("email")) || null,
      whatsapp,
      whatsapp_optin: optin,
      fuente: str(form.get("fuente")) || null,
      utm: parseJson(form.get("utm")),
      cv_url: cvUrl,
      knockout_respuestas: knockout,
      knockout_passed: knockoutPassed,
      nivel_ingles: nivelIngles,
      cualificacion_extra: cefr ? { nivel_ingles_cefr: cefr } : {},
      estado: "APLICADO",
    }).select("*").single();
    if (error) throw error;

    const settings = await getSettings(sb);
    // Avanza la máquina de estados (knockout -> C01 + SCREENING_CV, o rechazo).
    await onApplied(sb, candidate, settings);

    // Dispara el screening de CV de forma asíncrona (no bloquea la respuesta).
    if (knockoutPassed && cvUrl) {
      invokeAsync("cv-screening", { candidate_id: candidate.id });
    }

    return json({ ok: true, candidate_id: candidate.id }, 201, origin);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500, origin);
  }
});

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function bool(v: FormDataEntryValue | null): boolean {
  return v === "true" || v === "on" || v === "1" || v === "si";
}
function parseJson(v: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof v !== "string" || !v) return {};
  try { return JSON.parse(v); } catch { return {}; }
}

/** Invoca otra Edge Function sin esperar la respuesta (fire-and-forget). */
function invokeAsync(fn: string, body: unknown): void {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((e) => console.error(`invoke ${fn} falló:`, e));
}
