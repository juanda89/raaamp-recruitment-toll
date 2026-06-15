// Integración con modelo de lenguaje para screening de CV y apoyo a la
// evaluación de la prueba técnica (PRD 9.4 / 9.8).
//
// Usa OpenRouter (API compatible con OpenAI) -> permite elegir un modelo
// barato (p. ej. Haiku) por variable de entorno. Sin API key -> MODO SIMULADO.
//
// Variables:
//   OPENROUTER_API_KEY  clave de OpenRouter (https://openrouter.ai/keys)
//   LLM_MODEL           id del modelo, p. ej. "anthropic/claude-3.5-haiku"
//   LLM_BASE_URL        opcional; por defecto https://openrouter.ai/api/v1

const API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("LLM_MODEL") ?? "anthropic/claude-3.5-haiku";
const BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "https://openrouter.ai/api/v1";
const ENDPOINT = `${BASE_URL}/chat/completions`;

export interface RubricResult {
  score: number;            // 0-100
  resumen: string;          // fortalezas y banderas
  fortalezas: string[];
  banderas: string[];
  detalle: Record<string, unknown>;
  simulado: boolean;
}

const SYSTEM =
  "Eres un evaluador de selección riguroso y objetivo. Evalúas candidatos " +
  "contra una rúbrica y devuelves EXCLUSIVAMENTE un objeto JSON válido, sin " +
  "texto adicional, con esta forma: " +
  '{"score": <0-100 entero>, "resumen": "<2-3 frases>", ' +
  '"fortalezas": ["..."], "banderas": ["..."], ' +
  '"criterios": [{"criterio":"...","puntaje":<0-100>,"nota":"..."}]}';

function simulado(): RubricResult {
  return {
    score: 50,
    resumen: "[SIMULADO] Sin OPENROUTER_API_KEY: puntaje neutro de desarrollo.",
    fortalezas: [],
    banderas: ["Evaluación por IA no configurada"],
    detalle: { simulado: true },
    simulado: true,
  };
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    // OpenRouter recomienda identificar la app:
    "HTTP-Referer": Deno.env.get("REC_PUBLIC_BASE_URL") ?? "https://raaamp.co",
    "X-Title": "raaamp recruiting",
  };
}

async function call(messages: unknown[], extra: Record<string, unknown> = {}): Promise<RubricResult> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.2,
      response_format: { type: "json_object" },
      ...extra,
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? "{}";
  const parsed = extractJson(typeof raw === "string" ? raw : JSON.stringify(raw));
  return {
    score: Math.round(clamp(Number(parsed.score ?? 0), 0, 100)),
    resumen: String(parsed.resumen ?? ""),
    fortalezas: arr(parsed.fortalezas),
    banderas: arr(parsed.banderas),
    detalle: parsed,
    simulado: false,
  };
}

/** Evalúa un texto (CV o entrega) contra una rúbrica. */
export async function evaluateAgainstRubric(
  texto: string,
  rubrica: string,
  contexto: string,
): Promise<RubricResult> {
  if (!API_KEY) return simulado();
  const user =
    `CONTEXTO DEL CARGO:\n${contexto}\n\n` +
    `RÚBRICA DE EVALUACIÓN:\n${rubrica}\n\n` +
    `MATERIAL A EVALUAR:\n${texto.slice(0, 60000)}`;
  return call([
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ]);
}

/**
 * Evalúa un DOCUMENTO (PDF del CV). OpenRouter parsea el PDF con su engine
 * "pdf-text" (gratuito) y lo pasa al modelo. Para no-PDF, decodifica el texto.
 */
export async function evaluateDocument(
  base64: string,
  mediaType: string,
  rubrica: string,
  contexto: string,
): Promise<RubricResult> {
  if (!API_KEY) return simulado();

  const promptText = `CONTEXTO DEL CARGO:\n${contexto}\n\nRÚBRICA:\n${rubrica}`;

  if (mediaType === "application/pdf") {
    return call([
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: promptText },
          {
            type: "file",
            file: { filename: "cv.pdf", file_data: `data:application/pdf;base64,${base64}` },
          },
        ],
      },
    ], {
      // Engine gratuito de extracción de texto de PDF en OpenRouter.
      plugins: [{ id: "file-parser", pdf: { engine: "pdf-text" } }],
    });
  }

  // No-PDF: intentar leer como texto plano.
  return evaluateAgainstRubric(tryDecode(base64), rubrica, contexto);
}

function tryDecode(b64: string): string {
  try { return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); }
  catch { return ""; }
}
function extractJson(s: string): Record<string, any> {
  const m = s.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : {}; } catch { return {}; }
}
function arr(v: unknown): string[] { return Array.isArray(v) ? v.map(String) : []; }
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, isNaN(n) ? lo : n));
}
