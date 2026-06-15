// Agente conversacional de WhatsApp con HERRAMIENTAS (tool-using) — PRD 9.5 / 7.
// Habla como un reclutador humano (cálido, breve, sin sonar a bot), responde
// dudas y reencauza. Maneja casos de excepción vía tools: corregir correo,
// reenviar la prueba, compartir/reagendar la entrevista, escalar a humano, y
// registrar/completar la cualificación. NO repite datos del formulario.
//
// Usa OpenRouter (tool calling estilo OpenAI). Sin API key -> respuesta mínima.

const API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("LLM_MODEL") ?? "google/gemini-2.5-flash";
const BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "https://openrouter.ai/api/v1";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export interface AgentHandlers {
  actualizar_correo(a: { email: string }): Promise<string>;
  reenviar_prueba(): Promise<string>;
  compartir_agenda(): Promise<string>;
  registrar_cualificacion(a: {
    disponibilidad_inicio?: string; ubicacion?: string; modalidad?: string;
  }): Promise<string>;
  completar_cualificacion(): Promise<string>;
  escalar_humano(a: { motivo: string }): Promise<string>;
}

export interface AgentCtx {
  nombre: string;
  empresa: string;
  cargo: string;
  estado: string;               // etapa actual del candidato
  known: Record<string, string>;// datos ya capturados (no re-preguntar)
  faltan: string[];             // datos a conseguir en cualificación
  tieneAgenda: boolean;
}

const TOOLS = [
  fn("actualizar_correo", "Corrige/actualiza el correo del candidato cuando dice que el suyo está mal o que no le llegó algo. Tras llamarlo, reenvía lo pendiente.",
    { email: { type: "string", description: "Correo electrónico nuevo y válido" } }, ["email"]),
  fn("reenviar_prueba", "Reenvía la prueba técnica al correo registrado del candidato. Úsalo si dice que no le llegó.", {}, []),
  fn("compartir_agenda", "Comparte el enlace para agendar o REPROGRAMAR la entrevista final (sirve también para no-shows).", {}, []),
  fn("registrar_cualificacion", "Guarda datos de cualificación que el candidato mencione (disponibilidad/fecha de inicio, ciudad y zona horaria, modalidad).",
    { disponibilidad_inicio: { type: "string" }, ubicacion: { type: "string" }, modalidad: { type: "string", enum: ["remoto", "hibrido", "presencial"] } }, []),
  fn("completar_cualificacion", "Marca la cualificación como completa cuando YA tienes disponibilidad de inicio y ciudad+zona horaria. Dispara el envío de la prueba por correo.", {}, []),
  fn("escalar_humano", "Deriva al responsable humano cuando el candidato lo pide o hay algo fuera de tu alcance.",
    { motivo: { type: "string" } }, ["motivo"]),
];

function fn(name: string, description: string, props: Record<string, unknown>, required: string[]) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties: props, required } } };
}

export function buildSystem(ctx: AgentCtx): string {
  const known = Object.entries(ctx.known).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- (sin datos)";
  const objetivo = ctx.estado === "CUALIFICACION_WA"
    ? (ctx.faltan.length
        ? `Conseguir, de forma natural, lo que falta: ${ctx.faltan.join(" y ")}. Cuando ya tengas disponibilidad de inicio y ciudad+zona horaria, llama a registrar_cualificacion con lo recogido y luego completar_cualificacion.`
        : "Ya tienes todo; llama a completar_cualificacion.")
    : "Acompañar al candidato en su etapa actual y resolver lo que necesite (dudas, correo, reenvíos, reprogramar).";

  return `Eres el asistente de selección de ${ctx.empresa} para el cargo "${ctx.cargo}". Hablas por WhatsApp con ${ctx.nombre}.
TONO: humano, cálido, cercano y MUY breve (1–2 frases por mensaje). Natural, como una persona real. Español. Un emoji ocasional está bien.
NUNCA suenes a bot: nada de listas numeradas, ni "(sí/no)", ni formularios. No saludes en cada mensaje si ya están conversando.

YA SABES esto del candidato (NO lo vuelvas a preguntar):
${known}

ETAPA ACTUAL: ${ctx.estado}
OBJETIVO AHORA: ${objetivo}

CONOCIMIENTO (responde dudas con esto, breve y sin sonar a folleto):
- La PRUEBA TÉCNICA se envía por CORREO, no por WhatsApp. Por aquí solo la mencionas. Si el candidato dice que no le llegó, primero verifica que el correo esté bien (puede estar mal escrito): usa actualizar_correo y luego reenviar_prueba.
- La prueba NO es remunerada/paga: es parte del proceso de selección.
- La entrevista final se agenda con un enlace (Google Calendar / Meet). Para agendar, reprogramar o si hubo no-show, usa compartir_agenda (es el mismo enlace).
- Cargo: AI and Automation Specialist en ${ctx.empresa}. 100% remoto, tiempo completo. Salario USD 1.500–2.500 al mes según experiencia. Stack: n8n, Make, Python, APIs REST/GraphQL, webhooks, LLMs, agentes, RAG; desarrollo asistido por IA (Claude Code, Codex) y spec-driven. Proceso: prueba técnica y luego entrevista final.

REGLAS:
- Si el candidato pregunta algo, respóndele con gusto y luego retoma con suavidad lo que necesitas.
- Usa las herramientas para acciones reales (no inventes que hiciste algo: ejecútalo con la tool).
- Si te piden hablar con un humano o algo se sale de tu alcance, usa escalar_humano.
- Tras una herramienta, confirma al candidato de forma natural lo que hiciste.`;
}

export async function runConversation(
  ctx: AgentCtx, history: ChatMsg[], handlers: AgentHandlers,
): Promise<string> {
  if (!API_KEY) {
    return ctx.faltan.length
      ? `Cuéntame, ${first(ctx.nombre)}: ¿desde qué ciudad trabajas y para cuándo podrías empezar?`
      : "¡Listo! Te envío la prueba al correo. 📧";
  }

  const messages: any[] = [{ role: "system", content: buildSystem(ctx) }, ...history.slice(-16)];

  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", "X-Title": "raaamp recruiting agent" },
      body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.6, max_tokens: 600 }),
    });
    if (!res.ok) { console.error("agent LLM", res.status, await res.text()); break; }
    const data = await res.json();
    const m = data?.choices?.[0]?.message;
    if (!m) break;

    if (m.tool_calls?.length) {
      messages.push(m);
      for (const tc of m.tool_calls) {
        let result = "ok";
        try {
          const args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
          const h = (handlers as any)[tc.function?.name];
          result = h ? await h(args) : `herramienta desconocida: ${tc.function?.name}`;
        } catch (e) { result = "error: " + String(e); }
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
      continue; // pedir respuesta final al modelo con los resultados
    }
    return (m.content as string) || "…";
  }
  return "Dame un momento y te confirmo 🙌";
}

function first(n: string): string { return n.split(" ")[0]; }
