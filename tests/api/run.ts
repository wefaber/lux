// Nivel 1: ejecuta los casos con verificación de API contra un endpoint GraphQL.
// Costo cero (no usa LLM). Uso:
//   bun run qa:api --target https://dev.eternum.lat [--only CP-03] [--out tests/out]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASES } from "../cases";
import { ApiCtx, AssertionError } from "../lib/api";
import { arg } from "../lib/args";

export type Outcome = "pass" | "fail" | "xfail" | "xpass" | "error";

export interface CaseResult {
  id: string;
  cu: string;
  title: string;
  outcome: Outcome;
  ms: number;
  detail?: string;
  knownGap?: string;
}

const target = (arg("target") ?? process.env.QA_TARGET ?? "http://127.0.0.1:4111").replace(/\/$/, "");
const endpoint = target.endsWith("/graphql") ? target : `${target}/graphql`;
const only = arg("only");
const outDir = arg("out") ?? "tests/out";

const selected = CASES.filter((c) => c.api && (!only || c.id.startsWith(only) || c.cu === only));
const ctx = new ApiCtx(endpoint);
const results: CaseResult[] = [];

console.log(`QA API · ${endpoint} · ${selected.length} casos · corrida ${ctx.runId}\n`);

for (const c of selected) {
  const start = performance.now();
  let outcome: Outcome;
  let detail: string | undefined;
  try {
    await c.api!(ctx);
    outcome = c.knownGap ? "xpass" : "pass";
  } catch (error) {
    detail = (error as Error).message;
    // Un AssertionError es el sistema comportándose distinto de lo esperado.
    // Cualquier otro error es del entorno o de la suite (red, seed, credenciales).
    if (error instanceof AssertionError) outcome = c.knownGap ? "xfail" : "fail";
    else outcome = "error";
  }
  const ms = Math.round(performance.now() - start);
  results.push({ id: c.id, cu: c.cu, title: c.title, outcome, ms, detail, knownGap: c.knownGap });
  const mark = { pass: "PASS ", fail: "FAIL ", xfail: "XFAIL", xpass: "XPASS", error: "ERROR" }[outcome];
  console.log(`${mark} ${c.id.padEnd(10)} ${c.title} (${ms} ms)${detail && outcome !== "xfail" ? `\n       ${detail}` : ""}`);
}

const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
const summary = { pass: count("pass"), fail: count("fail"), xfail: count("xfail"), xpass: count("xpass"), error: count("error") };
console.log(
  `\n${summary.pass} pasan · ${summary.fail} fallan · ${summary.xfail} fallas conocidas · ${summary.xpass} conocidas que ya pasan · ${summary.error} errores de entorno`,
);

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const report = { target: endpoint, runId: ctx.runId, at: new Date().toISOString(), summary, results };
writeFileSync(join(outDir, "api-results.json"), JSON.stringify(report, null, 2));
console.log(`Reporte: ${join(outDir, "api-results.json")}`);

// El pipeline se corta por regresiones (fail), errores de entorno y por fallas
// conocidas que empezaron a pasar (hay que quitar la marca knownGap).
process.exitCode = summary.fail + summary.error + summary.xpass > 0 ? 1 : 0;
