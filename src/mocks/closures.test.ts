import { describe, expect, test } from "bun:test";
import { mockTickets } from "./data/tickets";
import { mockLoans } from "./data/loans";
import { mockServices } from "./data/services";
import { mockReservations } from "./data/reservations";
import { mockProducts } from "./data/equipment";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";
import { pinnedFirst, ticketPin } from "@/lib/pins";
import type { Ticket } from "@/lib/types";

useMockServer();

const { ADMIN, TECNICO, SOLICITANTE } = USERS;

const ACK = `mutation AcknowledgeClosure($entity: String!, $id: ID!) { acknowledgeClosure(entity: $entity, id: $id) { id } }`;

const CREATE_TICKET = `mutation CreateTicket($input: TicketInput!) { createTicket(input: $input) { id } }`;
const CLAIM_TICKET = `mutation ClaimTicket($id: ID!) { claimTicket(id: $id) { id } }`;
const CHANGE_TICKET = `mutation ChangeTicketStatus($id: ID!, $status: String!) { changeTicketStatus(id: $id, status: $status) { id } }`;
const COMPLETE_TICKET = `mutation CompleteTicket($id: ID!, $input: TicketCompleteInput!) { completeTicket(id: $id, input: $input) { id } }`;
const DONE = { diagnosis: "Fuente quemada", corrected: true, actionsTaken: "Se cambió la fuente" };

const CREATE_LOAN = `mutation CreateLoan($input: LoanInput!) { createLoan(input: $input) { id } }`;
const APPROVE_LOAN = `mutation ApproveLoan($id: ID!) { approveLoan(id: $id) { id } }`;
const DELIVER_LOAN = `mutation DeliverLoan($id: ID!) { deliverLoan(id: $id) { id } }`;
const RETURN_LOAN = `mutation ReturnLoan($id: ID!) { returnLoan(id: $id) { id } }`;

const CREATE_SERVICE = `mutation CreateServiceRequest($input: ServiceRequestInput!) { createServiceRequest(input: $input) { id } }`;
const CLAIM_SERVICE = `mutation ClaimServiceRequest($id: ID!) { claimServiceRequest(id: $id) { id } }`;
const UPDATE_SERVICE = `mutation UpdateServiceRequest($id: ID!, $input: ServiceRequestUpdateInput!) { updateServiceRequest(id: $id, input: $input) { id } }`;

const CREATE_RESERVATION = `mutation CreateReservation($input: ReservationInput!) { createReservation(input: $input) { id } }`;
const APPROVE_RESERVATION = `mutation ApproveReservation($id: ID!) { approveReservation(id: $id) { id } }`;
const CANCEL_RESERVATION = `mutation CancelReservation($id: ID!) { cancelReservation(id: $id) { id } }`;

async function claimedTicket(): Promise<string> {
  const res = await gqlAs<{ createTicket: { id: string } }>(SOLICITANTE, CREATE_TICKET, {
    input: { title: "No enciende", description: "El equipo no prende", category: "hardware" },
  });
  const id = res.data!.createTicket.id;
  expect((await gqlAs(TECNICO, CLAIM_TICKET, { id })).errors).toBeUndefined();
  return id;
}

const ticket = (id: string) => mockTickets.find((t) => t.id === id)!;

