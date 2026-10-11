import { describe, expect, test } from "bun:test";
import { mockNotices } from "./data/notices";
import { mockProducts } from "./data/equipment";
import { mockLoans } from "./data/loans";
import { mockUsers } from "./data/users";
import { gqlAs, useMockServer, USERS } from "@/test/graphql";
import { noticeText } from "@/components/ui/pin";
import type { Notice, NoticeEntity } from "@/lib/types";

useMockServer();

const { ADMIN, TECNICO, SOLICITANTE, OTRO_SOLICITANTE } = USERS;
const OTRO_TECNICO = "u-tec-2";

const NOTICES = `query GetNotices { notices { id userId entityType entityId kind by { id } } }`;
const ACK = `mutation AcknowledgeNotice($id: ID!) { acknowledgeNotice(id: $id) }`;
const CREATE_TICKET = `mutation CreateTicket($input: TicketInput!) { createTicket(input: $input) { id } }`;
const ASSIGN_TICKET = `mutation AssignTicket($id: ID!, $technicianId: ID!) { assignTicket(id: $id, technicianId: $technicianId) { id } }`;
const COMPLETE_TICKET = `mutation CompleteTicket($id: ID!, $input: TicketCompleteInput!) { completeTicket(id: $id, input: $input) { id } }`;
const CREATE_SERVICE = `mutation CreateServiceRequest($input: ServiceRequestInput!) { createServiceRequest(input: $input) { id } }`;
const UPDATE_SERVICE = `mutation UpdateServiceRequest($id: ID!, $input: ServiceRequestUpdateInput!) { updateServiceRequest(id: $id, input: $input) { id } }`;
const ASSIGN_SERVICE = `mutation AssignServiceRequest($id: ID!, $technicianId: ID!) { assignServiceRequest(id: $id, technicianId: $technicianId) { id } }`;
const CREATE_RESERVATION = `mutation CreateReservation($input: ReservationInput!) { createReservation(input: $input) { id } }`;
const APPROVE_RESERVATION = `mutation ApproveReservation($id: ID!) { approveReservation(id: $id) { id } }`;
const REJECT_RESERVATION = `mutation RejectReservation($id: ID!, $reason: String!) { rejectReservation(id: $id, reason: $reason) { id } }`;
const CREATE_LOAN = `mutation CreateLoan($input: LoanInput!) { createLoan(input: $input) { id } }`;
const APPROVE_LOAN = `mutation ApproveLoan($id: ID!) { approveLoan(id: $id) { id } }`;
const DELIVER_LOAN = `mutation DeliverLoan($id: ID!) { deliverLoan(id: $id) { id } }`;
const RETURN_LOAN = `mutation ReturnLoan($id: ID!) { returnLoan(id: $id) { id } }`;
const REJECT_LOAN =`mutation RejectLoan($id: ID!, $reason: String!) { rejectLoan(id: $id, reason: $reason) { id } }`;
const CLAIM_TICKET = `mutation ClaimTicket($id: ID!) { claimTicket(id: $id) { id } }`;
const CHANGE_TICKET_STATUS = `mutation ChangeTicketStatus($id: ID!, $status: String!) { changeTicketStatus(id: $id, status: $status) { id } }`;
const CLAIM_SERVICE = `mutation ClaimServiceRequest($id: ID!) { claimServiceRequest(id: $id) { id } }`;
const UPDATE_RESERVATION = `mutation UpdateReservation($id: ID!, $input: ReservationUpdateInput!) { updateReservation(id: $id, input: $input) { id } }`;
const PENDING_NEWS = `query GetPendingNews { pendingNews }`;
const MARK_SEEN = `mutation MarkPendingSeen($section: String!) { markPendingSeen(section: $section) }`;
const CREATE_COMMENT = `mutation CreateComment($input: CommentInput!) { createComment(input: $input) { id } }`;

const DONE = { diagnosis: "Fuente quemada", corrected: true, actionsTaken: "Se cambió la fuente" };

// El aviso sin ver de un usuario sobre un elemento, si hay
function noticeOf(userId: string, entityType: NoticeEntity, entityId: string) {
  return mockNotices.find(
    (n) => n.userId === userId && n.entityType === entityType && n.entityId === entityId,
  );
}

