/* oxlint-disable no-await-in-loop */
// Rendimiento de la API: solicitudes por segundo bajo carga concurrente (apoyo a RNF de escalabilidad).
// Dispara conexiones en paralelo (hilos de Bun) contra cada escenario durante N segundos y muestra
// solicitudes/s, errores y latencia: p50, p95, las colas p99 / p99.9 / p99.99 (1 %, 0.1 % y 0.01 % más
// lentos) y máximo; además, mínimo / promedio / máximo por bloque de 1.000 solicitudes (ver batches.ts).
//
//   bun scripts/qa/throughput.ts --target http://127.0.0.1:4114 --duration 10 --connections 128
//   bun scripts/qa/throughput.ts --auth                      # suma consultas con sesión y base de datos
//   bun scripts/qa/throughput.ts --only health,typename
//   bun scripts/qa/throughput.ts --auth --connections 1      # costo de una solicitud, sin cola
//   --batch 500 (tamaño del bloque) · --all-batches (imprime todos) · --csv ruta.csv (guarda los bloques)
//   --role solicitante   token de otro rol (por defecto admin): el tablero del solicitante usa otro camino
//
// Escenarios (uno por endpoint):
//   health, ready  GET sin GraphQL; /ready hace un ping a la base
//   typename       { __typename } por /graphql, sin base: suma Yoga y el pipeline de GraphQL
//   --auth         con token de admin: me, dashboardStats, tickets, products (leen solo sus filas, #115)
//                  y locations, loans, serviceRequests, reports (siguen cargando la foto: control)
//
// Lectura de resultados: cliente y servidor comparten CPU si corren en la misma máquina, así que el
// número es una cota inferior. Para una cifra defendible, correr el cliente en otra máquina de la
// misma red (--target apuntando al servidor) y reportar hardware, red y escenario.
// En Windows, corridas seguidas agotan los puertos locales (miles de sockets en TIME_WAIT) y los
// números caen o aparecen errores: esperar un par de minutos entre corridas o usar Linux.
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { BATCH_SIZE, batchStats, compact, inArrivalOrder, summarize } from "./batches";
import { MIN_TAIL_SAMPLES, percentile, tailLatencies } from "./percentiles";

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
  /** Instante (ms desde 1970) en que terminó cada solicitud, en el mismo orden que `lat`. */
  ends: Float64Array;
}

const gqlBody = (query: string) => JSON.stringify({ query });

const gql = (name: string, query: string): Scenario => ({
  name,
  method: "POST",
  path: "/graphql",
  body: gqlBody(query),
  auth: true,
  graphql: true,
});

// Un escenario por endpoint. `dashboardStats`, `tickets` y `products` leen solo sus filas (issue #115);
// `loans`, `serviceRequests` y `reports` siguen cargando la foto completa y sirven de control.
const SCENARIOS: Scenario[] = [
  { name: "health", method: "GET", path: "/health" },
  { name: "ready", method: "GET", path: "/ready" },
  {
    name: "typename",
    method: "POST",
    path: "/graphql",
    body: gqlBody("{ __typename }"),
    graphql: true,
  },
  gql("me", "{ me { id } }"),
  gql("dashboardStats", "{ dashboardStats { openTickets } }"),
  gql("tickets", "{ tickets { id title status } }"),
  gql("products", "{ products { id } }"),
  gql("locations", "{ locations { id } }"),
  gql("loans", "{ loans { id status } }"),
  gql("serviceRequests", "{ serviceRequests { id status } }"),
  gql("reports", "{ reports { resolution { resolvedCount } } }"),
];

async function runWorker(): Promise<void> {
  const job = workerData as Job;
  const lat: number[] = [];
  const ends: number[] = [];
  let ok = 0;
  let bad = 0;
  const t0 = performance.now();
  const stopAt = t0 + job.seconds * 1000;
  const connection = async () => {
    while (performance.now() < stopAt) {
      const s = performance.now();
      try {
        const res = await fetch(job.url, {
          method: job.method,
          headers: job.headers,
          body: job.body,
        });
        const text = await res.text();
        if (res.status === 200 && !(job.graphql && text.includes('"errors"'))) {
          ok += 1;
          const done = performance.now();
          lat.push(done - s);
          ends.push(performance.timeOrigin + done);
        } else {
          bad += 1;
        }
      } catch {
        bad += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: job.connections }, connection));
  const result: Result = {
    ok,
    bad,
    elapsedMs: performance.now() - t0,
    lat: Float32Array.from(lat),
    ends: Float64Array.from(ends),
  };
  parentPort!.postMessage(result);
}

function round(job: Job, threads: number): Promise<Result[]> {
  const per = Math.max(1, Math.floor(job.connections / threads));
  return Promise.all(
    Array.from(
      { length: threads },
      () =>
        new Promise<Result>((resolve, reject) => {
          const w = new Worker(import.meta.filename, { workerData: { ...job, connections: per } });
          w.once("message", resolve);
          w.once("error", reject);
        }),
    ),
  );
}

