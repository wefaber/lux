import { check } from "../lib/api";
import type { TestCase } from "./types";

// CRUD completo: la baja lógica de tickets, préstamos, solicitudes, intervenciones
// y comentarios (FS, "CRUD completo de todas las tablas"). Ninguna fila se borra:
// la API deja de mostrarla y la auditoría registra la baja.

const DEL = (op: string) => `mutation QaDelete($id: ID!) { ${op}(id: $id) }`;
const LOGS = `query QaLogsOp($operation: String) { activityLogs(operation: $operation) { entityId operation } }`;
const TICKET = `query QaTicket($id: ID!) { ticket(id: $id) { id } }`;
const COMMENTS = `query QaComments($entityType: String!, $entityId: ID!) { comments(entityType: $entityType, entityId: $entityId) { id body } }`;

export const crudCases: TestCase[] = [
  {
    id: "CP-RNF-10",
    cu: "RNF",
    title: "Baja lógica de una incidencia",
    rf: [],
    kind: "positivo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Incidencia pendiente del solicitante; otra ya tomada por un técnico.",
    steps: [
      "El solicitante da de baja su incidencia pendiente",
      "Consultarla (debe dejar de verse) y revisar la auditoría",
      "El solicitante intenta dar de baja una incidencia ya tomada",
      "El administrador la da de baja",
      "Crear una incidencia nueva",
    ],
    expected: "La baja propia funciona y se audita; la tomada exige administrador; el id de la baja no se reutiliza.",
    api: async (t) => {
      const sol = await t.as("solicitante");
      const admin = await t.as("admin");
      const tec = await t.as("tecnico");

      const own = await t.newTicket();
      await sol.ok(DEL("softDeleteTicket"), { id: own });
      const gone = await sol.ok<{ ticket: unknown }>(TICKET, { id: own });
      check(gone.ticket === null, "la incidencia dada de baja sigue visible");
      const logs = await (await t.as("root_admin")).ok<{ activityLogs: { entityId: string }[] }>(LOGS, { operation: "SOFT_DELETE_TICKET" });
      check(logs.activityLogs.some((l) => l.entityId === own), "la baja no quedó en auditoría");

      const claimed = await t.newTicket();
      await tec.ok(`mutation($id: ID!) { claimTicket(id: $id) { id } }`, { id: claimed });
      await sol.failsWith(DEL("softDeleteTicket"), { id: claimed }, "FORBIDDEN", 403);
      await admin.ok(DEL("softDeleteTicket"), { id: claimed });
      await admin.failsWith(DEL("softDeleteTicket"), { id: claimed }, "NOT_FOUND", 404);

      // El id de una baja sigue ocupado: la próxima alta no lo repite.
      const next = await t.newTicket();
      check(next !== own && next !== claimed, `se reutilizó un id dado de baja: ${next}`);
    },
  },
  {
    id: "CP-RNF-11",
    cu: "RNF",
    title: "Baja lógica de un préstamo: no mientras está en curso",
    rf: [],
    kind: "negativo",
    actor: "admin",
    priority: "alta",
    precondition: "Un préstamo entregado y otro pendiente.",
    steps: [
      "El solicitante cancela su préstamo pendiente",
      "El administrador intenta dar de baja un préstamo entregado",
      "Se registra la devolución y el administrador reintenta",
    ],
    expected: "El pendiente se da de baja; el entregado responde CONFLICT; devuelto, la baja procede.",
    api: async (t) => {
      const sol = await t.as("solicitante");
      const admin = await t.as("admin");
      const tec = await t.as("tecnico");

      const pending = await t.newLoan();
      await sol.ok(DEL("softDeleteLoan"), { id: pending.id });
      const list = await sol.ok<{ loans: { id: string }[] }>(`query { loans { id } }`);
      check(!list.loans.some((l) => l.id === pending.id), "el préstamo dado de baja sigue en la lista");

      const loan = await t.newLoan();
      await tec.ok(`mutation($id: ID!) { approveLoan(id: $id) { id } }`, { id: loan.id });
      await tec.ok(`mutation($id: ID!) { deliverLoan(id: $id) { id } }`, { id: loan.id });
      await admin.failsWith(DEL("softDeleteLoan"), { id: loan.id }, "CONFLICT", 409);
      await tec.ok(`mutation($id: ID!) { returnLoan(id: $id) { id } }`, { id: loan.id });
      await admin.ok(DEL("softDeleteLoan"), { id: loan.id });
    },
  },
  {
    id: "CP-RNF-12",
    cu: "RNF",
    title: "Baja lógica de una solicitud de servicio",
    rf: [],
    kind: "positivo",
    actor: "admin",
    priority: "media",
    precondition: "Una solicitud pendiente.",
    steps: [
      "Un técnico toma la solicitud e intenta darla de baja",
      "El administrador la da de baja",
      "Listar solicitudes",
    ],
    expected: "El técnico recibe FORBIDDEN; el administrador la da de baja y deja de listarse.",
    api: async (t) => {
      const id = await t.newService();
      const tec = await t.as("tecnico");
      const admin = await t.as("admin");
      await tec.ok(`mutation($id: ID!) { claimServiceRequest(id: $id) { id } }`, { id });
      await tec.failsWith(DEL("softDeleteServiceRequest"), { id }, "FORBIDDEN", 403);
      await admin.ok(DEL("softDeleteServiceRequest"), { id });
      const list = await admin.ok<{ serviceRequests: { id: string }[] }>(`query { serviceRequests { id } }`);
      check(!list.serviceRequests.some((s) => s.id === id), "la solicitud dada de baja sigue en la lista");
    },
  },
  {
    id: "CP-RNF-13",
    cu: "RNF",
    title: "Baja lógica de intervenciones y comentarios",
    rf: [],
    kind: "positivo",
    actor: "tecnico",
    priority: "media",
    precondition: "Una intervención de un técnico y un comentario de un solicitante.",
    steps: [
      "Otro técnico intenta dar de baja la intervención",
      "Su autor la da de baja",
      "Otro solicitante intenta dar de baja el comentario",
      "Su autor lo da de baja",
    ],
    expected: "Solo el autor (o un administrador) da de baja; lo dado de baja deja de listarse.",
    api: async (t) => {
      const product = await t.newProduct();
      const tec1 = await t.as("tecnico");
      const tec2 = await t.asSeed("u-tec-2");
      const made = await tec1.ok<{ createIntervention: { id: string } }>(
        `mutation($input: InterventionInput!) { createIntervention(input: $input) { id } }`,
        { input: { equipmentId: product.id, type: "cleaning", description: t.tag("Limpieza general") } },
      );
      const iid = made.createIntervention.id;
      await tec2.failsWith(DEL("softDeleteIntervention"), { id: iid }, "FORBIDDEN", 403);
      await tec1.ok(DEL("softDeleteIntervention"), { id: iid });
      const left = await tec1.ok<{ interventions: { id: string }[] }>(
        `query($e: ID!) { interventions(equipmentId: $e) { id } }`,
        { e: product.id },
      );
      check(!left.interventions.some((i) => i.id === iid), "la intervención dada de baja sigue en la lista");

      const ticketId = await t.newTicket();
      const sol = await t.as("solicitante");
      const c = await sol.ok<{ createComment: { id: string } }>(
        `mutation($input: CommentInput!) { createComment(input: $input) { id } }`,
        { input: { entityType: "ticket", entityId: ticketId, body: t.tag("Sigue sin funcionar") } },
      );
      const other = await t.asSeed("u-sol-2");
      await other.failsWith(DEL("softDeleteComment"), { id: c.createComment.id }, "FORBIDDEN", 403);
      await sol.ok(DEL("softDeleteComment"), { id: c.createComment.id });
      const thread = await sol.ok<{ comments: { id: string }[] }>(COMMENTS, { entityType: "ticket", entityId: ticketId });
      check(!thread.comments.some((x) => x.id === c.createComment.id), "el comentario dado de baja sigue en el hilo");
    },
  },
];
