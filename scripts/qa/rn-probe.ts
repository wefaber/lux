/* oxlint-disable no-await-in-loop, consistent-function-scoping */
// Sondeo de reglas de negocio y comportamientos HTTP que ningún caso de tests/cases
// verifica. Es evidencia complementaria de la matriz RN/RNF (no reemplaza a la suite).
// Solo lee y crea datos de prueba con el prefijo "[SONDEO ...]" en la base indicada.
//
//   source /home/claude/pg/env.sh lux_fs 4114   # (deja DATABASE_URL para RN-01)
//   bun scripts/qa/rn-probe.ts --target http://127.0.0.1:4114
import { ApiCtx } from "../../tests/lib/api";

const target = (process.argv.includes("--target") ? process.argv[process.argv.indexOf("--target") + 1] : "http://127.0.0.1:4114").replace(/\/$/, "");
const endpoint = `${target}/graphql`;
const t = new ApiCtx(endpoint);
const out: { id: string; resultado: "cumple" | "no cumple" | "no ejecutado"; evidencia: string }[] = [];
const rec = (id: string, ok: boolean | null, evidencia: string) => out.push({ id, resultado: ok === null ? "no ejecutado" : ok ? "cumple" : "no cumple", evidencia });

const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const CREATE = `mutation Q($input: LoanInput!) { createLoan(input: $input) { id } }`;
const APPROVE = `mutation Q($id: ID!) { approveLoan(id: $id) { id status } }`;
const DELIVER = `mutation Q($id: ID!) { deliverLoan(id: $id) { id status issueDate } }`;
const RETURN = `mutation Q($id: ID!) { returnLoan(id: $id, damaged: false) { id status issueDate actualReturnDate } }`;
const logCount = async () => {
  const root = await t.as("root_admin");
  const d = await root.ok<{ activityLogs: { id: string }[] }>(`query { activityLogs { id } }`);
  return d.activityLogs.length;
};

// RN-01: la clave se guarda como resumen con sal (argon2id) y no se expone
try {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("sin DATABASE_URL");
  const r = Bun.spawnSync(["psql", dbUrl, "-tAc", "select count(*), count(*) filter (where password_hash like '$argon2id$%') from users"]);
  const [total, argon] = r.stdout.toString().trim().split("|").map(Number);
  rec("RN-01 (almacenamiento)", total > 0 && total === argon, `users=${total}, con hash $argon2id$=${argon}`);
} catch (e) {
  rec("RN-01 (almacenamiento)", null, `no ejecutado: ${(e as Error).message}`);
}

// RN-03: todo intento de login (exitoso o fallido) queda en auditoría
{
  const before = await logCount();
  await t.anon().gql(`query { login(dni: "00000000", password: "incorrecta") { token } }`);
  await t.login("00000000", "root2026").catch(() => null);
  const after = await logCount();
  rec("RN-03 (auditoría de login)", after > before, `activity_logs antes=${before}, después de 1 login fallido y 1 exitoso=${after}`);
}

// RN-18 y RN-22/RN-23: devolución real no anterior a la entrega; vencimiento atribuido al sistema; idempotencia
{
  const product = await t.newProduct();
  const sol = await t.as("solicitante");
  const loan = await sol.ok<{ createLoan: { id: string } }>(CREATE, { input: { equipmentId: product.id, issueDate: day(-3), returnDate: day(-1) } });
  const id = loan.createLoan.id;
  await (await t.as("admin")).ok(APPROVE, { id });
  const tec = await t.as("tecnico");
  const delivered = await tec.ok<{ deliverLoan: { issueDate: string } }>(DELIVER, { id });
  const logsBefore = await logCount();
  await tec.ok(`query { loans { id status } }`);
  const first = await tec.ok<{ loan: { status: string } }>(`query Q($id: ID!) { loan(id: $id) { status } }`, { id });
  await tec.ok(`query { loans { id status } }`);
  const second = await tec.ok<{ loan: { status: string } }>(`query Q($id: ID!) { loan(id: $id) { status } }`, { id });
  const logsAfter = await logCount();
  rec("RN-23 (idempotencia del vencimiento)", first.loan.status === "overdue" && second.loan.status === "overdue", `estado tras 1ra y 2da evaluación: ${first.loan.status}, ${second.loan.status}`);
  rec("RN-22 (vencimiento atribuido al sistema en auditoría)", logsAfter > logsBefore, `activity_logs antes=${logsBefore}, después del vencimiento=${logsAfter}`);
  const ret = await tec.ok<{ returnLoan: { issueDate: string; actualReturnDate: string } }>(RETURN, { id });
  const ok = new Date(ret.returnLoan.actualReturnDate).getTime() >= new Date(delivered.deliverLoan.issueDate).getTime();
  rec("RN-18 (devolución real >= entrega)", ok, `issueDate=${ret.returnLoan.issueDate}, actualReturnDate=${ret.returnLoan.actualReturnDate} (la fecha real la fija el servidor, returnLoan no la recibe)`);
}

