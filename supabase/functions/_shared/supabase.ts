// Cliente Supabase con service_role (ignora RLS). Solo para uso server-side
// dentro de Edge Functions. NUNCA exponer la service_role key al navegador.
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export type Candidate = {
  id: string;
  nombre: string;
  email: string | null;
  whatsapp: string;
  whatsapp_optin: boolean;
  idioma: "es" | "en";
  fuente: string | null;
  cv_url: string | null;
  knockout_respuestas: Record<string, unknown>;
  knockout_passed: boolean | null;
  score_cv: number | null;
  expectativa_salarial: number | null;
  nivel_ingles: "basico" | "intermedio" | "avanzado" | null;
  modalidad: "remoto" | "hibrido" | "presencial" | null;
  disponibilidad_inicio: string | null;
  ubicacion: string | null;
  score_prueba: number | null;
  prueba_vence_at: string | null;
  enn_ranking: Record<string, number> | null;
  score_personalidad: number | null;
  score_total: number | null;
  estado: string;
  flag_revision: boolean;
  entrevista_inicio_at: string | null;
  enlace_videollamada: string | null;
  [k: string]: unknown;
};

export type Settings = {
  empresa: string;
  cargo: string;
  peso_cv: number;
  peso_prueba: number;
  peso_personalidad: number;
  umbral_cv: number;
  umbral_prueba: number;
  umbral_total: number;
  salario_min: number | null;
  salario_max: number | null;
  nivel_ingles_min: "basico" | "intermedio" | "avanzado";
  tipos_objetivo: Record<string, number>;
  plazo_prueba_horas: number;
  plazo_test_horas: number;
  recordatorio_offsets_h: number[];
  enlace_agenda: string | null;
  enlace_tablero: string | null;
  enunciado_prueba_url: string | null;
};

export async function getSettings(sb: SupabaseClient): Promise<Settings> {
  const { data, error } = await sb.from("rec_settings").select("*").eq("id", true).single();
  if (error) throw error;
  return data as Settings;
}
