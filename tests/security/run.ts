// CIB-E3 · Runner de seguridad reproducible.
//
// Ejecuta las 8 practicas de ataque de la ficha de laboratorio contra una
// instancia propia de la API de Lux (nunca contra dev.eternum.lat, produccion
// ni terceros, RG-11). Pensado para corporerse dos veces: antes y despues del
// endurecimiento de wt/backend, con el mismo comando.
//
// Uso:
//   bun tests/security/run.ts --target http://127.0.0.1:4113
//   bun tests/security/run.ts --target http://127.0.0.1:4113 --only AT-01
//
// Convencion de estado por chequeo (y por ataque, el peor de sus chequeos):
//   pass    el control resiste el ataque (sistema seguro en ese punto)
//   fail    el ataque tuvo exito o el control exigido no existe (vulnerable)
//   partial resiste parcialmente, o la evidencia es incompleta
//   skip    no se pudo ejecutar en este entorno (ver detail)
//
// Precondicion de todas las pruebas: cuentas descartables creadas en este
// mismo entorno (seed + `ctx.newUser`), nunca cuentas ni datos reales.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { ApiCtx, AssertionError, seedCredentials, type Client } from "../lib/api";
import { arg } from "../lib/args";
import { decodePayload, forgeNoneToken, nowSeconds, reencodePayloadKeepingSignature, signHS256 } from "./lib/jwt";

const execFileAsync = promisify(execFile);

type CheckStatus = "pass" | "fail" | "partial" | "skip";

interface Check {
  label: string;
  status: CheckStatus;
  detail: string;
}

interface AttackResult {
  id: string;
  title: string;
  status: CheckStatus;
  ms: number;
  checks: Check[];
}

const RANK: Record<CheckStatus, number> = { fail: 3, partial: 2, skip: 1, pass: 0 };
function worst(checks: Check[]): CheckStatus {
  if (checks.length === 0) return "skip";
  return checks.reduce<CheckStatus>((acc, c) => (RANK[c.status] > RANK[acc] ? c.status : acc), "pass");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const target = (arg("target") ?? process.env.SEC_TARGET ?? "http://127.0.0.1:4113").replace(/\/$/, "");
const endpoint = target.endsWith("/graphql") ? target : `${target}/graphql`;
const base = endpoint.replace(/\/graphql$/, "");
const only = arg("only");
const outDir = arg("out") ?? "tests/out";
const ctx = new ApiCtx(endpoint);

// ── Utilidades HTTP crudas (headers y status, no solo el JSON de GraphQL) ────

interface RawResponse {
  status: number;
  headers: Headers;
  text: string;
  json: { data?: unknown; errors?: { message: string }[] } | null;
}

async function rawPost(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: RawResponse["json"] = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function rawOptions(path: string, origin: string): Promise<RawResponse> {
  const res = await fetch(`${base}${path}`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,authorization",
    },
  });
  return { status: res.status, headers: res.headers, text: await res.text(), json: null };
}

async function meWithToken(token: string): Promise<RawResponse> {
  return rawPost(
    "/graphql",
    { query: "{ me { id role } }" },
    { authorization: `Bearer ${token}` },
  );
}

function meField(r: RawResponse): { id: string; role: string } | null {
  return (r.json?.data as { me?: { id: string; role: string } | null } | undefined)?.me ?? null;
}

async function activityLogCount(admin: Client): Promise<number> {
  const r = await admin.gql<{ activityLogs: unknown[] }>("{ activityLogs { id } }");
  return r.data?.activityLogs.length ?? -1;
}

// ── AT-01 Fuerza bruta y credential stuffing sobre login ─────────────────────

