// =====================================================================
//  Motor de test de personalidad (Eneagrama) — PRD 9.6 y 6.3
//
//  Implementación propia inspirada en un scorer forced-choice tipo RHETI
//  (referencia conceptual: nthmost/rheti-python, MIT). Es código original;
//  el BANCO DE PREGUNTAS debe contar con licencia comercial o ser propio
//  (PRD 13). Aquí solo va la lógica de puntuación, agnóstica al banco.
//
//  Funciona en Deno (Edge Functions) y en Node/TS sin dependencias.
// =====================================================================

export const ENNEAGRAM_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type EnneagramType = (typeof ENNEAGRAM_TYPES)[number];

export const TYPE_NAMES: Record<number, string> = {
  1: "Reformador",
  2: "Ayudador",
  3: "Triunfador",
  4: "Individualista",
  5: "Investigador",
  6: "Leal",
  7: "Entusiasta",
  8: "Desafiador",
  9: "Pacificador",
};

/** Un ítem forced-choice: cada opción suma a un tipo del Eneagrama. */
export interface QuestionDef {
  id: number;
  tipo_a: number;
  tipo_b: number;
}

/** Respuesta del candidato a un ítem. */
export interface ResponseInput {
  question_id: number;
  eleccion: "A" | "B";
}

export interface PersonalityResult {
  /** Afinidad normalizada 0-100 por cada tipo (1..9). */
  ranking: Record<string, number>;
  /** Conteo crudo de elecciones por tipo. */
  raw: Record<string, number>;
  /** Tipos ordenados de mayor a menor afinidad. */
  ordenados: { tipo: number; nombre: string; afinidad: number }[];
  /** Puntaje de personalidad 0-100 ponderado hacia los tipos objetivo. */
  score_personalidad: number;
  /** Número de respuestas válidas consideradas. */
  respondidas: number;
}

/**
 * Calcula la afinidad por los 9 tipos y el `score_personalidad`.
 *
 * @param questions  Definición de los ítems (mapa id -> tipos A/B).
 * @param responses  Respuestas del candidato.
 * @param targetWeights  Pesos de los tipos objetivo, p. ej. {"1":1,"3":1,"5":1} (PRD 6.3).
 *                       Configurable para calibrar el criterio con datos reales.
 */
export function scorePersonality(
  questions: QuestionDef[],
  responses: ResponseInput[],
  targetWeights: Record<string, number> = { "1": 1, "3": 1, "5": 1 },
): PersonalityResult {
  const byId = new Map<number, QuestionDef>();
  for (const q of questions) byId.set(q.id, q);

  const raw: Record<number, number> = {};
  const maxByType: Record<number, number> = {};
  for (const t of ENNEAGRAM_TYPES) {
    raw[t] = 0;
    maxByType[t] = 0;
  }

  // Máximo alcanzable por tipo = nº de ítems donde el tipo aparece.
  for (const q of questions) {
    maxByType[q.tipo_a] = (maxByType[q.tipo_a] ?? 0) + 1;
    maxByType[q.tipo_b] = (maxByType[q.tipo_b] ?? 0) + 1;
  }

  let respondidas = 0;
  for (const r of responses) {
    const q = byId.get(r.question_id);
    if (!q) continue;
    const tipo = r.eleccion === "A" ? q.tipo_a : q.tipo_b;
    raw[tipo] = (raw[tipo] ?? 0) + 1;
    respondidas++;
  }

  // Afinidad normalizada por tipo (0-100): elecciones / máximo posible del tipo.
  const ranking: Record<string, number> = {};
  for (const t of ENNEAGRAM_TYPES) {
    const denom = maxByType[t] || 1;
    ranking[String(t)] = round1((raw[t] / denom) * 100);
  }

  const ordenados = ENNEAGRAM_TYPES
    .map((t) => ({ tipo: t, nombre: TYPE_NAMES[t], afinidad: ranking[String(t)] }))
    .sort((a, b) => b.afinidad - a.afinidad);

  // score_personalidad = media ponderada de las afinidades de los tipos objetivo.
  // (PRD 6.3: a mayor afinidad con {1,3,5}, mayor puntaje; pesos configurables.)
  let num = 0;
  let den = 0;
  for (const [tipo, peso] of Object.entries(targetWeights)) {
    const w = Number(peso) || 0;
    num += w * (ranking[tipo] ?? 0);
    den += w;
  }
  const score_personalidad = den > 0 ? Math.round(num / den) : 0;

  const rawStr: Record<string, number> = {};
  for (const t of ENNEAGRAM_TYPES) rawStr[String(t)] = raw[t];

  return { ranking, raw: rawStr, ordenados, score_personalidad, respondidas };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
