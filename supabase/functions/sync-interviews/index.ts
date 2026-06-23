// =====================================================================
//  sync-interviews — Detecta automáticamente las entrevistas agendadas en
//  Google Calendar (cuando el candidato reserva con el enlace de agenda) y
//  avanza al candidato: FINALISTA -> ENTREVISTA_FINAL + C16 + recordatorios.
//  Se invoca por pg_cron. Inerte si Google no está configurado.
// =====================================================================
import { json } from "../_shared/cors.ts";
import { serviceClient, getSettings, type Candidate } from "../_shared/supabase.ts";
import { onEntrevistaAgendada } from "../_shared/pipeline.ts";
import { googleConfigured, listUpcomingEvents } from "../_shared/google.ts";

Deno.serve(async () => {
  if (!googleConfigured()) {
    return json({ ok: false, skip: "GOOGLE_SA no configurado" });
  }
  try {
    const sb = serviceClient();
    const settings = await getSettings(sb);
    const events = await listUpcomingEvents();

    // Candidatos finalistas con correo, esperando agendar.
    const { data: finalistas } = await sb.from("rec_candidates")
      .select("*").eq("estado", "FINALISTA");

    let agendados = 0;
    for (const c of (finalistas ?? []) as Candidate[]) {
      const email = (c.email ?? "").toLowerCase();
      if (!email) continue;
      // Busca un evento donde el candidato sea asistente (= reservó la cita).
      const ev = events.find((e) => e.attendees.includes(email) && e.start);
      if (!ev) continue;
      await onEntrevistaAgendada(
        sb, c, settings, ev.start!, ev.meet ?? settings.enlace_agenda ?? "",
      );
      agendados++;
    }
    return json({ ok: true, eventos: events.length, agendados });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
