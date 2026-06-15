// Integración con modelo de lenguaje para screening de CV y apoyo a la
// evaluación de la prueba técnica (PRD 9.4 / 9.8). Usa la API de Claude
// (Anthropic Messages API). Sin API key -> MODO SIMULADO (puntaje neutro).
//
// Modelos válidos (ene-2026): claude-opus-4-8, claude-sonnet-4-6,
// claude-haiku-4-5-20251001. Para screening basta un modelo eficiente.

const API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("LLM_MODEL") ?? "claude-sonnet-4-6";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export interface RubricResult {
  score: number;            // 0-100
  resumen: string;          // fortalezas y banderas
  fortalezas: string[];
  banderas: string[];
  detalle: Record<string, unknown>;
  simulado: boolean;
}

/**
 * Evalúa un texto (CV o entrega de prueba) contra una rúbrica y devuelve un
 * puntaje 0-100 con salida estructurada (se guarda para auditoría — PRD 13).
 */
export async function evaluateAgainstRubric(
  texto: string,
  rubrica: string,
  contexto: string,
): Promise<RubricResult> {
  if (!API_KEY) {
    return {
      score: 50,
      resumen: "[SIMULADO] Sin ANTHROPIC_API_KEY: puntaje neutro de desarrollo.",
      fortalezas: [],
      banderas: ["Evaluación por IA no configurada"],
      detalle: { simulado: true },
      simulado: true,
    };
  }

  const system =
    "Eres un evaluador de selección riguroso y objetivo. Evalúas candidatos " +
    "contra una rúbrica y devuelves EXCLUSIVAMENTE un objeto JSON válido, sin " +
    "texto adicional, con esta forma: " +
    '{"score": <0-100 entero>, "resumen": "<2-3 frases>", ' +
    '"fortalezas": ["..."], "banderas": ["..."], ' +
    '"criterios": [{"criterio":"...","puntaje":<0-100>,"nota":"..."}]}';

  const user =
    `CONTEXTO DEL CARGO:\n${contexto}\n\n` +
    `RÚBRICA DE EVALUACIÓN:\n${rubrica}\n\n` +
    `MATERIAL A EVALUAR:\n${texto.slice(0, 60000)}`;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const raw = data?.content?.[0]?.text ?? "{}";
  const parsed = extractJson(raw);

  const score = clamp(Number(parsed.score ?? 0), 0, 100);
  return {
    score: Math.round(score),
    resumen: String(parsed.resumen ?? ""),
    fortalezas: arr(parsed.fortalezas),
    banderas: arr(parsed.banderas),
    detalle: parsed,
    simulado: false,
  };
}

/**
 * Igual que evaluateAgainstRubric pero enviando un DOCUMENTO (p. ej. el PDF del
 * CV) directamente al modelo, que lo lee de forma nativa. Más fiable que
 * intentar extraer texto del PDF en el edge runtime.
 */
export async function evaluateDocument(
  base64: string,
  mediaType: string,
  rubrica: string,
  contexto: string,
): Promise<RubricResult> {
  if (!API_KEY) {
    return {
      score: 50,
      resumen: "[SIMULADO] Sin ANTHROPIC_API_KEY: puntaje neutro de desarrollo.",
      fortalezas: [],
      banderas: ["Evaluación por IA no configurada"],
      detalle: { simulado: true },
      simulado: true,
    };
  }
  const system =
    "Eres un evaluador de selección riguroso y objetivo. Evalúas el documento " +
    "adjunto (hoja de vida) contra una rúbrica y devuelves EXCLUSIVAMENTE un " +
    "objeto JSON válido, sin texto adicional, con esta forma: " +
    '{"score": <0-100 entero>, "resumen": "<2-3 frases>", ' +
    '"fortalezas": ["..."], "banderas": ["..."], ' +
    '"criterios": [{"criterio":"...","puntaje":<0-100>,"nota":"..."}]}';

  const isPdf = mediaType === "application/pdf";
  const docBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } }
    : { type: "text", text: tryDecode(base64) };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `CONTEXTO DEL CARGO:\n${contexto}\n\nRÚBRICA:\n${rubrica}` },
          docBlock,
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parsed = extractJson(data?.content?.[0]?.text ?? "{}");
  return {
    score: Math.round(clamp(Number(parsed.score ?? 0), 0, 100)),
    resumen: String(parsed.resumen ?? ""),
    fortalezas: arr(parsed.fortalezas),
    banderas: arr(parsed.banderas),
    detalle: parsed,
    simulado: false,
  };
}

function tryDecode(b64: string): string {
  try { return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); }
  catch { return ""; }
}

function extractJson(s: string): Record<string, any> {
  const m = s.match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : {};
  } catch {
    return {};
  }
}
function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, isNaN(n) ? lo : n));
}
