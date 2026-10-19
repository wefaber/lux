// Nivel 3: borradores de issues para cada caso que falló (y con --gaps, también
// para los desvíos conocidos). No publica nada: deja un .md por caso en
// tests/out/issues/ para revisarlo y abrirlo a mano con `gh issue create -F`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseResult } from "../api/run";
import { CASES } from "../cases";
import { arg, flag } from "../lib/args";

const dir = arg("results") ?? "tests/out";
const gaps = flag("gaps");
const outDir = join(dir, "issues");

interface Report { target: string; at: string; results: CaseResult[] }
const reports = ["api-results.json", "ui-results.json"]
  .map((f) => join(dir, f))
  .filter(existsSync)
  .map((p) => ({ level: p.includes("ui-") ? "UI" : "API", ...(JSON.parse(readFileSync(p, "utf8")) as Report) }));

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
let written = 0;
for (const report of reports) {
  for (const r of report.results) {
    if (!(r.outcome === "fail" || r.outcome === "error" || (gaps && r.outcome === "xfail"))) continue;
    const c = CASES.find((x) => x.id === r.id);
    if (!c) continue;
    const kind = r.outcome === "xfail" ? "Desvío conocido" : r.outcome === "error" ? "Error de entorno" : "Defecto";
    const shot = report.level === "UI" ? `\n**Captura:** \`tests/out/ui/${c.id}.png\` (adjuntar)\n` : "";
    const body = `## ${kind}: ${c.title}

**Caso:** ${c.id} · **Caso de uso:** ${c.cu} · **Requisitos:** ${[...c.rf, ...(c.rn ?? [])].join(", ")}
**Nivel:** ${report.level} · **Entorno:** ${report.target} · **Corrida:** ${report.at}

### Precondición
${c.precondition}

### Pasos
${c.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

### Resultado esperado
${c.expected}

### Resultado obtenido
${r.outcome === "xfail" ? (c.knownGap ?? "") : (r.detail ?? "sin detalle")}
${shot}
### Cómo reproducir
\`bun run qa:${report.level === "UI" ? "agent" : "api"} --only ${c.id}\`
`;
    writeFileSync(join(outDir, `${report.level.toLowerCase()}-${c.id}.md`), body);
    written++;
  }
}
console.log(`${written} borradores en ${outDir}`);
