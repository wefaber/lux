// Genera la sección de casos de prueba en Markdown desde la misma fuente que
// ejecutan los runners. Si existen reportes de corrida, agrega el resultado.
//   bun run qa:doc [--results tests/out] [--into <archivo.md>] [--env "descripción del entorno"]
// Con --into reemplaza el bloque entre los marcadores qa:start / qa:end del archivo.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseResult } from "../api/run";
import { CASES, CATALOG, DECISION_TABLES } from "../cases";
import type { TestCase } from "../cases/types";
import { arg } from "../lib/args";

const START = "<!-- qa:start -->";
const END = "<!-- qa:end -->";

const resultsDir = arg("results") ?? "tests/out";
const into = arg("into");
const envLabel = arg("env");

interface Report { target: string; at: string; summary: Record<string, number>; results: CaseResult[] }
function load(file: string): Report | null {
  const path = join(resultsDir, file);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Report) : null;
}
const api = load("api-results.json");
const ui = load("ui-results.json");
const byId = new Map<string, CaseResult>();
for (const r of [...(api?.results ?? []), ...(ui?.results ?? [])]) {
  const prev = byId.get(r.id);
  // Si un caso corrió en los dos niveles, gana el peor resultado.
  if (!prev || rank(r.outcome) > rank(prev.outcome)) byId.set(r.id, r);
}
function rank(o: string): number {
  return ["pass", "xpass", "xfail", "error", "fail"].indexOf(o);
}

const LABEL: Record<string, string> = {
  pass: "Pasa",
  fail: "**Falla**",
  xfail: "Desvío conocido",
  xpass: "Pasa (quitar desvío)",
  error: "Error de entorno",
};
const KIND: Record<string, string> = { positivo: "Positivo", negativo: "Negativo", limite: "Límite" };
const ACTOR: Record<string, string> = {
  root_admin: "Adm. raíz",
  admin: "Administrador",
  tecnico: "Técnico",
  solicitante: "Solicitante",
  anonimo: "Sin sesión",
  reloj: "Reloj",
};

const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const level = (c: TestCase) =>
  [c.api ? "API" : null, c.ui ? "UI-IA" : null].filter(Boolean).join(" + ") || "Manual";
function status(c: TestCase): string {
  const r = byId.get(c.id);
  if (r) return LABEL[r.outcome] ?? r.outcome;
  return c.knownGap ? "Desvío conocido" : "Sin ejecutar";
}

const out: string[] = [];
const total = CASES.length;
const automated = CASES.filter((c) => c.api || c.ui).length;
out.push(`### Resumen`, "");
out.push(`- Casos de prueba: **${total}** (${automated} automatizados, ${total - automated} manuales).`);
const conCasos = new Set(CASES.map((c) => c.cu));
const cubiertos = CATALOG.filter((u) => conCasos.has(u.id)).length;
out.push(`- Casos de uso cubiertos: **${cubiertos}** de ${CATALOG.length} (incluye CU-V, CU-N y CU-R), más los requisitos no funcionales.`);
out.push(`- Tablas de decisión: **${DECISION_TABLES.length}**.`);
if (api) {
  const s = api.summary;
  out.push(
    `- Última corrida de API (${api.at.slice(0, 16).replace("T", " ")} UTC, ${envLabel ?? `\`${api.target}\``}): ${s.pass} pasan, ${s.fail} fallan, ${s.xfail} desvíos conocidos, ${s.xpass} desvíos que ya pasan, ${s.error} errores de entorno.`,
  );
}
if (ui) {
  const s = ui.summary;
  out.push(`- Última corrida del agente de UI (${ui.at.slice(0, 16).replace("T", " ")} UTC): ${s.pass} pasan, ${s.fail} fallan, ${s.error} errores.`);
}
out.push("");

out.push(`### Matriz de trazabilidad CU → RF → casos`, "");
out.push(`| CU | Caso de uso | RF (ERS v1.2) | Implementación | Casos |`, `|---|---|---|---|---|`);
for (const cu of CATALOG) {
  const cases = CASES.filter((c) => c.cu === cu.id).map((c) => c.id);
  const impl = cu.note ? `${cu.status} — ${cu.note}` : cu.status;
  out.push(`| ${cu.id} | ${cu.name} | ${cu.rf.join(", ")} | ${cell(impl)} | ${cases.join(", ") || "—"} |`);
}
const rnf = CASES.filter((c) => c.cu === "RNF");
out.push(`| RNF | No funcionales | ${[...new Set(rnf.flatMap((c) => c.rf))].join(", ")} | — | ${rnf.map((c) => c.id).join(", ")} |`, "");

out.push(`### Casos de prueba por caso de uso`, "");
const groups = [...CATALOG.map((c) => c.id), "RNF"];
for (const cu of groups) {
  const cases = CASES.filter((c) => c.cu === cu);
  if (cases.length === 0) continue;
  const info = CATALOG.find((c) => c.id === cu);
  out.push(`#### ${cu}${info ? ` ${info.name}` : " Requisitos no funcionales"}`, "");
  out.push(`| ID | Caso | Tipo | Actor | RF / RN | Precondición | Pasos | Resultado esperado | Nivel | Estado |`);
  out.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const c of cases) {
    const refs = [...c.rf, ...(c.rn ?? [])].join(", ");
    const steps = c.steps.map((s, i) => `${i + 1}. ${s}`).join("<br>");
    out.push(
      `| ${c.id} | ${cell(c.title)} | ${KIND[c.kind] ?? c.kind} | ${ACTOR[c.actor] ?? c.actor} | ${refs || "—"} | ${cell(c.precondition)} | ${cell(steps)} | ${cell(c.expected)} | ${level(c)} | ${status(c)} |`,
    );
  }
  out.push("");
}

out.push(`### Tablas de decisión`, "");
out.push(`S = sí · N = no · - = indiferente · X = acción que se ejecuta.`, "");
for (const td of DECISION_TABLES) {
  out.push(`#### ${td.id} ${td.title} (${td.cu})`, "");
  out.push(`| | ${td.rules.map((r) => r.id).join(" | ")} |`);
  out.push(`|---|${td.rules.map(() => ":-:").join("|")}|`);
  td.conditions.forEach((cond, i) => out.push(`| ${cell(cond)} | ${td.rules.map((r) => r.when[i]).join(" | ")} |`));
  td.actions.forEach((act, i) => out.push(`| **${cell(act)}** | ${td.rules.map((r) => r.acciones[i] || " ").join(" | ")} |`));
  out.push(`| *Casos* | ${td.rules.map((r) => r.cases.join(", ")).join(" | ")} |`, "");
}

const gaps = CASES.filter((c) => c.knownGap || byId.get(c.id)?.outcome === "fail");
out.push(`### Desvíos detectados entre especificación e implementación`, "");
out.push(`| Caso | RF | Desvío |`, `|---|---|---|`);
for (const c of gaps) {
  const r = byId.get(c.id);
  const what = r?.outcome === "fail" ? `Falla: ${r.detail ?? ""}` : (c.knownGap ?? "");
  out.push(`| ${c.id} | ${c.rf.join(", ")} | ${cell(what)} |`);
}
out.push("");

const md = out.join("\n");
if (into) {
  const doc = readFileSync(into, "utf8");
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a === -1 || b === -1) throw new Error(`${into} no tiene los marcadores ${START} / ${END}`);
  writeFileSync(into, `${doc.slice(0, a + START.length)}\n\n${md}\n${doc.slice(b)}`);
  console.log(`Sección de casos actualizada en ${into}`);
} else {
  console.log(md);
}