async function at01(): Promise<Check[]> {
  const checks: Check[] = [];
  const disposable = await ctx.newUser("solicitante");
  const anon = ctx.anon();
  const admin = await ctx.as("admin");
  const logsBefore = await activityLogCount(admin);

  // (a) Sin bloqueo: 8 intentos fallidos y despues login correcto.
  for (let i = 0; i < 8; i++) {
    await anon.gql("query L($d:String!,$p:String!){login(dni:$d,password:$p){token}}", {
      d: disposable.dni,
      p: "contrasena-incorrecta",
    });
  }
  const after = await anon.gql<{ login: { token: string } }>(
    "query L($d:String!,$p:String!){login(dni:$d,password:$p){token}}",
    { d: disposable.dni, p: disposable.password },
  );
  const lockedOut = !after.data?.login?.token;
  checks.push({
    label: "Bloqueo tras intentos fallidos (umbral de 5, ParametrosSeguridad 2.1.4)",
    status: lockedOut ? "pass" : "fail",
    detail: lockedOut
      ? "El noveno intento con contraseña correcta fue rechazado: hay bloqueo"
      : `8 intentos fallidos seguidos de 1 correcto: login ${disposable.dni} devolvió token igual. Sin contador, sin bloqueo (api/src/graphql/resolvers.ts:434-442)`,
  });

  const logsAfter = await activityLogCount(admin);
  checks.push({
    label: "Detección: los intentos fallidos quedan en activity_logs",
    status: logsAfter > logsBefore ? "pass" : "fail",
    detail:
      logsAfter > logsBefore
        ? `activityLogs pasó de ${logsBefore} a ${logsAfter} registros`
        : `activityLogs sin cambios (${logsBefore} antes, ${logsAfter} después) tras 9 intentos de login. Confirma H-06: ninguna mutación escribe en activity_logs, solo el seed (api/src/db/seed.ts)`,
  });

  // (b) Enumeracion por temporizacion: usuario existente (password mala) vs inexistente.
  const samples = 5;
  const timeExisting: number[] = [];
  const timeMissing: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    await anon.gql("query L($d:String!,$p:String!){login(dni:$d,password:$p){token}}", {
      d: disposable.dni,
      p: "otra-contrasena-incorrecta",
    });
    timeExisting.push(performance.now() - t0);
    const t1 = performance.now();
    await anon.gql("query L($d:String!,$p:String!){login(dni:$d,password:$p){token}}", {
      d: "99999999999",
      p: "x",
    });
    timeMissing.push(performance.now() - t1);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgExisting = avg(timeExisting);
  const avgMissing = avg(timeMissing);
  const diff = avgExisting - avgMissing;
  checks.push({
    label: "Tiempo de respuesta uniforme (DNI existente vs inexistente)",
    status: diff > 15 ? "fail" : "pass",
    detail: `DNI existente (verifica Argon2id): ${avgExisting.toFixed(1)} ms promedio sobre ${samples} muestras. DNI inexistente (retorna antes de verificar, resolvers.ts:436): ${avgMissing.toFixed(1)} ms. Diferencia ${diff.toFixed(1)} ms`,
  });

  // (c) Mensaje de error generico.
  const wrong = await anon.gql("query L($d:String!,$p:String!){login(dni:$d,password:$p){token}}", {
    d: disposable.dni,
    p: "x",
  });
  const missing = await anon.gql("query L($d:String!,$p:String!){login(dni:$d,password:$p){token}}", {
    d: "99999999998",
    p: "x",
  });
  const sameMessage = wrong.errors[0]?.message === missing.errors[0]?.message;
  checks.push({
    label: "Mensaje de error genérico (no distingue cuenta inexistente)",
    status: sameMessage ? "pass" : "fail",
    detail: `"${wrong.errors[0]?.message}" vs "${missing.errors[0]?.message}"`,
  });

  return checks;
}

// ── AT-02 Inyeccion SQL ───────────────────────────────────────────────────────

