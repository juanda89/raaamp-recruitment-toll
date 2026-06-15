# Motor de test de personalidad (Eneagrama)

`engine.ts` implementa la lógica de puntuación **forced-choice** descrita en el
PRD §9.6 y §6.3. Es código original, sin dependencias, ejecutable en Deno (Edge
Functions) y en Node.

## Cómo funciona

1. Cada ítem del banco enfrenta dos opciones; cada opción suma a un tipo del
   Eneagrama (1..9).
2. Se cuenta cuántas veces el candidato eligió cada tipo y se normaliza por el
   máximo alcanzable de ese tipo → **afinidad 0-100** por tipo (`enn_ranking`).
3. `score_personalidad` = media ponderada de las afinidades de los **tipos
   objetivo** (por defecto {1, 3, 5}, configurable en `rec_settings.tipos_objetivo`).

```ts
import { scorePersonality } from "./engine.ts";
const res = scorePersonality(questions, responses, { "1": 1, "3": 1, "5": 1 });
// res.ranking -> { "1": 100, "3": 87.5, ... }
// res.score_personalidad -> 88
```

## ⚠️ Licencia del banco de preguntas (PRD §13)

El banco incluido (`migrations/0003_seed_personality.sql`) es **placeholder** con
redacción propia y balanceado (36 ítems, cada tipo aparece 8 veces). Antes de
producción debe reemplazarse por:

- un instrumento con **licencia de uso comercial** adecuada, o
- un **cuestionario propio** validado equivalente.

La lógica de `engine.ts` es agnóstica al banco: solo necesita el mapeo
`id → (tipo_a, tipo_b)` y las respuestas.
