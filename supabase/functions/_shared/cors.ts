// CORS compartido. El landing público (raaamp.co) llama a `ingest-lead`,
// y las páginas de prueba/test llaman a sus funciones con token.
const ALLOWED = (Deno.env.get("REC_ALLOWED_ORIGINS") ??
  "https://raaamp.co,https://www.raaamp.co,https://app.raaamp.co")
  .split(",").map((s) => s.trim());

export function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req.headers.get("origin")) });
  }
  return null;
}