function noticesAbout(entityType: NoticeEntity, entityId: string) {
  return mockNotices.filter((n) => n.entityType === entityType && n.entityId === entityId);
}

async function newTicket(): Promise<string> {
  const res = await gqlAs<{ createTicket: { id: string } }>(SOLICITANTE, CREATE_TICKET, {
    input: { title: "No enciende", description: "El equipo no prende", category: "hardware" },
  });
  expect(res.errors).toBeUndefined();
  return res.data!.createTicket.id;
}

async function newService(): Promise<string> {
  const res = await gqlAs<{ createServiceRequest: { id: string } }>(SOLICITANTE, CREATE_SERVICE, {
    input: { type: "software_installation", description: "Instalar Python", softwareName: "Python" },
  });
  expect(res.errors).toBeUndefined();
  return res.data!.createServiceRequest.id;
}

const DAY = 86_400_000;
// Cada reserva en su propio dia, lejos de las de ejemplo y de otros tests
let day = 120;
async function newReservation(): Promise<string> {
  const start = Date.now() + day++ * DAY;
  const res = await gqlAs<{ createReservation: { id: string } }>(SOLICITANTE, CREATE_RESERVATION, {
    input: {
      resourceType: "location",
      locationId: "loc-2",
      purpose: "Clase de repaso",
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 7_200_000).toISOString(),
    },
  });
  expect(res.errors).toBeUndefined();
  return res.data!.createReservation.id;
}

describe("aviso al staff cuando le asignan algo", () => {
  test("asignar un ticket a otro le deja un aviso; tomarlo uno mismo no", async () => {
    const id = await newTicket();
    await gqlAs(ADMIN, ASSIGN_TICKET, { id, technicianId: TECNICO });
    expect(noticeOf(TECNICO, "ticket", id)).toMatchObject({ kind: "assigned" });
    expect(noticeOf(TECNICO, "ticket", id)!.by?.id).toBe(ADMIN);

    // Asignárselo a uno mismo no avisa
    await gqlAs(ADMIN, ASSIGN_TICKET, { id, technicianId: ADMIN });
    expect(noticeOf(ADMIN, "ticket", id)).toBeUndefined();
  });

  test("volver a asignar a la misma persona no repite el aviso", async () => {
    const id = await newService();
    // Aprobada antes de asignarla: otros tests cuentan las solicitudes pendientes
    // como semilla, que no tiene responsable
    await gqlAs(ADMIN, UPDATE_SERVICE, { id, input: { status: "approved" } });
    await gqlAs(ADMIN, ASSIGN_SERVICE, { id, technicianId: TECNICO });
    const notice = noticeOf(TECNICO, "service_request", id)!;
    expect(notice.kind).toBe("assigned");
    await gqlAs(TECNICO, ACK, { id: notice.id });

    await gqlAs(ADMIN, ASSIGN_SERVICE, { id, technicianId: TECNICO });
    expect(noticeOf(TECNICO, "service_request", id)).toBeUndefined();
  });
});

describe("aviso al solicitante cuando le responden", () => {
  test("ticket resuelto", async () => {
    const id = await newTicket();
    await gqlAs(ADMIN, ASSIGN_TICKET, { id, technicianId: TECNICO });
    await gqlAs(TECNICO, COMPLETE_TICKET, { id, input: DONE });
    expect(noticeOf(SOLICITANTE, "ticket", id)).toMatchObject({ kind: "resolved" });
  });

  test("solicitud aprobada y después completada: queda solo el último aviso", async () => {
    const id = await newService();
    await gqlAs(TECNICO, UPDATE_SERVICE, { id, input: { status: "approved" } });
    expect(noticeOf(SOLICITANTE, "service_request", id)).toMatchObject({ kind: "approved" });

    // Ponerla en marcha sin responsable la deja a cargo de quien lo hizo
    await gqlAs(TECNICO, UPDATE_SERVICE, { id, input: { status: "in_progress" } });
    expect(noticeOf(SOLICITANTE, "service_request", id)).toMatchObject({ kind: "taken" });

    await gqlAs(TECNICO, UPDATE_SERVICE, {
      id,
      input: { status: "completed", resolutionText: "Instalado" },
    });
    const forRequester = noticesAbout("service_request", id).filter(
      (n) => n.userId === SOLICITANTE,
    );
    expect(forRequester.map((n) => n.kind)).toEqual(["completed"]);
  });

  test("reserva aprobada o rechazada", async () => {
    const approved = await newReservation();
    await gqlAs(TECNICO, APPROVE_RESERVATION, { id: approved });
    expect(noticeOf(SOLICITANTE, "reservation", approved)).toMatchObject({ kind: "approved" });

    const rejected = await newReservation();
    await gqlAs(TECNICO, REJECT_RESERVATION, { id: rejected, reason: "Aula en obra" });
    expect(noticeOf(SOLICITANTE, "reservation", rejected)).toMatchObject({ kind: "rejected" });
  });
});