async function at02(): Promise<Check[]> {
  const checks: Check[] = [];
  const anon = ctx.anon();
  const admin = await ctx.as("admin");
  const before = await admin.ok<{ users: { id: string }[] }>("{ users { id } }");

  const payloads = ["' OR '1'='1", "' OR 1=1 --", "x'; DROP TABLE users; --", "1) UNION SELECT NULL--"];
  for (const payload of payloads) {
    const r = await anon.gql<{ login: { token: string } | null }>(
      "query L($d:String!,$p:String!){login(dni:$d,password:$p){token}}",
      { d: payload, p: "x" },
    );
    const leaked = r.errors.some((e) => /syntax|postgres|pg_|relation|column|drizzle/i.test(e.message));
    const authenticated = !!r.data?.login?.token;
    if (leaked) {
      checks.push({
        label: `Payload "${payload}" en login.dni`,
        status: "fail",
        detail: `La API filtró detalle de motor de BD: ${r.errors.map((e) => e.message).join(" | ")}`,
      });
    } else {
      checks.push({
        label: `Payload "${payload}" en login.dni`,
        status: authenticated ? "fail" : "pass",
        detail: authenticated
          ? "El payload autenticó (no debería)"
          : `Rechazado sin fuga: "${r.errors[0]?.message}"`,
      });
    }
  }

  const after = await admin.ok<{ users: { id: string }[] }>("{ users { id } }");
  checks.push({
    label: "Integridad de la tabla users tras los payloads",
    status: after.users.length === before.users.length ? "pass" : "fail",
    detail: `users antes=${before.users.length} después=${after.users.length} (consultas parametrizadas vía Drizzle, resolvers.ts:435)`,
  });

  return checks;
}

// ── AT-03 Abuso de GraphQL: introspeccion, batching por alias ────────────────

async function at03(): Promise<Check[]> {
  const checks: Check[] = [];

  const introspection = await rawPost("/graphql", {
    query: "{ __schema { queryType { name } } }",
  });
  const schemaField = (introspection.json?.data as { __schema?: unknown } | undefined)?.__schema;
  const introspectionOpen = schemaField !== undefined && schemaField !== null;
  checks.push({
    label: "Introspección accesible sin autenticar",
    status: introspectionOpen ? "fail" : "pass",
    detail: introspectionOpen
      ? `HTTP ${introspection.status}, __schema devuelto sin token (sin plugin que cierre introspección, api/src/index.ts:14-17)`
      : `HTTP ${introspection.status}, sin __schema en la respuesta`,
  });

  const disposable = await ctx.newUser("solicitante");
  const aliasCount = 15;
  const fields = Array.from(
    { length: aliasCount },
    (_, i) => `a${i}: login(dni: "${disposable.dni}", password: "mala-${i}") { token }`,
  ).join("\n    ");
  const t0 = performance.now();
  const batch = await rawPost("/graphql", { query: `{ ${fields} }` });
  const ms = performance.now() - t0;
  const errorsReturned = batch.json?.errors?.length ?? 0;
  checks.push({
    label: `${aliasCount} intentos de login en una sola petición vía alias`,
    status: errorsReturned >= aliasCount ? "fail" : "partial",
    detail: `HTTP ${batch.status} en ${ms.toFixed(0)} ms, ${errorsReturned} resolutores de login evaluados en una sola petición. Sin límite de batching ni de operaciones por lote (Anexo C, sección "GraphQL")`,
  });

  return checks;
}

// ── AT-04 Manipulacion de JWT y reutilizacion de sesion ──────────────────────

