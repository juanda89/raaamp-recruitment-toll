// Configuración compartida del frontend de reclutamiento.
// La anon/publishable key es pública por diseño (RLS protege los datos).
window.REC_CONFIG = {
  SUPABASE_URL: "https://lcqugobrchkenkawxlfj.supabase.co",
  ANON_KEY: "sb_publishable_kGHBW8EO52wj5PzR2cnsdw_BbOXBlQw",
  get FUNCTIONS_URL() {
    return this.SUPABASE_URL + "/functions/v1";
  },
  EMPRESA: "raaamp",
  CARGO: "AI and Automation Specialist",
};