describe("avisos de préstamos", () => {
  let fixture = 0;
  async function newLoan(): Promise<string> {
    const base = mockProducts.find((p) => p.status === "available" && p.deletedAt === null)!;
    const equipmentId = `prod-notice-test-${++fixture}`;
    mockProducts.push({
      ...base,
      id: equipmentId,
      machineId: `NOTICE-TEST-${fixture}`,
      status: "available",
    });
    const created = await gqlAs<{ createLoan: { id: string } }>(SOLICITANTE, CREATE_LOAN, {
      input: {
        equipmentId,
        issueDate: new Date(Date.now() + 3_600_000).toISOString(),
        returnDate: new Date(Date.now() + 3 * DAY).toISOString(),
      },
    });
    expect(created.errors).toBeUndefined();
    return created.data!.createLoan.id;
  }

  test("el solicitante se entera si se lo aprueban, rechazan o entregan", async () => {
    const id = await newLoan();
    await gqlAs(TECNICO, APPROVE_LOAN, { id });
    expect(noticeOf(SOLICITANTE, "loan", id)).toMatchObject({ kind: "approved" });
    await gqlAs(TECNICO, DELIVER_LOAN, { id });
    expect(noticeText(noticeOf(SOLICITANTE, "loan", id)!)).toBe("Te lo entregó Nicolás Ferreira");

    const rejected = await newLoan();
    await gqlAs(TECNICO, REJECT_LOAN, { id: rejected, reason: "Equipo reservado" });
    expect(noticeOf(SOLICITANTE, "loan", rejected)).toMatchObject({ kind: "rejected" });
  });

  test("al vencer les queda un aviso del sistema a quien lo aprobó y a quien lo pidió", async () => {
    const id = await newLoan();
    await gqlAs(TECNICO, APPROVE_LOAN, { id });
    await gqlAs(TECNICO, DELIVER_LOAN, { id });
    mockLoans.find((l) => l.id === id)!.returnDate = new Date(Date.now() - 60_000).toISOString();

    // Basta con pedir los avisos: no hace falta abrir la lista de préstamos
    const res = await gqlAs<{ notices: Notice[] }>(TECNICO, NOTICES);
    const notice = res.data!.notices.find((n) => n.entityType === "loan" && n.entityId === id)!;
    expect(notice).toMatchObject({ kind: "overdue", by: null });
    expect(noticeText(notice)).toBe("Venció la fecha de devolución");
    expect(noticeOf(SOLICITANTE, "loan", id)?.kind).toBe("overdue");

    // Una sola vez por persona, aunque se vuelva a consultar
    await gqlAs(TECNICO, NOTICES);
    expect(noticesAbout("loan", id)).toHaveLength(2);

    // Al devolverlo el aviso de vencido ya no sirve: se saca a los dos
    expect((await gqlAs(TECNICO, RETURN_LOAN, { id })).errors).toBeUndefined();
    expect(noticesAbout("loan", id)).toHaveLength(0);
  });
});