const num = (n: number, digits = 0) =>
  n.toLocaleString("es-UY", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function formatBatches(
  name: string,
  blocks: ReturnType<typeof batchStats>,
  overall: ReturnType<typeof summarize>,
  all: boolean,
): string {
  if (!overall) return `${name}: sin solicitudes correctas`;
  const { shown, omitted } = all ? { shown: blocks, omitted: 0 } : compact(blocks);
  const lines = [
    `${name}: ${num(overall.count)} solicitudes · mínimo ${num(overall.min, 2)} ms · promedio ${num(overall.avg, 2)} ms · máximo ${num(overall.max, 2)} ms`,
    "  bloque  solicitudes   mín(ms)  prom(ms)   máx(ms)   prom vs total",
  ];
  for (const b of shown) {
    lines.push(
      `  ${String(b.index).padStart(6)}  ${num(b.count).padStart(10)}  ${num(b.min, 2).padStart(8)}  ${num(b.avg, 2).padStart(8)}  ` +
        `${num(b.max, 2).padStart(8)}  ${(b.avgVsTotalPct === null ? "n/d" : `${num(b.avgVsTotalPct, 1)} %`).padStart(12)}${b.partial ? "  (parcial)" : ""}`,
    );
  }
  if (omitted > 0)
    lines.push(
      `  ... ${omitted} bloques omitidos (se muestran los primeros, los últimos y el más lento; --all-batches para todos)`,
    );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const target = arg("target", "http://127.0.0.1:4114").replace(/\/$/, "");
  const seconds = Number(arg("duration", "10"));
  const warmup = Number(arg("warmup", "2"));
  const connections = Number(arg("connections", "128"));
  const threads = Number(
    arg("threads", String(Math.max(1, Math.min(8, Math.floor(navigator.hardwareConcurrency / 2))))),
  );
  const think = Number(arg("think", "10")); // segundos entre solicitudes de un usuario real
  const reference = Number(arg("reference", "25000"));
  const only = arg("only", "").split(",").filter(Boolean);
  const useAuth = process.argv.includes("--auth");
  const batchSize = Number(arg("batch", String(BATCH_SIZE))); // solicitudes por bloque
  const allBatches = process.argv.includes("--all-batches");
  const csvPath = arg("csv", "");
  const csv: string[] = ["escenario,bloque,solicitudes,min_ms,prom_ms,max_ms,prom_vs_total_pct"];
  const details: string[] = [];

  let token: string | null = null;
  if (useAuth) {
    const { ApiCtx } = await import("../../tests/lib/api");
    const role = arg("role", "admin"); // admin | tecnico | solicitante: cada rol recorre otro camino del tablero
    token = (await new ApiCtx(`${target}/graphql`).as(role as "admin")).token;
  }

  const selected = SCENARIOS.filter((s) =>
    only.length > 0 ? only.includes(s.name) : !s.auth || useAuth,
  );
  console.log(
    `Throughput contra ${target} (${new Date().toISOString()})\n` +
      `${seconds}s por escenario (+${warmup}s de calentamiento), ${connections} conexiones en ${threads} hilos, ` +
      `${navigator.hardwareConcurrency} CPU lógicas en este equipo\n`,
  );
  console.log(
    "escenario         req/s   errores   p50(ms)  p95(ms)  p99(ms) p99.9(ms) p99.99(ms)  max(ms)   % de referencia",
  );
  let insufficient = false;

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
    const total = results.reduce((a, r) => a + r.lat.length, 0);
    const lat = new Float32Array(total);
    const ends = new Float64Array(total);
    let at = 0;
    for (const r of results) {
      lat.set(r.lat, at);
      ends.set(r.ends, at);
      at += r.lat.length;
    }
    // Bloques de `batchSize` solicitudes en orden de llegada (antes de ordenar por latencia)
    const blocks = batchStats(inArrivalOrder(ends, lat), batchSize);
    const overall = summarize(lat);
    details.push(formatBatches(s.name, blocks, overall, allBatches));
    for (const b of blocks) {
      csv.push(
        [
          s.name,
          b.index,
          b.count,
          b.min.toFixed(3),
          b.avg.toFixed(3),
          b.max.toFixed(3),
          b.avgVsTotalPct?.toFixed(1) ?? "",
        ].join(","),
      );
    }
    lat.sort();
    const rps = ok / elapsed;
    rows.push({ name: s.name, rps });
    if (bad / Math.max(1, ok + bad) > 0.01) suspect.push(s.name);
    // Las colas (1 %, 0.1 %, 0.01 %) sin muestras suficientes se muestran como "n/d", no como un número engañoso.
    const ms = (v: number | null, width: number) =>
      (v === null ? "n/d" : num(v, 1)).padStart(width);
    const [p99, p999, p9999] = tailLatencies(lat);
    if (p999?.ms === null || p9999?.ms === null) insufficient = true;
    console.log(
      `${s.name.padEnd(16)} ${num(rps).padStart(7)} ${num(bad).padStart(9)} ` +
        `${ms(percentile(lat, 50), 9)} ${ms(percentile(lat, 95), 8)} ${ms(p99?.ms ?? null, 8)} ` +
        `${ms(p999?.ms ?? null, 9)} ${ms(p9999?.ms ?? null, 10)} ${ms(percentile(lat, 100), 8)} ` +
        `${num((rps / reference) * 100, 1).padStart(10)} %`,
    );
  }

  console.log(
    `\nPor bloque de ${num(batchSize)} solicitudes (en orden de llegada; "prom vs total" = promedio del bloque / promedio de toda la corrida):\n`,
  );
  for (const d of details) console.log(`${d}\n`);
  if (csvPath) {
    await Bun.write(csvPath, `${csv.join("\n")}\n`);
    console.log(`Bloques escritos en ${csvPath}`);
  }
  if (insufficient) {
    console.log(
      `\nn/d: faltan solicitudes para esa cola (se piden ${MIN_TAIL_SAMPLES} en la cola: 10 000 para p99.9, ` +
        `100 000 para p99.99). Subir --duration o --connections.`,
    );
  }
  console.log(
    `\nReferencia:${num(reference)} req/s. Usuarios concurrentes equivalentes (1 solicitud cada ${think} s por usuario):`,
  );
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
