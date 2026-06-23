// Lectura de Google Calendar con una SERVICE ACCOUNT (server-to-server, sin
// flujo OAuth interactivo). El responsable comparte su calendario con el email
// de la service account; aquí firmamos un JWT y pedimos un access token.
//
// Secrets:
//   GOOGLE_SA_EMAIL       client_email de la service account
//   GOOGLE_SA_KEY         private_key (PEM; los \n pueden venir escapados)
//   GOOGLE_CALENDAR_ID    opcional (default 'primary')
// Sin credenciales -> googleConfigured() = false (la sync queda inerte).

const SA_EMAIL = Deno.env.get("GOOGLE_SA_EMAIL");
const SA_KEY = Deno.env.get("GOOGLE_SA_KEY");

export function googleConfigured(): boolean {
  return Boolean(SA_EMAIL && SA_KEY);
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8", der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
}

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlStr(JSON.stringify({
    iss: SA_EMAIL,
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await importKey((SA_KEY || "").replace(/\\n/g, "\n"));
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(unsigned)),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const d = await res.json();
  if (!res.ok) throw new Error("google token: " + JSON.stringify(d));
  return d.access_token as string;
}

export interface CalEvent {
  attendees: string[]; // emails en minúscula
  start: string | null; // ISO
  meet: string | null;  // enlace de Meet
  summary: string;
}

/** Lista eventos del calendario en una ventana [hace 1 día, +60 días]. */
export async function listUpcomingEvents(): Promise<CalEvent[]> {
  const cal = Deno.env.get("GOOGLE_CALENDAR_ID") ?? "primary";
  const token = await accessToken();
  const timeMin = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events` +
    `?singleEvents=true&orderBy=startTime&maxResults=250` +
    `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await res.json();
  if (!res.ok) throw new Error("calendar list: " + JSON.stringify(d));
  return (d.items || []).map((ev: any) => ({
    attendees: (ev.attendees || []).map((a: any) => (a.email || "").toLowerCase()).filter(Boolean),
    start: ev.start?.dateTime ?? ev.start?.date ?? null,
    meet: ev.hangoutLink ?? null,
    summary: ev.summary ?? "",
  }));
}
