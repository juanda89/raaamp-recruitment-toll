// Agente conversacional de WhatsApp (PRD 9.5 / 7).
// Habla como un reclutador humano: cálido, breve (estilo WhatsApp), responde
// dudas del candidato y reencauza hacia el objetivo. NO repite lo que ya se
// capturó en el formulario (inglés, expectativa salarial, etc.).
//
// Usa OpenRouter (mismo modelo que el screening). Sin API key -> respuesta
// mínima de respaldo que completa la cualificación.

const API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("LLM_MODEL") ?? "google/gemini-2.5-flash";
const BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "https://openrouter.ai/api/v1";

export interface AgentTurn {
  reply: string;
  fields: {
    disponibilidad_inicio?: string | null;
    ubicacion?: string | null;
    modalidad?: "remoto" | "hibrido" | "presencial" | null;
    otros_procesos?: string | null;
  };
  complete: boolean;
}

export interface AgentInput {
  nombre: string;
  cargo: string;
  empresa: string;
  known: Record<string, string>; // datos ya capturados (inglés, salario, etc.)
  yaTengo: { disponibilidad_inicio: boolean; ubicacion: boolean };
  history: { role: "user" | "assistant"; content: string }[];
}

const ROLE_FACTS = `
Datos del cargo (para responder dudas del candidato, con naturalidad y sin sonar a folleto):
- Cargo: AI and Automation Specialist en raaamp (empresa de IA y automatización).
- 100% remoto, tiempo completo.
- Salario: USD 1.500–2.500 al mes según experiencia.
- Stack: n8n, Make, Python, APIs (REST/GraphQL), webhooks, LLMs, agentes, RAG; desarrollo asistido por IA (Claude Code, Codex) y spec-driven.
- Proceso: una prueba técnica práctica y luego una entrevista final con el equipo.`;

export async function qualifyAgent(input: AgentInput): Promise<AgentTurn> {
  // Lo único que falta por conversación: disponibilidad/inicio y ubicación.
  const faltan: string[] = [];
  if (!input.yaTengo.disponibilidad_inicio) faltan.push("su disponibilidad o posible fecha de inicio (preaviso)");
  if (!input.yaTengo.ubicacion) faltan.push("su ciudad y zona horaria");

  if (!API_KEY) {
    return {
      reply: faltan.length
        ? `Genial. Cuéntame, ${input.nombre.split(" ")[0]}: ¿desde qué ciudad trabajas y para cuándo estarías disponible para empezar?`
        : "¡Perfecto! Con eso seguimos, te comparto la prueba técnica enseguida.",
      fields: {},
      complete: faltan.length === 0,
    };
  }

  const known = Object.entries(input.known)
    .map(([k, v]) => `- ${k}: ${v}`).join("\n");

  const system =
`Eres el asistente de selección de ${input.empresa} para el cargo "${input.cargo}". Hablas por WhatsApp con ${input.nombre}.
Tu estilo: humano, cálido y cercano, MUY breve (1–2 frases por mensaje), natural. Puedes usar un emoji ocasional. Escribe en español.
NUNCA suenes a bot: nada de listas, ni "(sí/no)", ni formularios. Conversa como una persona real.

YA SABES esto del candidato (NO lo vuelvas a preguntar):
${known || "- (sin datos)"}

OBJETIVO: de forma natural, conseguir lo que falta: ${faltan.length ? faltan.join(" y ") : "nada, ya tienes todo"}.
- Pregunta de a poco, sin interrogar. Si el candidato pregunta algo (sueldo, empresa, proceso, stack, horario), respóndele breve y con gusto, y luego retoma con suavidad lo que necesitas.
- No repitas preguntas ya respondidas en la conversación.
- Cuando ya tengas disponibilidad/inicio y ciudad+zona horaria, cierra cálidamente diciendo que le compartes la prueba técnica, y marca complete=true.
${ROLE_FACTS}

Responde EXCLUSIVAMENTE un JSON válido, sin texto extra, con esta forma:
{"reply":"<tu mensaje de WhatsApp>","fields":{"disponibilidad_inicio":"<texto|null>","ubicacion":"<ciudad y zona horaria|null>","modalidad":"remoto|hibrido|presencial|null","otros_procesos":"<texto|null>"},"complete":<true|false>}
En "fields" pon solo lo que hayas podido deducir de la conversación hasta ahora (lo no mencionado déjalo null).`;

  const messages = [
    { role: "system", content: system },
    ...input.history.slice(-16), // últimos turnos
  ];

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "raaamp recruiting agent",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 500,
        temperature: 0.6,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`agent LLM ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const parsed = JSON.parse(extractJson(data?.choices?.[0]?.message?.content ?? "{}"));
    return {
      reply: String(parsed.reply ?? "¿Me cuentas un poco más?"),
      fields: parsed.fields ?? {},
      complete: Boolean(parsed.complete),
    };
  } catch (e) {
    console.error("qualifyAgent error:", e);
    return {
      reply: `Perdona, ${input.nombre.split(" ")[0]}, se me cruzó un cable 😅. ¿Me repites tu última idea?`,
      fields: {},
      complete: false,
    };
  }
}

function extractJson(s: string): string {
  const m = s.match(/\{[\s\S]*\}/);
  return m ? m[0] : "{}";
}