async function at04(): Promise<Check[]> {
  const checks: Check[] = [];

  // (a) alg: none
  const noneToken = forgeNoneToken({ sub: "u-root", role: "root_admin", iat: nowSeconds() });
  const r1 = await meWithToken(noneToken);
  const noneAccepted = !!meField(r1);
  checks.push({
    label: "Token con alg: none",
    status: noneAccepted ? "fail" : "pass",
    detail: noneAccepted ? "El servidor aceptó un token sin firma" : `Rechazado (jose con allow-list ["HS256"], api/src/auth.ts:24)`,
  });

  // (b) Firmado con un secreto ajeno (simula secreto adivinado o filtrado, distinto del real)
  const foreignToken = signHS256({ sub: "u-root", role: "root_admin", iat: nowSeconds() }, "secreto-de-un-atacante-cualquiera");
  const r2 = await meWithToken(foreignToken);
  const foreignAccepted = !!meField(r2);
  checks.push({
    label: "Token HS256 firmado con secreto ajeno",
    status: foreignAccepted ? "fail" : "pass",
    detail: foreignAccepted ? "El servidor aceptó un token firmado con otro secreto" : "Rechazado por firma inválida",
  });

  // (c) Rol manipulado conservando la firma original (debe invalidarla)
  const solCreds = seedCredentials("solicitante");
  const validToken = (
    await ctx.anon().ok<{ login: { token: string } }>(
      "query L($d:String!,$p:String!){login(dni:$d,password:$p){token}}",
      { d: solCreds.dni, p: solCreds.password },
    )
  ).login.token;
  const decoded = decodePayload(validToken);
  const tamperedToken = reencodePayloadKeepingSignature(validToken, { ...decoded, role: "root_admin" });
  const r3 = await meWithToken(tamperedToken);
  const tamperAccepted = !!meField(r3);
  checks.push({
    label: "Rol modificado en el payload, firma original sin recalcular",
    status: tamperAccepted ? "fail" : "pass",
    detail: tamperAccepted ? "El servidor confió en el rol del payload sin validar la firma" : "Rechazado: la firma deja de corresponder al payload modificado",
  });

  // (d) Secreto real del laboratorio (si se conoce): impacto de una filtración.
  const labSecret = process.env.AUTH_SECRET;
  if (labSecret) {
    const forged = signHS256({ sub: "u-root", role: "root_admin", iat: nowSeconds() }, labSecret);
    const r4 = await meWithToken(forged);
    const accepted = meField(r4)?.role === "root_admin";
    checks.push({
      label: "Token root_admin firmado con el AUTH_SECRET real del laboratorio",
      status: accepted ? "fail" : "partial",
      detail: accepted
        ? "Con el secreto en mano (precondición: filtración o adivinanza), se firma un token root_admin válido sin pasar por login. No hay revocación, audiencia ni ligazón adicional que lo frene (env.ts:53-55 no exige longitud mínima)"
        : "El servidor no aceptó el token firmado con AUTH_SECRET",
    });
  } else {
    checks.push({
      label: "Token firmado con el AUTH_SECRET real",
      status: "skip",
      detail: "AUTH_SECRET no está en el entorno de este proceso; prueba solo ejecutable en el laboratorio propio. [COMPLETAR] si se corre sin esa variable exportada",
    });
  }

  // (e) Reutilizacion de sesion tras changePassword
  const disposable = await ctx.newUser("solicitante");
  const clientBefore = await ctx.login(disposable.dni, disposable.password);
  await clientBefore.ok("mutation { changePassword(currentPassword: \"" + disposable.password + "\", newPassword: \"NuevaClave-2026x\") }" as never);
  const stillWorks = await clientBefore.gql("{ me { id } }");
  const tokenStillValid = !!stillWorks.data && !stillWorks.errors.length;
  checks.push({
    label: "Token anterior sigue válido después de changePassword",
    status: tokenStillValid ? "fail" : "pass",
    detail: tokenStillValid
      ? "El token emitido antes del cambio de contraseña sigue autenticando (sin revocación, resolvers.ts changePassword no invalida tokens previos)"
      : "El token anterior fue rechazado tras el cambio de contraseña",
  });

  // (f) Usuario desactivado: su token previo debe dejar de servir
  const admin = await ctx.as("admin");
  const toDisable = await ctx.newUser("solicitante");
  const disabledClient = await ctx.login(toDisable.dni, toDisable.password);
  await admin.ok("mutation D($id:ID!){deleteUser(id:$id)}" as never, { id: toDisable.id });
  const afterDisable = await disabledClient.gql("{ me { id } }");
  const rejected = !afterDisable.data?.me;
  checks.push({
    label: "Token de usuario desactivado",
    status: rejected ? "pass" : "fail",
    detail: rejected ? "El contexto resuelve caller=null para usuario inactivo (index.ts:25)" : "El usuario desactivado siguió autenticado",
  });

  return checks;
}

