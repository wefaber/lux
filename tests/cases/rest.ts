import { check, seedUserId } from "../lib/api";
import type { TestCase } from "./types";

// Rutas REST /api/v1: verbos reales, envelope {status, message, data} y códigos
// HTTP reales. Son un adaptador sobre los mismos resolvers que GraphQL, así que
// los permisos y la auditoría se comprueban igual.

type Env = { id: string; [key: string]: unknown };

const LOGS_BY = `query QaRestLogs($userId: ID, $operation: String) { activityLogs(userId: $userId, operation: $operation) { entityId operation } }`;

export const restCases: TestCase[] = [
  {
    id: "CP-REST-01",
    cu: "RNF",
    title: "CRUD completo por verbos HTTP sobre una ubicación",
    rf: [],
    kind: "positivo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Sesión de técnico.",
    steps: ["POST /locations", "GET /locations/:id", "PUT /locations/:id", "GET /locations", "DELETE /locations/:id", "GET /locations/:id"],
    expected: "201, 200, 200, 200, 200 y 404; cada respuesta trae status, message y data, y el status del cuerpo coincide con el HTTP.",
    api: async (t) => {
      const tec = await t.rest("tecnico");
      const number = 50 + Math.floor(Math.random() * 49);
      const created = await tec.expect<Env>(201, "POST", "/locations", { kind: "other", number, name: `Sala prueba ${number}` });
      check(created.body.message === "Creado", `message inesperado: ${created.body.message}`);
      const id = created.body.data.id;
      const one = await tec.expect<Env>(200, "GET", `/locations/${id}`);
      check(one.body.data.id === id, "GET por id devolvió otro recurso");
      const updated = await tec.expect<Env>(200, "PUT", `/locations/${id}`, { name: `Sala prueba ${number}B` });
      check(updated.body.data.name === `Sala prueba ${number}B`, "PUT no cambió el nombre");
      const list = await tec.expect<Env[]>(200, "GET", "/locations");
      check(Array.isArray(list.body.data) && list.body.data.some((l) => l.id === id), "la ubicación no figura en la lista");
      const removed = await tec.expect<{ id: string; deleted: boolean }>(200, "DELETE", `/locations/${id}`);
      check(removed.body.data.deleted === true && removed.body.data.id === id, "DELETE no confirmó la baja");
      const gone = await tec.expect(404, "GET", `/locations/${id}`);
      check(gone.body.code === "NOT_FOUND" && gone.body.data === null, "el 404 no trae el código NOT_FOUND");
    },
  },
  {
    id: "CP-REST-02",
    cu: "RNF",
    title: "Los códigos HTTP son reales: 400, 401, 403, 404, 405, 409 y 422",
    rf: [],
    kind: "negativo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Sesiones de solicitante y técnico.",
    steps: [
      "GET /tickets sin token",
      "GET /users como solicitante",
      "GET /tickets/inexistente",
      "PUT /loans/:id/approve dos veces",
      "POST /locations con número inválido",
      "POST /tickets con JSON roto y con un campo faltante",
      "PATCH /tickets",
    ],
    expected: "401, 403, 404, 409, 422, 400 (x2) y 405 con la cabecera Allow; todos con data nula y code del catálogo.",
    api: async (t) => {
      const anon = await t.rest();
      const sol = await t.rest("solicitante");
      const tec = await t.rest("tecnico");

      const unauth = await anon.expect(401, "GET", "/tickets");
      check(unauth.body.code === "UNAUTHENTICATED" && unauth.body.data === null, "401 sin code/data esperados");
      const denied = await sol.expect(403, "GET", "/users");
      check(denied.body.code === "FORBIDDEN", `code del 403: ${denied.body.code}`);
      await tec.expect(404, "GET", "/tickets/tkt-no-existe");

      const loan = await t.newLoan();
      await tec.expect(200, "PUT", `/loans/${loan.id}/approve`);
      const again = await tec.expect(409, "PUT", `/loans/${loan.id}/approve`);
      check(again.body.code === "CONFLICT", `code del 409: ${again.body.code}`);

      const invalid = await tec.expect(422, "POST", "/locations", { kind: "laboratory", number: 0, name: "Lab cero" });
      check(invalid.body.code === "VALIDATION_ERROR", `code del 422: ${invalid.body.code}`);

      const broken = await sol.req("POST", "/tickets", undefined, "{no es json");
      check(broken.http === 400 && broken.body.code === "BAD_REQUEST", `JSON roto: HTTP ${broken.http}`);
      await sol.expect(400, "POST", "/tickets", { title: "falta el resto" });

      const method = await sol.req("PATCH", "/tickets");
      check(method.http === 405, `PATCH /tickets: HTTP ${method.http}`);
      check((method.headers.get("allow") ?? "").includes("GET"), "el 405 no trae la cabecera Allow");
      await sol.expect(404, "GET", "/no-existe");
    },
  },
  {
    id: "CP-REST-03",
    cu: "RNF",
    title: "REST aplica los mismos permisos y auditoría que GraphQL",
    rf: ["RF-TRZ-001"],
    kind: "positivo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Sesión de solicitante.",
    steps: [
      "POST /tickets como solicitante",
      "GET /tickets como solicitante (solo ve lo suyo)",
      "PUT /loans/:id/approve como solicitante",
      "Consultar la auditoría",
    ],
    expected: "El alta deja CREATE_TICKET, la lista está acotada al dueño y la aprobación sin permiso da 403 y deja APPROVE_LOAN_DENIED.",
    api: async (t) => {
      const sol = await t.rest("solicitante");
      const created = await sol.expect<Env>(201, "POST", "/tickets", {
        title: t.tag("Alta por REST"),
        description: "Incidencia creada desde la ruta REST para verificar la auditoría.",
        category: "other",
      });
      const mine = await sol.expect<Array<{ submittedBy: { id: string } }>>(200, "GET", "/tickets");
      check(mine.body.data.every((x) => x.submittedBy.id === seedUserId("solicitante")), "el solicitante ve incidencias ajenas");

      const loan = await t.newLoan();
      await sol.expect(403, "PUT", `/loans/${loan.id}/approve`);

      const root = await t.as("root_admin");
      const made = await root.ok<{ activityLogs: { entityId: string }[] }>(LOGS_BY, { userId: seedUserId("solicitante"), operation: "CREATE_TICKET" });
      check(made.activityLogs.some((l) => l.entityId === created.body.data.id), "el alta por REST no quedó en auditoría");
      const denied = await root.ok<{ activityLogs: { entityId: string }[] }>(LOGS_BY, { userId: seedUserId("solicitante"), operation: "APPROVE_LOAN_DENIED" });
      check(denied.activityLogs.some((l) => l.entityId === loan.id), "el rechazo por permisos no quedó en auditoría");
    },
  },
  {
    id: "CP-REST-04",
    cu: "RNF",
    title: "Login, sesión, logout y bloqueo por REST",
    rf: ["RF-AUTH-001", "RF-AUTH-004", "RF-AUTH-007"],
    kind: "positivo",
    actor: "anonimo",
    priority: "alta",
    precondition: "Un usuario creado para la prueba.",
    steps: ["POST /auth/login", "GET /auth/me", "POST /auth/logout", "GET /auth/me", "Fallar el login 5 veces e intentar con la clave correcta"],
    expected: "200 con token, 200, 200, 401, y al final 429 con la cabecera Retry-After.",
    api: async (t) => {
      const user = await t.newUser();
      const anon = await t.rest();
      const login = await anon.expect<{ token: string; id: string }>(200, "POST", "/auth/login", { dni: user.dni, password: user.password });
      check(typeof login.body.data.token === "string" && login.body.data.id === user.id, "el login no devolvió token y usuario");
      const session = t.restWith(login.body.data.token);
      await session.expect(200, "GET", "/auth/me");
      await session.expect(200, "POST", "/auth/logout");
      await session.expect(401, "GET", "/auth/me");

      const wrong = await anon.expect(401, "POST", "/auth/login", { dni: user.dni, password: "incorrecta-1" });
      check(wrong.body.code === "INVALID_CREDENTIALS", `code: ${wrong.body.code}`);
      for (let i = 2; i <= 5; i++) await anon.req("POST", "/auth/login", { dni: user.dni, password: `incorrecta-${i}` });
      const locked = await anon.req("POST", "/auth/login", { dni: user.dni, password: user.password });
      check(locked.http === 429 && locked.body.code === "TOO_MANY_ATTEMPTS", `tras 5 fallos: HTTP ${locked.http}`);
      check(Number(locked.headers.get("retry-after")) > 0, "falta la cabecera Retry-After");
    },
  },
  {
    id: "CP-REST-05",
    cu: "RNF",
    title: "Transiciones de estado y bajas por REST sobre un ticket",
    rf: ["RF-TKT-002", "RF-TKT-004"],
    kind: "positivo",
    actor: "tecnico",
    priority: "media",
    precondition: "Una incidencia pendiente.",
    steps: ["PUT /tickets/:id/claim", "PUT /tickets/:id/status", "PUT /tickets/:id/complete", "DELETE /tickets/:id como administrador", "GET /tickets/unassigned"],
    expected: "Cada transición responde 200 con el ticket actualizado; el administrador lo da de baja y deja de listarse.",
    api: async (t) => {
      const id = await t.newTicket();
      const tec = await t.rest("tecnico");
      const claimed = await tec.expect<{ status: string }>(200, "PUT", `/tickets/${id}/claim`);
      check(claimed.body.data.status === "in_progress", `estado tras tomar: ${claimed.body.data.status}`);
      const moved = await tec.expect<{ status: string }>(200, "PUT", `/tickets/${id}/status`, { status: "in_resolution" });
      check(moved.body.data.status === "in_resolution", `estado: ${moved.body.data.status}`);
      const done = await tec.expect<{ status: string }>(200, "PUT", `/tickets/${id}/complete`, { diagnosis: "Cable de video flojo", corrected: true, actionsTaken: "Se reajustó el cable" });
      check(done.body.data.status === "resolved", `estado final: ${done.body.data.status}`);
      await tec.expect(409, "PUT", `/tickets/${id}/claim`);
      const admin = await t.rest("admin");
      await admin.expect(200, "DELETE", `/tickets/${id}`);
      await admin.expect(404, "GET", `/tickets/${id}`);
      const open = await tec.expect<Env[]>(200, "GET", "/tickets/unassigned");
      check(open.body.data.every((x) => x.id !== id), "la incidencia dada de baja sigue entre las sin asignar");
    },
  },
];
