import { describe, expect, test } from "bun:test";
import { mockTickets } from "./data/tickets";
import { mockUsers } from "./data/users";
import type { Ticket } from "@/lib/types";
import { gqlAs, useMockServer, USERS } from "@/test/graphql";

useMockServer();

const { TECNICO, SOLICITANTE } = USERS;

const CREATE = `mutation CreateTicket($input: TicketInput!) { createTicket(input: $input) { id } }`;
const CLAIM = `mutation ClaimTicket($id: ID!) { claimTicket(id: $id) { id } }`;
const CHANGE = `mutation ChangeTicketStatus($id: ID!, $status: String!) { changeTicketStatus(id: $id, status: $status) { id } }`;
const COMPLETE = `mutation CompleteTicket($id: ID!, $input: TicketCompleteInput!) { completeTicket(id: $id, input: $input) { id } }`;
const UPDATE = `mutation UpdateTicket($id: ID!, $input: TicketUpdateInput!) { updateTicket(id: $id, input: $input) { id } }`;
const ASSIGN = `mutation AssignTicket($id: ID!, $technicianId: ID!) { assignTicket(id: $id, technicianId: $technicianId) { id } }`;

const DONE = { diagnosis: "Fuente quemada", corrected: true, actionsTaken: "Se cambió la fuente" };

function ticket(id: string): Ticket {
  return mockTickets.find((t) => t.id === id)!;
}

async function newTicket(as: string = SOLICITANTE): Promise<string> {
  const res = await gqlAs<{ createTicket: { id: string } }>(as, CREATE, {
    input: { title: "No enciende", description: "El equipo no prende", category: "hardware" },
  });
  expect(res.errors).toBeUndefined();
  return res.data!.createTicket.id;
}

describe("#24 cualquier rol puede crear tickets", () => {
  test("el técnico registra un incidente", async () => {
    const id = await newTicket(TECNICO);
    expect(ticket(id).submittedBy.id).toBe(TECNICO);
    expect(ticket(id).status).toBe("pending");
  });

  test("los tickets nuevos siguen la numeración correlativa", async () => {
    const [a, b] = [await newTicket(), await newTicket()];
    expect(a).toMatch(/^tkt-\d{3}$/);
    expect(Number(b.slice(4))).toBe(Number(a.slice(4)) + 1);
    expect(new Set(mockTickets.map((t) => t.id)).size).toBe(mockTickets.length);
  });
});

describe("#23 ciclo de vida del ticket", () => {
  test("recorrido completo con en resolución y reapertura", async () => {
    const id = await newTicket();
    expect((await gqlAs(TECNICO, CLAIM, { id })).errors).toBeUndefined();
    expect(ticket(id).status).toBe("in_progress");
    expect(ticket(id).assignedTo?.id).toBe(TECNICO);

    expect((await gqlAs(TECNICO, CHANGE, { id, status: "in_resolution" })).errors).toBeUndefined();
    expect(ticket(id).status).toBe("in_resolution");

    expect((await gqlAs(TECNICO, COMPLETE, { id, input: DONE })).errors).toBeUndefined();
    expect(ticket(id).status).toBe("resolved");
    expect(ticket(id).resolvedAt).not.toBeNull();

    expect((await gqlAs(TECNICO, CHANGE, { id, status: "in_progress" })).errors).toBeUndefined();
    expect(ticket(id).status).toBe("in_progress");
    expect(ticket(id).resolvedAt).toBeNull();
  });

  test("liberar vuelve a pendiente y quita el responsable", async () => {
    const id = await newTicket();
    await gqlAs(TECNICO, CLAIM, { id });
    expect((await gqlAs(TECNICO, CHANGE, { id, status: "pending" })).errors).toBeUndefined();
    expect(ticket(id).status).toBe("pending");
    expect(ticket(id).assignedTo).toBeNull();
  });

  test("un pendiente no se resuelve ni se mueve sin tomarlo", async () => {
    const id = await newTicket();
    const complete = await gqlAs(TECNICO, COMPLETE, { id, input: DONE });
    expect(complete.errors?.[0].message).toBe(
      'No se puede pasar un ticket de "Pendiente" a "Resuelto"',
    );
    const change = await gqlAs(TECNICO, CHANGE, { id, status: "in_resolution" });
    expect(change.errors?.[0].message).toBe(
      'No se puede pasar un ticket de "Pendiente" a "En resolución"',
    );
    expect(ticket(id).status).toBe("pending");
  });

  test("resolver por cambio de estado está prohibido: exige diagnóstico", async () => {
    const id = await newTicket();
    await gqlAs(TECNICO, CLAIM, { id });
    const res = await gqlAs(TECNICO, CHANGE, { id, status: "resolved" });
    expect(res.errors?.[0].message).toBe("Para resolver un ticket completá el diagnóstico");
    const sinDiagnostico = await gqlAs(TECNICO, COMPLETE, {
      id,
      input: { diagnosis: "  ", corrected: true, actionsTaken: "" },
    });
    expect(sinDiagnostico.errors?.[0].message).toBe(
      "Completá el diagnóstico y si se corrigió el problema",
    );
    expect(ticket(id).status).toBe("in_progress");
  });

  test("no se toma dos veces el mismo ticket", async () => {
    const id = await newTicket();
    await gqlAs(TECNICO, CLAIM, { id });
    const res = await gqlAs("u-tec-2", CLAIM, { id });
    expect(res.errors?.[0].message).toBe(
      'No se puede pasar un ticket de "En progreso" a "En progreso"',
    );
    expect(ticket(id).assignedTo?.id).toBe(TECNICO);
  });

  test("updateTicket ya no acepta un estado arbitrario", async () => {
    const id = await newTicket();
    await gqlAs(TECNICO, UPDATE, { id, input: { title: "Otro título", status: "resolved" } });
    expect(ticket(id).title).toBe("Otro título");
    expect(ticket(id).status).toBe("pending");
  });

  test("solo se asigna a personal técnico y no a un ticket resuelto", async () => {
    const id = await newTicket();
    const aSolicitante = await gqlAs(TECNICO, ASSIGN, { id, technicianId: SOLICITANTE });
    expect(aSolicitante.errors?.[0].message).toBe("Solo se puede asignar a personal técnico");

    const tec2 = mockUsers.find((u) => u.id === "u-tec-2")!;
    await gqlAs(TECNICO, ASSIGN, { id, technicianId: tec2.id });
    expect(ticket(id).status).toBe("in_progress");
    expect(ticket(id).assignedTo?.id).toBe(tec2.id);

    await gqlAs(TECNICO, COMPLETE, { id, input: DONE });
    const res = await gqlAs(TECNICO, ASSIGN, { id, technicianId: TECNICO });
    expect(res.errors?.[0].message).toBe("No se puede reasignar un ticket resuelto");
  });
});