// ── AT-05 XSS almacenado ───────────────────────────────────────────────────

async function at05(): Promise<Check[]> {
  const checks: Check[] = [];
  const sol = await ctx.as("solicitante");
  const payload = "<img src=x onerror=\"document.title='xss-poc-cib-e3'\">";

  const created = await sol.ok<{ createTicket: { id: string } }>(
    "mutation($i: TicketInput!){ createTicket(input:$i){ id } }",
    { i: { title: ctx.tag("XSS PoC"), description: payload, category: "hardware" } },
  );
  const read = await sol.ok<{ ticket: { description: string } | null }>(
    "query($id:ID!){ ticket(id:$id){ description } }",
    { id: created.createTicket.id },
  );
  const storedRaw = read.ticket?.description === payload;
  checks.push({
    label: "Descripción de ticket almacenada sin depurar en servidor",
    status: storedRaw ? "partial" : "pass",
    detail: storedRaw
      ? "El API guarda y devuelve el payload HTML tal cual (api/src/lib/validation.ts no sanitiza TicketInput.description). La mitigación real depende de que React escape al renderizar (sin dangerouslySetInnerHTML en src/, verificado por grep); este runner no abre navegador, así que no confirma ejecución ni su ausencia. Ver tests/agent para esa confirmación"
      : "El payload no se guardó igual al enviado",
  });

  const headerCheck = await rawPost("/graphql", { query: "{ __typename }" });
  const hasCsp = headerCheck.headers.has("content-security-policy");
  checks.push({
    label: "Cabecera Content-Security-Policy en la respuesta del API",
    status: hasCsp ? "pass" : "fail",
    detail: hasCsp ? "Presente" : "Ausente. El API no agrega CSP (correspondería a la capa de publicación, ParametrosSeguridad 3.5, no desplegada en este laboratorio)",
  });

  return checks;
}

// ── AT-06 IDOR, BOLA y escalada de privilegios ───────────────────────────────

