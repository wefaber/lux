import { check } from "../lib/api";
import type { TestCase } from "./types";

// Contrato de errores y seguridad de la capa de API (Programación y Ciberseguridad, E3).
// Cada caso verifica `extensions.code` / `extensions.status` del catálogo de errores
// (docs/BACKEND.md, sección "Códigos de error").

const LOGIN = `query QaLogin($dni: String!, $password: String!) { login(dni: $dni, password: $password) { token } }`;

export const apiCases: TestCase[] = [
  {
    id: "CP-RNF-06",
    cu: "RNF",
    title: "Los errores de GraphQL traen código y status del catálogo",
    rf: ["RNF-SEG-004"],
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
    rf: ["RNF-SEG-004"],
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
    rf: ["RNF-SEG-004"],
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
];