describe("cambios de responsable", () => {
  test("reasignar avisa a quien lo tenía, a quien lo recibe y al solicitante", async () => {
    const id = await newTicket();
    await gqlAs(ADMIN, ASSIGN_TICKET, { id, technicianId: TECNICO });
    expect(noticeText(noticeOf(SOLICITANTE, "ticket", id)!)).toBe(
      "Ahora lo atiende Nicolás Ferreira",
    );

    await gqlAs(ADMIN, ASSIGN_TICKET, { id, technicianId: OTRO_TECNICO });
    expect(noticeText(noticeOf(TECNICO, "ticket", id)!)).toBe("Te lo sacó Marcela Rodríguez");
    expect(noticeOf(OTRO_TECNICO, "ticket", id)?.kind).toBe("assigned");
    expect(noticeOf(SOLICITANTE, "ticket", id)?.by?.id).toBe(OTRO_TECNICO);
  });

  test("a un técnico dado de baja no se le asigna un ticket ni se le avisa", async () => {
    const id = await newTicket();
    const tec3 = mockUsers.find((u) => u.id === "u-tec-3")!;
    tec3.isActive = false;
    try {
      const res = await gqlAs(ADMIN, ASSIGN_TICKET, { id, technicianId: tec3.id });
      expect(res.errors?.[0].message).toBe("No encontrado");
      expect(noticeOf(tec3.id, "ticket", id)).toBeUndefined();
    } finally {
      tec3.isActive = true;
    }
  });

  test("devolver un ticket a pendiente le avisa a quien lo tenía", async () => {
    const id = await newTicket();
    await gqlAs(TECNICO, CLAIM_TICKET, { id });
    expect(noticeOf(SOLICITANTE, "ticket", id)?.kind).toBe("taken");
    expect(noticeOf(TECNICO, "ticket", id)).toBeUndefined();

    await gqlAs(ADMIN, CHANGE_TICKET_STATUS, { id, status: "pending" });
    expect(noticeOf(TECNICO, "ticket", id)?.kind).toBe("unassigned");
  });

  test("tomar una solicitud le avisa al solicitante", async () => {
    const id = await newService();
    // Aprobada antes: otros tests cuentan las pendientes como semilla sin responsable
    await gqlAs(ADMIN, UPDATE_SERVICE, { id, input: { status: "approved" } });
    await gqlAs(TECNICO, CLAIM_SERVICE, { id });
    expect(noticeText(noticeOf(SOLICITANTE, "service_request", id)!)).toBe(
      "Ahora la atiende Nicolás Ferreira",
    );
  });
});

describe("más respuestas al solicitante", () => {
  test("ticket en resolución", async () => {
    const id = await newTicket();
    await gqlAs(TECNICO, CLAIM_TICKET, { id });
    await gqlAs(TECNICO, CHANGE_TICKET_STATUS, { id, status: "in_resolution" });
    expect(noticeText(noticeOf(SOLICITANTE, "ticket", id)!)).toBe(
      "Lo puso en resolución Nicolás Ferreira",
    );
  });

  test("reserva modificada por el staff", async () => {
    const id = await newReservation();
    await gqlAs(TECNICO, UPDATE_RESERVATION, { id, input: { purpose: "Clase de consulta" } });
    expect(noticeText(noticeOf(SOLICITANTE, "reservation", id)!)).toBe(
      "La modificó Nicolás Ferreira",
    );
  });
});

describe("pedidos pendientes nuevos para el staff", () => {
  const news = async (as: string) =>
    (await gqlAs<{ pendingNews: string[] }>(as, PENDING_NEWS)).data!.pendingNews;

  test("se marcan por sección hasta que se miran, y vuelven con un pedido nuevo", async () => {
    await gqlAs(TECNICO, MARK_SEEN, { section: "ticket" });
    expect(await news(TECNICO)).not.toContain("ticket");

    await newTicket();
    expect(await news(TECNICO)).toContain("ticket");
    // Cada uno lleva su propia marca
    await gqlAs(TECNICO, MARK_SEEN, { section: "ticket" });
    expect(await news(TECNICO)).not.toContain("ticket");
    expect(await news(ADMIN)).toContain("ticket");
  });

  test("lo que pide uno mismo no cuenta, y el solicitante no tiene", async () => {
    await gqlAs(TECNICO, MARK_SEEN, { section: "service_request" });
    await gqlAs(TECNICO, CREATE_SERVICE, {
      input: { type: "other", description: "Revisar enchufes del aula 3" },
    });
    expect(await news(TECNICO)).not.toContain("service_request");

    expect(await news(SOLICITANTE)).toEqual([]);
    expect((await gqlAs(SOLICITANTE, MARK_SEEN, { section: "ticket" })).errors).toBeDefined();
  });
});