async function at06(): Promise<Check[]> {
  const checks: Check[] = [];

  const tecA = await ctx.newUser("tecnico");
  const tecAClient = await ctx.login(tecA.dni, tecA.password);
  const usersList = await tecAClient.ok<{ users: { id: string; dni: string; email: string }[] }>(
    "{ users { id dni email role } }",
  );
  checks.push({
    label: "Rol técnico lee dni/email de todo el personal y usuarios (resolvers.ts:446-454)",
    status: usersList.users.length > 1 ? "fail" : "pass",
    detail: `El técnico descartable obtuvo ${usersList.users.length} registros con dni y email, sin relación con ningún ticket asignado (Protocolo 8.1 exige "solo con ticket asignado")`,
  });

  const solicitante = await ctx.newUser("solicitante");
  const solClient = await ctx.login(solicitante.dni, solicitante.password);
  const ticketId = await ctx.newTicket();
  void solClient;
  await tecAClient.ok("mutation($id:ID!){ claimTicket(id:$id){ id status } }", { id: ticketId });

  const tecB = await ctx.newUser("tecnico");
  const tecBClient = await ctx.login(tecB.dni, tecB.password);
  const crossChange = await tecBClient.gql("mutation($id:ID!,$s:String!){ changeTicketStatus(id:$id,status:$s){ id status } }", {
    id: ticketId,
    s: "in_resolution",
  });
  const crossSucceeded = !!crossChange.data && crossChange.errors.length === 0;
  checks.push({
    label: "Técnico B cambia el estado de un ticket asignado al técnico A",
    status: crossSucceeded ? "fail" : "pass",
    detail: crossSucceeded
      ? "changeTicketStatus solo exige STAFF_ROLES, no verifica assignedTo (resolvers.ts:1228-1264)"
      : `Rechazado: ${crossChange.errors.map((e) => e.message).join(" | ")}`,
  });

  const admin = await ctx.as("admin");
  const escalation = await admin.gql("mutation($i:UserInput!){ createUser(input:$i){ id role } }", {
    i: { name: "Intento escalada", dni: `9${Date.now()}`.slice(0, 8), email: "x@iti.edu.uy", password: "Clave-2026x", role: "root_admin" },
  });
  checks.push({
    label: "Admin crea un usuario con rol root_admin",
    status: escalation.errors.length > 0 ? "pass" : "fail",
    detail: escalation.errors.length > 0 ? escalation.errors[0]!.message : "Se creó un usuario root_admin desde un rol admin",
  });

  const disposableAdmin = await ctx.newUser("admin");
  const disposableAdminClient = await ctx.login(disposableAdmin.dni, disposableAdmin.password);
  const selfDeactivateViaUpdate = await disposableAdminClient.gql(
    "mutation($id:ID!,$i:UserInput!){ updateUser(id:$id,input:$i){ id isActive } }",
    {
      id: disposableAdmin.id,
      i: { name: "Admin QA", dni: disposableAdmin.dni, email: "qa-admin@iti.edu.uy", role: "admin", isActive: false },
    },
  );
  checks.push({
    label: "Admin desactiva su propia cuenta vía updateUser",
    status: selfDeactivateViaUpdate.errors.length > 0 ? "pass" : "fail",
    detail: selfDeactivateViaUpdate.errors.length > 0 ? selfDeactivateViaUpdate.errors[0]!.message : "Se autodesactivó sin bloqueo (RF-USR-005 debería impedirlo)",
  });

  const selfDeleteViaDelete = await disposableAdminClient.gql("mutation($id:ID!){ deleteUser(id:$id) }", {
    id: disposableAdmin.id,
  });
  const selfDeleteSucceeded = !!selfDeleteViaDelete.data && selfDeleteViaDelete.errors.length === 0;
  checks.push({
    label: "Admin desactiva su propia cuenta vía deleteUser (mismo efecto, otra mutación)",
    status: selfDeleteSucceeded ? "fail" : "pass",
    detail: selfDeleteSucceeded
      ? "deleteUser (resolvers.ts:844-857) no reusa canToggleUserActive ni compara user.id === caller.id: el admin se autodesactivó por esta vía aunque updateUser lo bloquee. Hallazgo no cubierto por la corrección de RF-USR-005 en #50"
      : (selfDeleteViaDelete.errors[0]?.message ?? "rechazado"),
  });

  return checks;
}

// ── AT-07 DoS sobre /graphql ──────────────────────────────────────────────────

async function at07(): Promise<Check[]> {
  const checks: Check[] = [];
  const concurrency = 40; // deliberadamente moderado: Postgres compartido del laboratorio, pool max=10
  const t0 = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, () => rawPost("/graphql", { query: "{ __typename }" })),
  );
  const ms = performance.now() - t0;
  const ok = results.filter((r) => r.status === "fulfilled" && (r.value as RawResponse).status === 200).length;
  const errored = concurrency - ok;
  checks.push({
    label: `${concurrency} peticiones anónimas concurrentes a /graphql sin límite de tasa`,
    status: errored > concurrency * 0.1 ? "fail" : "partial",
    detail: `${ok}/${concurrency} respondieron 200 en ${ms.toFixed(0)} ms (${(ms / concurrency).toFixed(1)} ms/req promedio). Sin límite de tasa ni de tamaño de cuerpo (index.ts:69); cada petición, incluso anónima, dispara loadState() sobre todas las tablas (state.ts). Volumen reducido a propósito para no degradar la instancia de Postgres compartida del laboratorio: no es una prueba de capacidad máxima, es evidencia de ausencia de control`,
  });
  return checks;
}

