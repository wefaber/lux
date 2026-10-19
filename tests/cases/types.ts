import type { ApiCtx } from "../lib/api";

export type Role = "root_admin" | "admin" | "tecnico" | "solicitante";

// Un caso de prueba es la unidad que comparten el documento de testing, el
// runner de API y el agente de UI: mismo ID en los tres.
export interface TestCase {
  id: string; // CP-<CU>-<NN>, p. ej. CP-03-01
  cu: string; // CU-01 … CU-27, CU-R, CU-V, CU-N o RNF
  title: string;
  rf: string[]; // IDs del ERS v1.2 (RF-XXX-000 / RNF-XXX-000)
  rn?: string[]; // reglas de negocio de la planilla del CU
  kind: "positivo" | "negativo" | "limite";
  actor: Role | "anonimo" | "reloj";
  priority: "alta" | "media" | "baja";
  precondition: string;
  steps: string[];
  expected: string;
  // Desvío ya conocido entre la especificación y el código. El runner lo
  // reporta como "falla conocida" (xfail) y no rompe el pipeline; si empieza a
  // pasar, avisa para quitar la marca.
  knownGap?: string;
  // Nivel 1: verificación determinística contra la API GraphQL (costo cero).
  api?: (t: ApiCtx) => Promise<void>;
  // Nivel 2: objetivo en lenguaje natural para el agente de UI (Haiku/DeepSeek).
  ui?: UiGoal;
}

export interface UiGoal {
  as: Role;
  start: string; // ruta inicial, p. ej. /dashboard/tickets
  goal: string; // qué tiene que lograr el agente
  success: string; // qué tiene que ver en pantalla para darlo por cumplido
  // Precondición creada por API antes de abrir el navegador. Lo que devuelve
  // reemplaza {clave} en start, goal y success. Requiere la API real (no mocks).
  setup?: (t: ApiCtx) => Promise<Record<string, string>>;
  // Control determinístico del éxito: el texto visible tiene que cumplirlo para
  // aceptar el "done" del modelo (evita éxitos inventados).
  expect?: RegExp;
}

export interface CuInfo {
  id: string;
  name: string;
  actor: string;
  rf: string[];
  status: "implementado" | "parcial" | "no implementado";
  note?: string;
}

export interface DecisionTable {
  id: string;
  title: string;
  cu: string;
  conditions: string[];
  actions: string[];
  // Una regla por columna: valores de condición (S/N/-) y acciones (X o vacío).
  rules: { id: string; when: string[]; acciones: string[]; cases: string[] }[];
}
