import { describe, expect, test } from "bun:test";
import { mockTickets } from "./data/tickets";
import { mockLoans } from "./data/loans";
import { mockServices } from "./data/services";
import { mockReservations } from "./data/reservations";
import { mockActivityLogs } from "./generators";
import { dateRangeBounds } from "@/lib/date-range";
import { gqlAs, useMockServer, USERS } from "@/test/graphql";

useMockServer();

// Mismo calculo que hace la web: dia local del navegador -> instantes UTC
const pad = (value: number) => String(value).padStart(2, "0");

function dayOf(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayBounds(iso: string) {
  const day = dayOf(iso);
  return dateRangeBounds({ from: day, to: day })!;
}

function rangeBounds(fromIso: string, toIso: string) {
  return dateRangeBounds({ from: dayOf(fromIso), to: dayOf(toIso) })!;
}

describe("filtro por fechas en los listados (MSW)", () => {
  const TICKETS = `query GetTickets($startDate: String, $endDate: String) {
    tickets(startDate: $startDate, endDate: $endDate) { id createdAt submittedBy { id } }
  }`;

  test("tickets: solo los creados dentro del dia, con los dos extremos incluidos", async () => {
    const sample = mockTickets[0];
    const res = await gqlAs<{ tickets: Array<{ id: string; createdAt: string }> }>(
      USERS.TECNICO,
      TICKETS,
      dayBounds(sample.createdAt),
    );
    expect(res.errors).toBeUndefined();
    const ids = res.data!.tickets.map((t) => t.id);
    expect(ids).toContain(sample.id);
    for (const ticket of res.data!.tickets) {
      expect(dayOf(ticket.createdAt)).toBe(dayOf(sample.createdAt));
    }
    // Un dia sin datos devuelve la lista vacia, no todo
    expect(
      (await gqlAs<{ tickets: unknown[] }>(USERS.TECNICO, TICKETS, dayBounds("2030-01-01")))
        .data!.tickets,
    ).toEqual([]);
  });

  test("tickets: el rango no amplia lo que ve un solicitante", async () => {
    const res = await gqlAs<{ tickets: Array<{ submittedBy: { id: string } }> }>(
      USERS.SOLICITANTE,
      TICKETS,
      rangeBounds("2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z"),
    );
    expect(res.errors).toBeUndefined();
    expect(res.data!.tickets.length).toBeGreaterThan(0);
    for (const ticket of res.data!.tickets) {
      expect(ticket.submittedBy.id).toBe(USERS.SOLICITANTE);
    }
  });

  test("prestamos: se filtran por issueDate, no por createdAt", async () => {
    const sample = mockLoans[0];
    const query = `query GetLoans($startDate: String, $endDate: String) {
      loans(startDate: $startDate, endDate: $endDate) { id issueDate }
    }`;
    const res = await gqlAs<{ loans: Array<{ id: string; issueDate: string }> }>(
      USERS.TECNICO,
      query,
      dayBounds(sample.issueDate),
    );
    expect(res.errors).toBeUndefined();
    expect(res.data!.loans.map((l) => l.id)).toContain(sample.id);
    for (const loan of res.data!.loans) {
      expect(dayOf(loan.issueDate)).toBe(dayOf(sample.issueDate));
    }
  });

  test("solicitudes: solo las creadas dentro del rango", async () => {
    const sample = mockServices[0];
    const query = `query GetServiceRequests($startDate: String, $endDate: String) {
      serviceRequests(startDate: $startDate, endDate: $endDate) { id createdAt }
    }`;
    const res = await gqlAs<{ serviceRequests: Array<{ id: string; createdAt: string }> }>(
      USERS.TECNICO,
      query,
      dayBounds(sample.createdAt),
    );
    expect(res.errors).toBeUndefined();
    expect(res.data!.serviceRequests.map((s) => s.id)).toContain(sample.id);
    for (const service of res.data!.serviceRequests) {
      expect(dayOf(service.createdAt)).toBe(dayOf(sample.createdAt));
    }
  });

  test("reservas: entran las que se solapan con el dia, no solo las que empiezan", async () => {
    const query = `query GetReservations($startDate: String, $endDate: String) {
      reservations(startDate: $startDate, endDate: $endDate) { id startsAt endsAt }
    }`;
    // Reserva de 22:00 a 02:00 del dia siguiente: tiene que aparecer en los dos dias
    const startsAt = new Date(2026, 9, 20, 22, 0, 0).toISOString();
    const endsAt = new Date(2026, 9, 21, 2, 0, 0).toISOString();
    const temporary = { ...mockReservations[0], id: "rsv-date-test", startsAt, endsAt };
    mockReservations.push(temporary);
    try {
      const firstDay = await gqlAs<{ reservations: Array<{ id: string }> }>(
        USERS.TECNICO,
        query,
        dayBounds(startsAt),
      );
      expect(firstDay.errors).toBeUndefined();
      expect(firstDay.data!.reservations.map((r) => r.id)).toContain(temporary.id);

      const lastDay = await gqlAs<{ reservations: Array<{ id: string }> }>(
        USERS.TECNICO,
        query,
        dayBounds(endsAt),
      );
      expect(lastDay.data!.reservations.map((r) => r.id)).toContain(temporary.id);

      const farAway = await gqlAs<{ reservations: unknown[] }>(
        USERS.TECNICO,
        query,
        dayBounds("2030-01-01"),
      );
      expect(farAway.data!.reservations).toEqual([]);
    } finally {
      mockReservations.splice(mockReservations.indexOf(temporary), 1);
    }
  });

  test("registros de actividad: el hasta incluye el ultimo instante del dia", async () => {
    const query = `query GetActivityLogs($startDate: String, $endDate: String) {
      activityLogs(startDate: $startDate, endDate: $endDate) { id timestamp }
    }`;
    const sample = mockActivityLogs[0];
    const bounds = dayBounds(sample.timestamp);
    const res = await gqlAs<{ activityLogs: Array<{ id: string; timestamp: string }> }>(
      USERS.ROOT,
      query,
      bounds,
    );
    expect(res.errors).toBeUndefined();
    expect(res.data!.activityLogs.map((l) => l.id)).toContain(sample.id);
    for (const log of res.data!.activityLogs) {
      expect(Date.parse(log.timestamp)).toBeGreaterThanOrEqual(Date.parse(bounds.startDate!));
      expect(Date.parse(log.timestamp)).toBeLessThanOrEqual(Date.parse(bounds.endDate!));
    }

    const empty = await gqlAs<{ activityLogs: unknown[] }>(
      USERS.ROOT,
      query,
      dayBounds("2030-01-01"),
    );
    expect(empty.data!.activityLogs).toEqual([]);
  });
});