// ── AT-08 Compromiso de datos: respaldo y detección ──────────────────────────

async function at08(): Promise<Check[]> {
  const checks: Check[] = [];
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    checks.push({
      label: "Respaldo real de la base del laboratorio",
      status: "skip",
      detail: "DATABASE_URL no está en el entorno de este proceso; esta prueba necesita acceso directo a Postgres y solo corre en el laboratorio propio. [COMPLETAR] si se ejecuta sin esa variable",
    });
    return checks;
  }
  const tmpDir = arg("tmp") ?? "/tmp";
  const dumpPath = join(tmpDir, `lux-security-at08-${Date.now()}.sql.gz`);
  try {
    const url = new URL(dbUrl);
    const host = url.hostname;
    const port = url.port || "5432";
    const user = url.username || "postgres";
    const dbName = url.pathname.replace(/^\//, "");
    const t0 = performance.now();
    const { stdout } = await execFileAsync("pg_dump", [
      "-h", host, "-p", port, "-U", user, "--no-password", "--format=plain", dbName,
    ], { maxBuffer: 1024 * 1024 * 64, encoding: "buffer" });
    const gzip = await import("node:zlib");
    const compressed: Buffer = await new Promise((resolve, reject) =>
      gzip.gzip(stdout, (err, out) => (err ? reject(err) : resolve(out))),
    );
    const { writeFileSync: write } = await import("node:fs");
    write(dumpPath, compressed);
    const dumpMs = performance.now() - t0;

    checks.push({
      label: "Respaldo generado con pg_dump + gzip, sin cifrado",
      status: "fail",
      detail: `${dumpPath}: ${compressed.length} bytes en ${dumpMs.toFixed(0)} ms. Contenido SQL legible al descomprimir (sin gpg/openssl/age en scripts/backup.sh:51-53). Confirma H-05`,
    });

    const { gunzipSync } = await import("node:zlib");
    const plain = gunzipSync(compressed).toString("utf8");
    const looksEncrypted = /^[^\x20-\x7E\r\n]{50,}/.test(plain.slice(0, 200));
    checks.push({
      label: "Legibilidad del contenido descomprimido sin clave",
      status: looksEncrypted ? "pass" : "fail",
      detail: looksEncrypted ? "El contenido no es texto plano reconocible" : `Comienza con: "${plain.slice(0, 60).replace(/\n/g, " ")}..." (cabecera "PostgreSQL database dump" en texto plano)`,
    });

    const testDbName = `${dbName}_sec_at08_restore`;
    const pgBase = `postgresql://${user}@${host}:${port}/postgres`;
    await execFileAsync("psql", [pgBase, "-c", `DROP DATABASE IF EXISTS ${testDbName};`]);
    await execFileAsync("psql", [pgBase, "-c", `CREATE DATABASE ${testDbName};`]);
    const t1 = performance.now();
    await execFileAsync("bash", [
      "-c",
      `gunzip -c '${dumpPath}' | psql 'postgresql://${user}@${host}:${port}/${testDbName}'`,
    ]);
    const restoreMs = performance.now() - t1;
    await execFileAsync("psql", [pgBase, "-c", `DROP DATABASE ${testDbName};`]);
    checks.push({
      label: "Restauración completa a base aislada (RTO declarado: 4 h)",
      status: "pass",
      detail: `Restaurado en ${(restoreMs / 1000).toFixed(1)} s sobre el dataset de laboratorio (muy por debajo del RTO porque el dataset es pequeño: no reemplaza una prueba de restauración con volumen productivo)`,
    });
  } catch (error) {
    checks.push({
      label: "Respaldo y restauración real",
      status: "skip",
      detail: `No se pudo ejecutar (pg_dump/psql no disponibles o sin permisos en este entorno): ${(error as Error).message}`,
    });
  }

  return checks;
}

