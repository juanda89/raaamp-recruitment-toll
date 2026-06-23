// =====================================================================
//  submit-prueba  (PRD 5.4) — Entrega de la prueba técnica por el candidato.
//  Acceso por TOKEN (sin login). Sube el archivo/enlace de entrega, confirma
//  recepción (C07) y dispara la evaluación asistida por IA.
// =====================================================================
import { preflight, json } from "../_shared/cors.ts";
import { serviceClient, getSettings } from "../_shared/supabase.ts";
import { notify } from "../_shared/notify.ts";
import { startPruebaTimer } from "../_shared/pipeline.ts";

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  const origin = req.headers.get("origin");

  // GET ?token=... -> al ABRIR la prueba arranca el contador de 72h y devuelve
  // la fecha límite + el nombre, para mostrar el countdown en la página.
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    const sb = serviceClient();
    const cand = await resolveToken(sb, token, "prueba");
    if (!cand) return json({ error: "token inválido o expirado" }, 403, origin);
    if (cand.estado !== "PRUEBA_TECNICA") {
      return json({ ok: true, estado: cand.estado, cerrada: true, nombre: cand.nombre }, 200, origin);
    }
    const settings = await getSettings(sb);
    const venceAt = await startPruebaTimer(sb, cand, settings); // primer open arranca el timer
    return json({ ok: true, nombre: cand.nombre, vence_at: venceAt, estado: cand.estado }, 200, origin);
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

  try {
    const form = await req.formData();
    const token = String(form.get("token") ?? "");
    const enlace = String(form.get("enlace") ?? ""); // repo/URL de la entrega (opcional)
    if (!token) return json({ error: "token requerido" }, 400, origin);

    const sb = serviceClient();
    const cand = await resolveToken(sb, token, "prueba");
    if (!cand) return json({ error: "token inválido o expirado" }, 403, origin);
    if (cand.estado !== "PRUEBA_TECNICA") return json({ error: "etapa no válida" }, 409, origin);
    // Plazo vencido (contado desde que abrió la prueba).
    if (cand.prueba_vence_at && new Date(cand.prueba_vence_at).getTime() < Date.now()) {
      return json({ error: "el plazo de la prueba ya venció" }, 409, origin);
    }

    // Subir archivo de entrega (opcional) al bucket rec-submissions.
    let entregaUrl = enlace || null;
    const file = form.get("archivo");
    if (file instanceof File && file.size > 0) {
      const ext = (file.name.split(".").pop() || "zip").toLowerCase();
      const path = `prueba/${cand.id}-${crypto.randomUUID()}.${ext}`;
      const { error } = await sb.storage.from("rec-submissions").upload(
        path, await file.arrayBuffer(),
        { contentType: file.type || "application/octet-stream" });
      if (!error) entregaUrl = path;
    }
    if (!entregaUrl) return json({ error: "se requiere archivo o enlace" }, 400, origin);

    const { data: c } = await sb.from("rec_candidates").update({
      prueba_entregada_at: new Date().toISOString(),
      prueba_entrega_url: entregaUrl,
    }).eq("id", cand.id).select("*").single();

    await sb.from("rec_access_tokens").update({ usado_at: new Date().toISOString() })
      .eq("token", token);

    const settings = await getSettings(sb);
    await notify(sb, c, settings, "C07"); // confirmación de entrega

    // Evaluación asíncrona.
    invokeAsync("evaluate-prueba", { candidate_id: cand.id });
    return json({ ok: true }, 201, origin);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500, origin);
  }
});

async function resolveToken(sb: any, token: string, proposito: string) {
  const { data } = await sb.from("rec_access_tokens").select("*, rec_candidates(*)")
    .eq("token", token).eq("proposito", proposito).single();
  if (!data) return null;
  if (new Date(data.expira_at).getTime() < Date.now()) return null;
  return data.rec_candidates;
}
function invokeAsync(fn: string, body: unknown): void {
  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch((e) => console.error(e));
}
