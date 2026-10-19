/* oxlint-disable no-await-in-loop */
// Latencia de las consultas de las vistas principales (apoyo a RNF-REND-001).
// Mide N repeticiones secuenciales por consulta contra la API y muestra mediana, p95 y máximo.
// No reemplaza una prueba en la red institucional con herramienta de benchmarking.
//
//   bun scripts/qa/latency.ts --target http://127.0.0.1:4114 --n 50
import { ApiCtx } from "../../tests/lib/api";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const target = arg("target", "http://127.0.0.1:4114").replace(/\/$/, "");
const n = Number(arg("n", "50"));
const t = new ApiCtx(`${target}/graphql`);
const admin = await t.as("admin");

const queries: Record<string, string> = {
  dashboardStats: `query { dashboardStats { openTickets } }`,
  tickets: `query { tickets { id title status } }`,
  products: `query { products { id } }`,
  loans: `query { loans { id status } }`,
  activityLogs: `query { activityLogs { id } }`,
};

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
console.log(`Latencia contra ${target}/graphql, ${n} repeticiones por consulta (${new Date().toISOString()})\n`);
console.log("consulta         mediana(ms)  p95(ms)  max(ms)");
for (const [name, q] of Object.entries(queries)) {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    await admin.ok(q);
    xs.push(performance.now() - s);
  }
  xs.sort((a, b) => a - b);
  console.log(`${name.padEnd(16)} ${pct(xs, 50).toFixed(1).padStart(10)} ${pct(xs, 95).toFixed(1).padStart(8)} ${xs[xs.length - 1].toFixed(1).padStart(8)}`);
}