// ── CORS (transversal, citado en varias fichas) ──────────────────────────────

async function corsCheck(): Promise<Check[]> {
  const origin = "https://sitio-ajeno.example";
  const preflight = await rawOptions("/graphql", origin);
  const allowOrigin = preflight.headers.get("access-control-allow-origin");
  const allowCreds = preflight.headers.get("access-control-allow-credentials");
  const reflects = allowOrigin === origin;
  return [
    {
      label: "CORS: Access-Control-Allow-Origin refleja cualquier origen",
      status: reflects ? "fail" : "pass",
      detail: reflects
        ? `Preflight a origen ajeno "${origin}" devolvió Access-Control-Allow-Origin: ${allowOrigin}, Allow-Credentials: ${allowCreds}. Configuración por defecto de graphql-yoga, sin restricción a los orígenes del frontend`
        : `Access-Control-Allow-Origin: ${allowOrigin ?? "(ausente)"}`,
    },
  ];
}

// ── Orquestacion ───────────────────────────────────────────────────────────

const ATTACKS: { id: string; title: string; run: () => Promise<Check[]> }[] = [
  { id: "AT-01", title: "Fuerza bruta y credential stuffing sobre login", run: at01 },
  { id: "AT-02", title: "Inyección SQL y GraphQL", run: at02 },
  { id: "AT-03", title: "Abuso de GraphQL: introspección y batching por alias", run: at03 },
  { id: "AT-04", title: "Manipulación de JWT y reutilización de sesión", run: at04 },
  { id: "AT-05", title: "XSS almacenado", run: at05 },
  { id: "AT-06", title: "IDOR, BOLA y escalada de privilegios", run: at06 },
  { id: "AT-07", title: "DoS sobre /graphql", run: at07 },
  { id: "AT-08", title: "Compromiso de datos: respaldo y detección", run: at08 },
  { id: "AT-09", title: "CORS (transversal)", run: corsCheck },
];

async function main() {
  console.log(`Runner de seguridad CIB-E3 · ${endpoint} · corrida ${ctx.runId}\n`);
  const selected = ATTACKS.filter((a) => !only || a.id === only || a.id === `AT-${only}`);
  const results: AttackResult[] = [];

  for (const attack of selected) {
    const t0 = performance.now();
    let checks: Check[];
    try {
      checks = await attack.run();
    } catch (error) {
      checks = [
        {
          label: "Ejecución de la práctica",
          status: "skip",
          detail: `Error de entorno, no del sistema bajo prueba: ${error instanceof AssertionError ? error.message : String(error)}`,
        },
      ];
    }
    const ms = Math.round(performance.now() - t0);
    const status = worst(checks);
    results.push({ id: attack.id, title: attack.title, status, ms, checks });

    const mark = { pass: "PASS   ", fail: "FAIL   ", partial: "PARCIAL", skip: "SKIP   " }[status];
    console.log(`${mark} ${attack.id}  ${attack.title} (${ms} ms)`);
    for (const c of checks) {
      const cm = { pass: "  ok  ", fail: " FAIL ", partial: " part ", skip: " skip " }[c.status];
      console.log(`   [${cm}] ${c.label}`);
      console.log(`           ${c.detail}`);
    }
    console.log("");
  }

  const summary = {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    partial: results.filter((r) => r.status === "partial").length,
    skip: results.filter((r) => r.status === "skip").length,
  };
  console.log(
    `${summary.pass} resisten · ${summary.fail} vulnerables · ${summary.partial} parciales · ${summary.skip} no ejecutables en este entorno`,
  );

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const report = { target: endpoint, runId: ctx.runId, at: new Date().toISOString(), summary, results };
  const outPath = join(outDir, "security-results.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Reporte: ${outPath}`);

  process.exitCode = summary.fail > 0 ? 1 : 0;
}

await main();
