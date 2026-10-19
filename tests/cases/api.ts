import { check, seedUserId } from "../lib/api";
import type { TestCase } from "./types";

// Contrato de errores y seguridad de la capa de API (Programación y Ciberseguridad, E3).
// Cada caso verifica `extensions.code` / `extensions.status` del catálogo de errores
// (docs/BACKEND.md, sección "Códigos de error").

const LOGIN = `query QaLogin($dni: String!, $password: String!) { login(dni: $dni, password: $password) { token } }`;

const LOGS_BY = `query QaLogsBy($userId: ID, $operation: String) { activityLogs(userId: $userId, operation: $operation) { id userId entity entityId operation timestamp } }`;

interface LogRow {
  id: string;
  userId: string;
  entity: string;
  entityId: string;
  operation: string;
  timestamp: string;
}

export const apiCases: TestCase[] = [
  {
    id: "CP-RNF-06",
    cu: "RNF",
    title: "Los errores de GraphQL traen código y status del catálogo",
    rf: [],
    kind: "negativo",
    actor: "anonimo",
    priority: "alta",
    precondition: "Ninguna.",
    steps: [
      "Consultar usuarios sin token",
      "Consultar usuarios como solicitante",
      "Operar sobre un ticket inexistente",
      "Iniciar sesión con una contraseña incorrecta",
      "Enviar una operación sin una variable obligatoria",
    ],
    expected: "UNAUTHENTICATED/401, FORBIDDEN/403, NOT_FOUND/404, INVALID_CREDENTIALS/401 y BAD_REQUEST/400.",
    api: async (t) => {
      const users = `query { users { id } }`;
      await t.anon().failsWith(users, {}, "UNAUTHENTICATED", 401);
      await (await t.as("solicitante")).failsWith(users, {}, "FORBIDDEN", 403);
      await (await t.as("tecnico")).failsWith(
        `mutation { claimTicket(id: "tkt-no-existe") { id } }`,
        {},
        "NOT_FOUND",
        404,
      );
      await t.anon().failsWith(LOGIN, { dni: "99999991", password: "x" }, "INVALID_CREDENTIALS", 401);
      await t.anon().failsWith(LOGIN, {}, "BAD_REQUEST", 400);
    },
  },
  {
    id: "CP-RNF-07",
    cu: "RNF",
    title: "Validación y conflicto de estado se distinguen por código",
    rf: [],
    kind: "negativo",
    actor: "tecnico",
    priority: "media",
    precondition: "Equipo disponible y solicitante.",
    steps: [
      "Crear una ubicación con número inválido",
      "Crear y aprobar un préstamo",
      "Aprobar de nuevo el mismo préstamo",
    ],
    expected: "VALIDATION_ERROR/422 para el dato inválido y CONFLICT/409 para la transición que choca con el estado.",
    api: async (t) => {
      const tec = await t.as("tecnico");
      await tec.failsWith(
        `mutation { createLocation(input: { kind: "laboratory", number: 0, name: "Lab cero" }) { id } }`,
        {},
        "VALIDATION_ERROR",
        422,
      );
      const eq = await t.newProduct();
      const sol = await t.as("solicitante");
      const day = 24 * 3600 * 1000;
      const loan = await sol.ok<{ createLoan: { id: string } }>(
        `mutation($input: LoanInput!) { createLoan(input: $input) { id } }`,
        { input: { equipmentId: eq.id, issueDate: new Date(Date.now() + day).toISOString(), returnDate: new Date(Date.now() + 2 * day).toISOString() } },
      );
      const approve = `mutation($id: ID!) { approveLoan(id: $id) { id status } }`;
      await tec.ok(approve, { id: loan.createLoan.id });
      await tec.failsWith(approve, { id: loan.createLoan.id }, "CONFLICT", 409);
    },
  },
  {
    id: "CP-RNF-08",
    cu: "RNF",
    title: "/ready no expone detalles de la infraestructura",
    rf: [],
    kind: "negativo",
    actor: "anonimo",
    priority: "media",
    precondition: "Ninguna.",
    steps: ["Pedir /ready", "Revisar que la respuesta no incluya tablas ni texto del motor"],
    expected: "La respuesta solo trae status y ok.",
    api: async (t) => {
      const res = await fetch(new URL("/ready", t.endpoint));
      const body = (await res.json()) as Record<string, unknown>;
      check(res.status === 200, `/ready respondió ${res.status}`);
      const keys = Object.keys(body).sort().join(",");
      check(keys === "ok,status", `/ready expone campos de más: ${keys}`);
    },
  },
  {
    id: "CP-R-02",
    cu: "CU-R",
    title: "La traza guarda quién, qué, sobre qué entidad y cuándo",
    rf: ["RF-TRZ-001", "RF-TRZ-002"],
    kind: "positivo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Una incidencia pendiente.",
    steps: ["Tomar la incidencia como técnico", "Consultar la auditoría filtrada por ese usuario y operación"],
    expected: "Existe CLAIM_TICKET sobre la entidad Ticket con el id de la incidencia, el usuario que la tomó y una marca de tiempo reciente.",
    api: async (t) => {
      const id = await t.newTicket();
      const tec = await t.as("tecnico");
      await tec.ok(`mutation($id: ID!) { claimTicket(id: $id) { id } }`, { id });
      const root = await t.as("root_admin");
      const d = await root.ok<{ activityLogs: LogRow[] }>(LOGS_BY, { userId: seedUserId("tecnico"), operation: "CLAIM_TICKET" });
      const row = d.activityLogs.find((l) => l.entityId === id);
      check(row, "CLAIM_TICKET no quedó en auditoría");
      check(row.entity === "Ticket", `entidad inesperada: ${row.entity}`);
      check(row.userId === seedUserId("tecnico"), `usuario inesperado: ${row.userId}`);
      check(Date.now() - Date.parse(row.timestamp) < 60_000, "la marca de tiempo no es reciente");
    },
  },
  {
    id: "CP-R-03",
    cu: "CU-R",
    title: "Un intento sin permiso queda registrado como rechazado",
    rf: ["RF-TRZ-001"],
    kind: "negativo",
    actor: "solicitante",
    priority: "media",
    precondition: "Sesión de solicitante.",
    steps: ["Intentar crear un usuario como solicitante", "Consultar la auditoría como raíz"],
    expected: "La operación se rechaza con FORBIDDEN y la auditoría tiene CREATE_USER_DENIED a nombre del solicitante.",
    api: async (t) => {
      const sol = await t.as("solicitante");
      await sol.failsWith(
        `mutation($input: UserInput!) { createUser(input: $input) { id } }`,
        { input: { name: "Intruso", dni: "10000000", email: "x@iti.edu.uy", role: "admin" } },
        "FORBIDDEN",
        403,
      );
      const root = await t.as("root_admin");
      const d = await root.ok<{ activityLogs: LogRow[] }>(LOGS_BY, { userId: seedUserId("solicitante"), operation: "CREATE_USER_DENIED" });
      check(d.activityLogs.length > 0, "el intento rechazado no quedó en auditoría");
    },
  },
  {
    id: "CP-R-04",
    cu: "CU-R",
    title: "Una operación que falla no deja traza ni cambios",
    rf: ["RF-TRZ-001"],
    kind: "negativo",
    actor: "tecnico",
    priority: "media",
    precondition: "Un préstamo ya aprobado.",
    steps: ["Aprobar de nuevo el préstamo (conflicto)", "Contar las filas APPROVE_LOAN de ese préstamo"],
    expected: "Hay exactamente una fila APPROVE_LOAN: la del primer éxito.",
    api: async (t) => {
      const tec = await t.as("tecnico");
      const eq = await t.newProduct();
      const day = 24 * 3600 * 1000;
      const sol = await t.as("solicitante");
      const loan = await sol.ok<{ createLoan: { id: string } }>(
        `mutation($input: LoanInput!) { createLoan(input: $input) { id } }`,
        { input: { equipmentId: eq.id, issueDate: new Date(Date.now() + day).toISOString(), returnDate: new Date(Date.now() + 2 * day).toISOString() } },
      );
      const approve = `mutation($id: ID!) { approveLoan(id: $id) { id } }`;
      await tec.ok(approve, { id: loan.createLoan.id });
      await tec.fails(approve, { id: loan.createLoan.id });
      const root = await t.as("root_admin");
      const d = await root.ok<{ activityLogs: LogRow[] }>(LOGS_BY, { operation: "APPROVE_LOAN" });
      const rows = d.activityLogs.filter((l) => l.entityId === loan.createLoan.id);
      check(rows.length === 1, `se esperaba 1 fila APPROVE_LOAN y hay ${rows.length}`);
    },
  },
  {
    id: "CP-RNF-09",
    cu: "RNF",
    title: "Altas concurrentes no repiten identificador",
    rf: [],
    kind: "limite",
    actor: "solicitante",
    priority: "alta",
    precondition: "Sesión de solicitante.",
    steps: ["Crear 8 incidencias a la vez", "Comparar los identificadores devueltos"],
    expected: "Las 8 se crean y los identificadores son distintos (las mutaciones se serializan).",
    api: async (t) => {
      const sol = await t.as("solicitante");
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          sol.gql<{ createTicket: { id: string } }>(
            `mutation($input: TicketInput!) { createTicket(input: $input) { id } }`,
            { input: { title: t.tag(`Concurrente ${i}`), description: "Alta concurrente para verificar que no se repite el identificador.", category: "other" } },
          ),
        ),
      );
      const failed = results.filter((r) => r.errors.length > 0);
      check(failed.length === 0, `fallaron ${failed.length} altas: ${failed[0]?.errors[0]?.message}`);
      const ids = results.map((r) => r.data!.createTicket.id);
      check(new Set(ids).size === ids.length, `identificadores repetidos: ${ids.join(", ")}`);
    },
  },
  {
    id: "CP-RNF-14",
    cu: "RNF",
    title: "Referencias y valores de lista cerrada se validan (FK y CHECK en la base)",
    rf: [],
    kind: "negativo",
    actor: "solicitante",
    priority: "media",
    precondition: "Sesiones de solicitante y técnico.",
    steps: [
      "Crear una incidencia con un equipo inexistente",
      "Crear una incidencia con una categoría inválida",
      "Crear un componente de un equipo inexistente",
      "Crear una solicitud de servicio de un tipo inválido",
    ],
    expected: "VALIDATION_ERROR/422 en los cuatro casos, con un mensaje propio (no el de la restricción de la base).",
    api: async (t) => {
      const sol = await t.as("solicitante");
      const tec = await t.as("tecnico");
      const ticket = `mutation($input: TicketInput!) { createTicket(input: $input) { id } }`;
      const base = { title: t.tag("Referencia"), description: "Incidencia para probar la validación de referencias.", category: "other" };
      const e1 = await sol.failsWith(ticket, { input: { ...base, equipmentId: "prod-no-existe" } }, "VALIDATION_ERROR", 422);
      check(!/constraint|violates|foreign/i.test(e1.message), `el mensaje filtra la restricción: ${e1.message}`);
      await sol.failsWith(ticket, { input: { ...base, category: "magia" } }, "VALIDATION_ERROR", 422);
      await tec.failsWith(
        `mutation($input: ComponentInput!) { createComponent(input: $input) { id } }`,
        { input: { name: "Disco", model: "M1", manufacturer: "Acme", serialNumber: "SN123456", partNumber: "PN123456", isFactory: true, isWorking: true, productId: "prod-no-existe" } },
        "VALIDATION_ERROR",
        422,
      );
      await sol.failsWith(
        `mutation($input: ServiceRequestInput!) { createServiceRequest(input: $input) { id } }`,
        { input: { type: "hechizo", description: "Tipo que no existe en la lista cerrada." } },
        "VALIDATION_ERROR",
        422,
      );
    },
  },
];