// HTTP: E2 prometía 401/403/400 con un código de error. GraphQL responde 200 y deja el estado en
// extensions.status; las rutas REST /api/v1 usan el código HTTP real.
{
  const raw = async (url: string, init: RequestInit) => {
    const res = await fetch(url, init);
    return { status: res.status, body: await res.text() };
  };
  const post = (body: string, token?: string) =>
    raw(endpoint, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body });
  const ext = (body: string) => {
    try {
      const e = JSON.parse(body).errors?.[0]?.extensions;
      return `${e?.code}/${e?.status}`;
    } catch {
      return "sin extensions";
    }
  };
  const sol = await t.as("solicitante");
  const noAuth = await post(JSON.stringify({ query: "{ tickets { id } }" }));
  rec("GraphQL sin sesión: HTTP 200 con extensions.code y status 401", noAuth.status === 200 && ext(noAuth.body) === "UNAUTHENTICATED/401", `http=${noAuth.status} extensions=${ext(noAuth.body)}`);
  const forbidden = await post(JSON.stringify({ query: "{ users { id } }" }), sol.token ?? undefined);
  rec("GraphQL rol sin permiso: extensions.code y status 403", ext(forbidden.body) === "FORBIDDEN/403", `http=${forbidden.status} extensions=${ext(forbidden.body)}`);
  const badJson = await post("{malformado");
  rec("GraphQL JSON inválido devuelve HTTP 400", badJson.status === 400, `status=${badJson.status}`);
  const base = `${target}/api/v1`;
  const restNoAuth = await raw(`${base}/tickets`, {});
  rec("REST sin sesión devuelve HTTP 401", restNoAuth.status === 401, `status=${restNoAuth.status} body=${restNoAuth.body.slice(0, 100)}`);
  const restForbidden = await raw(`${base}/users`, { headers: { authorization: `Bearer ${sol.token}` } });
  rec("REST rol sin permiso devuelve HTTP 403", restForbidden.status === 403, `status=${restForbidden.status}`);
  const restMissing = await raw(`${base}/tickets/tkt-no-existe`, { headers: { authorization: `Bearer ${sol.token}` } });
  rec("REST recurso inexistente devuelve HTTP 404", restMissing.status === 404, `status=${restMissing.status}`);
  const restMethod = await raw(`${base}/tickets`, { method: "PATCH", headers: { authorization: `Bearer ${sol.token}` } });
  rec("REST método no admitido devuelve HTTP 405", restMethod.status === 405, `status=${restMethod.status}`);
}

// Concurrencia: ids correlativos calculados desde un snapshot (riesgo de ID duplicado)
{
  const sol = await t.as("solicitante");
  const N = 6;
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      sol.gql<{ createTicket: { id: string } }>(`mutation Q($input: TicketInput!) { createTicket(input: $input) { id } }`, {
        input: { title: t.tag(`Sondeo concurrencia ${i}`), description: "Sondeo de creación concurrente de incidencias.", category: "other" },
      }),
    ),
  );
  const okCount = results.filter((r) => r.errors.length === 0).length;
  rec(`Concurrencia: ${N} createTicket en paralelo`, okCount === N, `exitosos=${okCount}/${N}; errores=${[...new Set(results.flatMap((r) => r.errors.map((e) => e.message)))].join(" | ") || "ninguno"}`);
}

console.log(`Sondeo contra ${endpoint}  (${new Date().toISOString()})\n`);
for (const r of out) console.log(`${r.resultado.toUpperCase().padEnd(13)} ${r.id}\n              ${r.evidencia}`);