describe("aviso de comentario nuevo a la otra parte del hilo", () => {
  test("el solicitante comenta y le llega a quien lo atiende, y viceversa", async () => {
    const id = await newTicket();
    await gqlAs(ADMIN, ASSIGN_TICKET, { id, technicianId: TECNICO });
    // Los avisos de la asignación ya se vieron
    await gqlAs(TECNICO, ACK, { id: noticeOf(TECNICO, "ticket", id)!.id });
    await gqlAs(SOLICITANTE, ACK, { id: noticeOf(SOLICITANTE, "ticket", id)!.id });

    const comment = (as: string, body: string) =>
      gqlAs(as, CREATE_COMMENT, { input: { entityType: "ticket", entityId: id, body } });

    await comment(SOLICITANTE, "¿Hay novedades?");
    expect(noticeOf(TECNICO, "ticket", id)).toMatchObject({ kind: "comment" });
    expect(noticeOf(SOLICITANTE, "ticket", id)).toBeUndefined();

    await comment(TECNICO, "Mañana lo reviso");
    expect(noticeOf(SOLICITANTE, "ticket", id)).toMatchObject({ kind: "comment" });
    expect(noticeText(noticeOf(SOLICITANTE, "ticket", id)!)).toBe(
      "Comentario nuevo de Nicolás Ferreira",
    );
  });

  test("si comenta alguien del staff que no lo atiende, les llega a los dos", async () => {
    const id = await newTicket();
    await gqlAs(ADMIN, ASSIGN_TICKET, { id, technicianId: TECNICO });
    await gqlAs(TECNICO, ACK, { id: noticeOf(TECNICO, "ticket", id)!.id });

    await gqlAs(ADMIN, CREATE_COMMENT, {
      input: { entityType: "ticket", entityId: id, body: "Ya pedí el repuesto" },
    });
    expect(noticeOf(SOLICITANTE, "ticket", id)?.kind).toBe("comment");
    expect(noticeOf(TECNICO, "ticket", id)?.kind).toBe("comment");
    expect(noticeOf(ADMIN, "ticket", id)).toBeUndefined();
  });
});

describe("ids y estados raros", () => {
  test("marcar como visto el último aviso no hace que el siguiente reuse su id", async () => {
    const first = await newTicket();
    await gqlAs(ADMIN, ASSIGN_TICKET, { id: first, technicianId: TECNICO });
    const seen = noticeOf(SOLICITANTE, "ticket", first)!;
    expect(mockNotices.at(-1)!.id).toBe(seen.id);
    await gqlAs(SOLICITANTE, ACK, { id: seen.id });

    const second = await newTicket();
    await gqlAs(TECNICO, CLAIM_TICKET, { id: second });
    expect(noticeOf(SOLICITANTE, "ticket", second)!.id).not.toBe(seen.id);
  });

  test("un estado que no es respuesta no deja aviso, aunque sea una clave de Object", async () => {
    const id = await newService();
    await gqlAs(ADMIN, UPDATE_SERVICE, { id, input: { status: "constructor" } });
    expect(noticeOf(SOLICITANTE, "service_request", id)).toBeUndefined();
    // Se devuelve a un estado valido para no ensuciar a otros tests
    await gqlAs(ADMIN, UPDATE_SERVICE, { id, input: { status: "rejected" } });
  });
});

describe("cada uno ve y marca solo sus avisos", () => {
  test("la consulta devuelve solo los propios", async () => {
    const id = await newTicket();
    await gqlAs(ADMIN, ASSIGN_TICKET, { id, technicianId: TECNICO });

    const res = await gqlAs<{ notices: Notice[] }>(OTRO_SOLICITANTE, NOTICES);
    expect(res.data!.notices.every((n) => n.userId === OTRO_SOLICITANTE)).toBe(true);
    expect(res.data!.notices.some((n) => n.entityId === id)).toBe(false);
  });
});
