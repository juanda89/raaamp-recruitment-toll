// =====================================================================
//  reminders-cron  (PRD 9.4 / 11) — Tareas programadas.
//  Invocada periódicamente por pg_cron (ver supabase/migrations/0004_cron.sql).
//   - task=reminders (default): envía recordatorios vencidos (24h/12h) y
//     procesa vencimientos (retiro por no entrega de prueba/test).
//   - task=digest: envía el resumen diario del pipeline (I03) al responsable.
// =====================================================================
import { json } from "../_shared/cors.ts";
import { serviceClient, getSettings } from "../_shared/supabase.ts";
import { notify } from "../_shared/notify.ts";
import { render } from "../_shared/templates.ts";
import { sendEmail, responsableEmail } from "../_shared/email.ts";
import { rechazar } from "../_shared/pipeline.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const task = url.searchParams.get("task") ?? "reminders";
  const sb = serviceClient();
  const settings = await getSettings(sb);

  try {
    if (task === "digest") {
      await sendDigest(sb, settings);
      return json({ ok: true, task });
    }

    let enviados = 0, vencidos = 0;

    // 1) Recordatorios programados ya vencidos.
    const { data: due } = await sb.from("rec_reminders")
      .select("*").is("enviado_at", null).eq("cancelado", false)
      .lte("programado_at", new Date().toISOString()).limit(200);

    for (const r of due ?? []) {
      const { data: c } = await sb.from("rec_candidates").select("*").eq("id", r.candidate_id).single();
      if (!c) continue;
      // Solo si el candidato sigue en la etapa relevante.
      const stillRelevant =
        (r.motivo === "prueba" && c.estado === "PRUEBA_TECNICA") ||
        (r.motivo === "test" && c.estado === "TEST_PERSONALIDAD") ||
        (r.motivo === "entrevista" && c.estado === "ENTREVISTA_FINAL");
      if (stillRelevant) {
        const extra = await linkVars(sb, c, r.motivo);
        await notify(sb, c, settings, r.template_codigo, extra);
        enviados++;
      }
      await sb.from("rec_reminders").update({ enviado_at: new Date().toISOString() }).eq("id", r.id);
    }

    // 2) Vencimientos: prueba/test sin entrega -> retiro (C08 para prueba).
    const now = new Date().toISOString();
    const { data: pruebaVencida } = await sb.from("rec_candidates").select("*")
      .eq("estado", "PRUEBA_TECNICA").is("prueba_entregada_at", null)
      .lt("prueba_vence_at", now);
    for (const c of pruebaVencida ?? []) {
      await rechazar(sb, c, settings, "prueba_tecnica", "No entregó la prueba a tiempo", "C08", "RETIRADO");
      vencidos++;
    }

    const { data: testVencido } = await sb.from("rec_candidates").select("*")
      .eq("estado", "TEST_PERSONALIDAD").is("test_completado_at", null)
      .lt("test_vence_at", now);
    for (const c of testVencido ?? []) {
      await rechazar(sb, c, settings, "test_personalidad", "No completó el test a tiempo", null, "RETIRADO");
      vencidos++;
    }

    return json({ ok: true, task, enviados, vencidos });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

/** Reconstruye el enlace con token vigente para el recordatorio. */
async function linkVars(sb: any, c: any, motivo: string): Promise<Record<string, string>> {
  if (motivo === "entrevista") {
    return { fecha_hora_entrevista: fmt(c.entrevista_inicio_at), enlace_videollamada: c.enlace_videollamada ?? "" };
  }
  const proposito = motivo === "prueba" ? "prueba" : "test";
  const { data } = await sb.from("rec_access_tokens").select("token, expira_at")
    .eq("candidate_id", c.id).eq("proposito", proposito)
    .gt("expira_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1);
  const token = data?.[0]?.token;
  const base = Deno.env.get("REC_PUBLIC_BASE_URL") ?? "https://raaamp.co";
  const link = token ? `${base}/${proposito}?token=${token}` : "";
  const vence = motivo === "prueba" ? c.prueba_vence_at : c.test_vence_at;
  return motivo === "prueba"
    ? { enlace_prueba: link, fecha_limite: fmt(vence) }
    : { enlace_test: link, fecha_limite: fmt(vence) };
}

async function sendDigest(sb: any, settings: any) {
  const { data } = await sb.from("rec_candidates").select("estado");
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.estado] = (counts[row.estado] ?? 0) + 1;
  const resumen = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join("\n");

  // I03 es un email al responsable, sin candidato asociado -> se envía directo.
  const tpl = await render(sb, "I03", {
    cargo: settings.cargo, empresa: settings.empresa,
    enlace_tablero: settings.enlace_tablero ?? "",
  });
  const cuerpo = `${tpl.cuerpo}\n\n${resumen}`;
  const to = responsableEmail();
  if (to) await sendEmail(to, tpl.asunto ?? `Resumen diario — ${settings.cargo}`, `<pre>${cuerpo}</pre>`);
}
function fmt(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short", timeZone: "America/Bogota" });
  } catch { return iso; }
}