describe("aviso de cierre: lo que cerró otra persona queda fijado hasta verlo", () => {
  test("si el responsable cierra su ticket, no hay aviso", async () => {
    const id = await claimedTicket();
    expect((await gqlAs(TECNICO, COMPLETE_TICKET, { id, input: DONE })).errors).toBeUndefined();
    expect(ticket(id).closureNotice ?? null).toBeNull();
    expect(ticketPin(ticket(id), TECNICO)).toBeNull();
  });

  test("si lo resuelve otra persona, el responsable lo ve con aviso hasta marcarlo", async () => {
    const id = await claimedTicket();
    expect(ticketPin(ticket(id), TECNICO)).toBe("active");
    expect((await gqlAs(ADMIN, COMPLETE_TICKET, { id, input: DONE })).errors).toBeUndefined();
    expect(ticket(id).closureNotice?.by.id).toBe(ADMIN);
    expect(ticketPin(ticket(id), TECNICO)).toBe("notice");

    // Solo el responsable lo marca como visto
    const ajeno = await gqlAs(ADMIN, ACK, { entity: "ticket", id });
    expect(ajeno.errors?.[0].message).toBe(FORBIDDEN);
    expect((await gqlAs(TECNICO, ACK, { entity: "ticket", id })).errors).toBeUndefined();
    expect(ticket(id).closureNotice).toBeNull();
    expect(ticketPin(ticket(id), TECNICO)).toBeNull();
  });

  test("reabrir un ticket resuelto borra el aviso", async () => {
    const id = await claimedTicket();
    await gqlAs(ADMIN, COMPLETE_TICKET, { id, input: DONE });
    expect((await gqlAs(TECNICO, CHANGE_TICKET, { id, status: "in_progress" })).errors).toBeUndefined();
    expect(ticket(id).closureNotice).toBeNull();
    expect(ticketPin(ticket(id), TECNICO)).toBe("active");
  });

  test("préstamo: quien lo aprobó recibe el aviso si la devolución la registra otro", async () => {
    const free = mockProducts.find(
      (p) =>
        p.status === "available" &&
        !p.deletedAt &&
        !mockLoans.some(
          (l) => l.equipment.id === p.id && ["pending", "approved", "active", "overdue"].includes(l.status),
        ),
    )!;
    const start = Date.now() + 3_600_000;
    const created = await gqlAs<{ createLoan: { id: string } }>(SOLICITANTE, CREATE_LOAN, {
      input: {
        equipmentId: free.id,
        issueDate: new Date(start).toISOString(),
        returnDate: new Date(start + 86_400_000).toISOString(),
      },
    });
    const id = created.data!.createLoan.id;
    await gqlAs(TECNICO, APPROVE_LOAN, { id });
    await gqlAs(ADMIN, DELIVER_LOAN, { id });
    expect((await gqlAs(ADMIN, RETURN_LOAN, { id })).errors).toBeUndefined();
    const loan = mockLoans.find((l) => l.id === id)!;
    expect(loan.closureNotice?.by.id).toBe(ADMIN);
    expect((await gqlAs(TECNICO, ACK, { entity: "loan", id })).errors).toBeUndefined();
    expect(loan.closureNotice).toBeNull();
  });

  test("servicio: si lo completa otro, el técnico asignado recibe el aviso", async () => {
    const created = await gqlAs<{ createServiceRequest: { id: string } }>(
      SOLICITANTE,
      CREATE_SERVICE,
      { input: { type: "other", description: "Instalar proyector" } },
    );
    const id = created.data!.createServiceRequest.id;
    await gqlAs(TECNICO, CLAIM_SERVICE, { id });
    await gqlAs(ADMIN, UPDATE_SERVICE, { id, input: { status: "completed" } });
    expect(mockServices.find((s) => s.id === id)!.closureNotice?.by.id).toBe(ADMIN);
  });

  test("reserva: si la solicitante cancela lo que el técnico aprobó, le queda el aviso", async () => {
    const start = Date.now() + 40 * 86_400_000;
    const created = await gqlAs<{ createReservation: { id: string } }>(
      SOLICITANTE,
      CREATE_RESERVATION,
      {
        input: {
          resourceType: "location",
          locationId: "loc-2",
          purpose: "Clase de repaso",
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(start + 7_200_000).toISOString(),
        },
      },
    );
    expect(created.errors).toBeUndefined();
    const id = created.data!.createReservation.id;
    await gqlAs(TECNICO, APPROVE_RESERVATION, { id });
    await gqlAs(SOLICITANTE, CANCEL_RESERVATION, { id });
    const reservation = mockReservations.find((r) => r.id === id)!;
    expect(reservation.closureNotice?.by.id).toBe(SOLICITANTE);
    expect((await gqlAs(TECNICO, ACK, { entity: "reservation", id })).errors).toBeUndefined();
    expect(reservation.closureNotice).toBeNull();
  });
});

describe("orden de la lista", () => {
  test("los avisos sin ver primero, después lo asignado, después el resto", () => {
    const base = { status: "in_progress", closureNotice: null } as const;
    const mine = { id: "u-tec-1", name: "Nicolás" };
    const items = [
      { ...base, id: "a", assignedTo: null },
      { ...base, id: "b", assignedTo: mine },
      { ...base, id: "c", status: "resolved", assignedTo: mine, closureNotice: { by: mine, at: "" } },
    ] as unknown as Ticket[];
    const sorted = pinnedFirst(items, (t) => ticketPin(t, "u-tec-1"));
    expect(sorted.map((t) => t.id)).toEqual(["c", "b", "a"]);
  });
});
