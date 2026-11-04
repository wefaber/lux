/* oxlint-disable no-await-in-loop */
// Rendimiento de la API: solicitudes por segundo bajo carga concurrente (apoyo a RNF de escalabilidad).
// Dispara conexiones en paralelo (hilos de Bun) contra cada escenario durante N segundos y muestra
// solicitudes/s, errores y latencia (p50, p95, p99, max).
//
//   bun scripts/qa/throughput.ts --target http://127.0.0.1:4114 --duration 10 --connections 128
//   bun scripts/qa/throughput.ts --auth                      # suma consultas con sesión y base de datos
//   bun scripts/qa/throughput.ts --only health,typename
//
// Escenarios:
//   health      GET /health, sin base de datos: techo de Elysia en esta máquina
//   typename    { __typename } por /graphql, sin base: suma Yoga y el pipeline de GraphQL
//   --auth      dashboardStats, tickets y products con token de admin: suman Postgres (carga real)
//
// Lectura de resultados: cliente y servidor comparten CPU si corren en la misma máquina, así que el
// número es una cota inferior. Para una cifra defendible, correr el cliente en otra máquina de la
// misma red (--target apuntando al servidor) y reportar hardware, red y escenario.
// En Windows, corridas seguidas agotan los puertos locales (miles de sockets en TIME_WAIT) y los
// números caen o aparecen errores: esperar un par de minutos entre corridas o usar Linux.
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

interface Scenario {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: string;
  auth?: boolean;
  graphql?: boolean;
}

interface Job {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  connections: number;
  seconds: number;
  graphql: boolean;
}

interface Result {
  ok: number;
  bad: number;
  elapsedMs: number;
  lat: Float32Array;
}

const gqlBody = (query: string) => JSON.stringify({ query });

const SCENARIOS: Scenario[] = [
  { name: "health", method: "GET", path: "/health" },
  { name: "typename", method: "POST", path: "/graphql", body: gqlBody("{ __typename }"), graphql: true },
  { name: "dashboardStats", method: "POST", path: "/graphql", body: gqlBody("{ dashboardStats { openTickets } }"), auth: true, graphql: true },
  { name: "tickets", method: "POST", path: "/graphql", body: gqlBody("{ tickets { id title status } }"), auth: true, graphql: true },
  { name: "products", method: "POST", path: "/graphql", body: gqlBody("{ products { id } }"), auth: true, graphql: true },
];

async function runWorker(): Promise<void> {
  const job = workerData as Job;
  const lat: number[] = [];
  let ok = 0;
  let bad = 0;
  const t0 = performance.now();
  const stopAt = t0 + job.seconds * 1000;
  const connection = async () => {
    while (performance.now() < stopAt) {
      const s = performance.now();
      try {
        const res = await fetch(job.url, { method: job.method, headers: job.headers, body: job.body });
        const text = await res.text();
        if (res.status === 200 && !(job.graphql && text.includes('"errors"'))) {
          ok += 1;
          lat.push(performance.now() - s);
        } else {
          bad += 1;
        }
      } catch {
        bad += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: job.connections }, connection));
  const result: Result = { ok, bad, elapsedMs: performance.now() - t0, lat: Float32Array.from(lat) };
  parentPort!.postMessage(result);
}

function round(job: Job, threads: number): Promise<Result[]> {
  const per = Math.max(1, Math.floor(job.connections / threads));
  return Promise.all(
    Array.from({ length: threads }, () =>
      new Promise<Result>((resolve, reject) => {
        const w = new Worker(import.meta.filename, { workerData: { ...job, connections: per } });
        w.once("message", resolve);
        w.once("error", reject);
      }),
    ),
  );
}

const pct = (xs: Float32Array, p: number) => xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
const num = (n: number, digits = 0) =>
  n.toLocaleString("es-UY", { minimumFractionDigits: digits, maximumFractionDigits: digits });

async function main(): Promise<void> {
  const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const target = arg("target", "http://127.0.0.1:4114").replace(/\/$/, "");
  const seconds = Number(arg("duration", "10"));
  const warmup = Number(arg("warmup", "2"));
  const connections = Number(arg("connections", "128"));
  const threads = Number(arg("threads", String(Math.max(1, Math.min(8, Math.floor(navigator.hardwareConcurrency / 2))))));
  const think = Number(arg("think", "10")); // segundos entre solicitudes de un usuario real
  const reference = Number(arg("reference", "25000"));
  const only = arg("only", "").split(",").filter(Boolean);
  const useAuth = process.argv.includes("--auth");

  let token: string | null = null;
  if (useAuth) {
    const { ApiCtx } = await import("../../tests/lib/api");
    token = (await new ApiCtx(`${target}/graphql`).as("admin")).token;
  }

  const selected = SCENARIOS.filter((s) => (only.length > 0 ? only.includes(s.name) : !s.auth || useAuth));
  console.log(
    `Throughput contra ${target} (${new Date().toISOString()})\n` +
      `${seconds}s por escenario (+${warmup}s de calentamiento), ${connections} conexiones en ${threads} hilos, ` +
      `${navigator.hardwareConcurrency} CPU lógicas en este equipo\n`,
  );
  console.log("escenario         req/s   errores   p50(ms)  p95(ms)  p99(ms)  max(ms)   % de referencia");

  const rows: { name: string; rps: number }[] = [];
  const suspect: string[] = [];
  for (const s of selected) {
    if (s.auth && !token) {
      console.log(`${s.name.padEnd(16)} requiere --auth`);
      continue;
    }
    const job: Job = {
      url: `${target}${s.path}`,
      method: s.method,
      headers: {
        ...(s.body ? { "content-type": "application/json" } : {}),
        ...(s.auth && token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: s.body,
      connections,
      seconds,
      graphql: Boolean(s.graphql),
    };
    if (warmup > 0) await round({ ...job, seconds: warmup }, threads);
    const results = await round(job, threads);
    const ok = results.reduce((a, r) => a + r.ok, 0);
    const bad = results.reduce((a, r) => a + r.bad, 0);
    const elapsed = Math.max(...results.map((r) => r.elapsedMs)) / 1000;
    const lat = new Float32Array(results.reduce((a, r) => a + r.lat.length, 0));
    let at = 0;
    for (const r of results) {
      lat.set(r.lat, at);
      at += r.lat.length;
    }
    lat.sort();
    const rps = ok / elapsed;
    rows.push({ name: s.name, rps });
    if (bad / Math.max(1, ok + bad) > 0.01) suspect.push(s.name);
    console.log(
      `${s.name.padEnd(16)} ${num(rps).padStart(7)} ${num(bad).padStart(9)} ` +
        `${num(lat.length ? pct(lat, 50) : 0, 1).padStart(9)} ${num(lat.length ? pct(lat, 95) : 0, 1).padStart(8)} ` +
        `${num(lat.length ? pct(lat, 99) : 0, 1).padStart(8)} ${num(lat.length ? lat[lat.length - 1] : 0, 1).padStart(8)} ` +
        `${num((rps / reference) * 100, 1).padStart(10)} %`,
    );
  }

  console.log(`\nReferencia: ${num(reference)} req/s. Usuarios concurrentes equivalentes (1 solicitud cada ${think} s por usuario):`);
  for (const r of rows) console.log(`  ${r.name.padEnd(16)} ~${num(r.rps * think)} usuarios`);
  if (suspect.length > 0) {
    console.log(
      `\nAtención: más de 1 % de errores en ${suspect.join(", ")}. Esos números no son confiables ` +
        `(servidor saturado o puertos locales agotados): repetir antes de citarlos.`,
    );
  }
}

if (isMainThread) await main();
else await runWorker();
