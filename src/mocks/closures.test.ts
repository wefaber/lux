import { describe, expect, test } from "bun:test";
import { mockTickets } from "./data/tickets";
import { mockReservations } from "./data/reservations";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";
import { idQuery, pinnedFirst, reservationPin, ticketPin } from "@/lib/pins";
import type { Reservation } from "@/lib/types";

useMockServer();

const { ADMIN, TECNICO, SOLICITANTE } = USERS;

const CREATE_TICKET = `mutation CreateTicket($input: TicketInput!) { createTicket(input: $input) { id } }`;
const CLAIM_TICKET = `mutation ClaimTicket($id: ID!) { claimTicket(id: $id) { id } }`;
const COMPLETE_TICKET = `mutation CompleteTicket($id: ID!, $input: TicketCompleteInput!) { completeTicket(id: $id, input: $input) { id } }`;
const DONE = { diagnosis: "Fuente quemada", corrected: true, actionsTaken: "Se cambió la fuente" };

const CREATE_RESERVATION = `mutation CreateReservation($input: ReservationInput!) { createReservation(input: $input) { id } }`;
const APPROVE_RESERVATION = `mutation ApproveReservation($id: ID!) { approveReservation(id: $id) { id } }`;
const CANCEL_RESERVATION = `mutation CancelReservation($id: ID!) { cancelReservation(id: $id) { id } }`;
const ACK = `mutation AcknowledgeReservationCancellation($id: ID!) { acknowledgeReservationCancellation(id: $id) { id } }`;

const DAY = 86_400_000;
// Cada reserva en su propio dia, lejos de las de ejemplo, para no pisarse
let day = 60;
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

const reservation = (id: string) => mockReservations.find((r) => r.id === id)!;

describe("lo asignado queda fijado mientras está abierto", () => {
  test("un ticket se desfija al resolverse, lo resuelva quien lo resuelva", async () => {
    const created = await gqlAs<{ createTicket: { id: string } }>(SOLICITANTE, CREATE_TICKET, {
      input: { title: "No enciende", description: "El equipo no prende", category: "hardware" },
    });
    const id = created.data!.createTicket.id;
    await gqlAs(TECNICO, CLAIM_TICKET, { id });
    const ticket = mockTickets.find((t) => t.id === id)!;
    expect(ticketPin(ticket, TECNICO)).toBe("active");
    expect(ticketPin(ticket, ADMIN)).toBeNull();

    // El solicitante no cierra tickets: si lo resuelve otro del staff no hay aviso
    expect((await gqlAs(ADMIN, COMPLETE_TICKET, { id, input: DONE })).errors).toBeUndefined();
    expect(ticketPin(ticket, TECNICO)).toBeNull();
  });
});

describe("reserva cancelada por el solicitante: aviso para quien la aprobó", () => {
  test("queda fijada con aviso hasta que quien la aprobó la marca como vista", async () => {
    const id = await newReservation();
    await gqlAs(TECNICO, APPROVE_RESERVATION, { id });
    expect(reservationPin(reservation(id), TECNICO)).toBe("active");

    expect((await gqlAs(SOLICITANTE, CANCEL_RESERVATION, { id })).errors).toBeUndefined();
    expect(reservation(id).unseenCancellation).toBe(true);
    expect(reservationPin(reservation(id), TECNICO)).toBe("notice");

    // Solo quien la aprobó la marca como vista
    expect((await gqlAs(ADMIN, ACK, { id })).errors?.[0].message).toBe(FORBIDDEN);
    expect((await gqlAs(SOLICITANTE, ACK, { id })).errors?.[0].message).toBe(FORBIDDEN);
    expect((await gqlAs(TECNICO, ACK, { id })).errors).toBeUndefined();
    expect(reservation(id).unseenCancellation).toBe(false);
    expect(reservationPin(reservation(id), TECNICO)).toBeNull();
  });

  test("si se cancela antes de que alguien la apruebe, no hay a quién avisar", async () => {
    const id = await newReservation();
    await gqlAs(SOLICITANTE, CANCEL_RESERVATION, { id });
    expect(reservation(id).unseenCancellation).toBe(false);
  });
});

describe("orden y búsqueda de las listas", () => {
  test("los avisos sin ver primero, después lo asignado, después el resto", () => {
    const mine = { id: TECNICO, name: "Nicolás" };
    const items = [
      { id: "a", status: "approved", reviewedBy: null },
      { id: "b", status: "approved", reviewedBy: mine },
      { id: "c", status: "cancelled", reviewedBy: mine, unseenCancellation: true },
    ] as unknown as Reservation[];
    const sorted = pinnedFirst(items, (r) => reservationPin(r, TECNICO));
    expect(sorted.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  test("solo cuenta como ID algo con forma de ID", () => {
    expect(idQuery("7", "tkt")).toBe("7");
    expect(idQuery("tkt-007", "tkt")).toBe("tkt-007");
    expect(idQuery("tkt", "tkt")).toBe("tkt");
    expect(idQuery("loan-00", "loan")).toBe("loan-00");
    expect(idQuery("t", "tkt")).toBeNull();
    expect(idQuery("monitor", "tkt")).toBeNull();
    expect(idQuery("dd", "tkt")).toBeNull();
  });
});
