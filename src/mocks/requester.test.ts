import { describe, expect, test } from "bun:test";
import { mockTickets } from "./data/tickets";
import { mockLoans } from "./data/loans";
import { mockReservations } from "./data/reservations";
import { mockLocations } from "./data/locations";
import { mockProducts } from "./data/equipment";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";
import type { DashboardStats, RequesterOverview } from "@/lib/types";

// #4: el inicio del solicitante muestra lo suyo (tickets en curso, tiempos,
// valoraciones y areas que usa), nunca el estado global del sistema.

useMockServer();

const { ADMIN, TECNICO, SOLICITANTE } = USERS;

const STATS = `
  query GetDashboardStats {
    dashboardStats {
      requesterOverview {
        activeTickets { id status submittedBy { id } updatedAt }
        estimates {
          toAttendHours
          toResolveHours
          sampleSize
          byCategory { category toAttendHours toResolveHours sampleSize }
        }
        satisfaction { average count }
        areas {
          available
          inUse
          inRepair
          retired
          openTickets
          location { id name code productCount }
        }
      }
    }
  }
`;

const RATE = `
  mutation RateTicket($id: ID!, $rating: Int!) {
    rateTicket(id: $id, rating: $rating) { id rating ratedAt }
  }
`;

async function overviewOf(userId: string): Promise<RequesterOverview> {
  const res = await gqlAs<{ dashboardStats: DashboardStats }>(userId, STATS);
  expect(res.errors).toBeUndefined();
  return res.data!.dashboardStats.requesterOverview!;
}

const hours = (from: string, to: string | null) =>
  to ? (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000 : null;

const average = (values: number[]) =>
  values.length === 0
    ? null
    : Math.round((values.reduce((n, v) => n + v, 0) / values.length) * 10) / 10;

describe("#4 el inicio del solicitante no es el tablero del sistema", () => {
  test("el staff no recibe el bloque del solicitante", async () => {
    const results = await Promise.all(
      [ADMIN, TECNICO].map((userId) => gqlAs<{ dashboardStats: DashboardStats }>(userId, STATS)),
    );
    for (const res of results) {
      expect(res.errors).toBeUndefined();
      expect(res.data!.dashboardStats.requesterOverview).toBeNull();
    }
  });

  test("sus tickets en curso son los suyos, sin resolver y con el ultimo movimiento", async () => {
    const overview = await overviewOf(SOLICITANTE);
    const own = mockTickets.filter(
      (t) => t.submittedBy.id === SOLICITANTE && t.status !== "resolved",
    );
    expect(overview.activeTickets).toHaveLength(Math.min(own.length, 5));
    for (const ticket of overview.activeTickets) {
      expect(ticket.submittedBy.id).toBe(SOLICITANTE);
      expect(ticket.status).not.toBe("resolved");
    }
    for (let i = 1; i < overview.activeTickets.length; i++) {
      expect(
        overview.activeTickets[i - 1].updatedAt >= overview.activeTickets[i].updatedAt,
      ).toBe(true);
    }
  });

  test("los tiempos estimados salen de los tickets ya resueltos", async () => {
    const overview = await overviewOf(SOLICITANTE);
    const resolved = mockTickets.filter((t) => t.status === "resolved" && t.resolvedAt);
    const attend = resolved
      .map((t) => hours(t.createdAt, t.attendedAt))
      .filter((h): h is number => h !== null);
    const resolve = resolved
      .map((t) => hours(t.createdAt, t.resolvedAt))
      .filter((h): h is number => h !== null);

    expect(overview.estimates.sampleSize).toBe(resolved.length);
    expect(overview.estimates.toAttendHours).toBe(average(attend));
    expect(overview.estimates.toResolveHours).toBe(average(resolve));

    // Solo las categorias con muestra suficiente llevan promedio propio
    for (const estimate of overview.estimates.byCategory) {
      expect(estimate.sampleSize).toBeGreaterThanOrEqual(3);
      const own = mockTickets.filter(
        (t) => t.category === estimate.category && t.status === "resolved" && t.resolvedAt,
      );
      expect(estimate.sampleSize).toBe(own.length);
    }
    const small = mockTickets.filter((t) => t.category === "network" && t.status === "resolved");
    expect(small.length).toBeLessThan(3);
    expect(overview.estimates.byCategory.some((e) => e.category === "network")).toBe(false);
  });

  test("la satisfaccion es el promedio de las valoraciones propias", async () => {
    const overview = await overviewOf(SOLICITANTE);
    const own = mockTickets.filter(
      (t) => t.submittedBy.id === SOLICITANTE && t.rating !== null,
    );
    expect(overview.satisfaction.count).toBe(own.length);
    expect(overview.satisfaction.average).toBe(average(own.map((t) => t.rating!)));
    // Las valoraciones de otras personas no entran en su promedio
    expect(mockTickets.some((t) => t.submittedBy.id !== SOLICITANTE && t.rating !== null)).toBe(
      true,
    );
  });

  test("las areas salen de sus propios tickets, prestamos y reservas", async () => {
    const overview = await overviewOf(SOLICITANTE);
    const expected = new Set<string>();
    for (const t of mockTickets) {
      if (t.submittedBy.id === SOLICITANTE && t.equipment) expected.add(t.equipment.locationId);
    }
    for (const l of mockLoans) {
      if (l.user.id === SOLICITANTE) expected.add(l.equipment.locationId);
    }
    for (const r of mockReservations) {
      if (r.user.id !== SOLICITANTE) continue;
      if (r.location) expected.add(r.location.id);
      if (r.equipment) expected.add(r.equipment.locationId);
    }

    expect(overview.areas.map((a) => a.location.id).toSorted()).toEqual(
      [...expected].toSorted(),
    );
    expect(mockLocations.length).toBeGreaterThan(expected.size);

    for (const area of overview.areas) {
      const equipment = mockProducts.filter(
        (p) => p.deletedAt === null && p.locationId === area.location.id,
      );
      expect(area.location.productCount).toBe(equipment.length);
      expect(area.available + area.inUse + area.inRepair + area.retired).toBe(equipment.length);
      expect(area.openTickets).toBe(
        mockTickets.filter(
          (t) =>
            t.submittedBy.id === SOLICITANTE &&
            t.status !== "resolved" &&
            t.equipment?.locationId === area.location.id,
        ).length,
      );
    }
  });
});

describe("#4 valorar un ticket resuelto", () => {
  test("solo el solicitante puntua su propio ticket resuelto", async () => {
    const own = mockTickets.find(
      (t) => t.submittedBy.id === SOLICITANTE && t.status === "resolved",
    )!;
    const foreign = mockTickets.find(
      (t) => t.submittedBy.id !== SOLICITANTE && t.status === "resolved",
    )!;
    const open = mockTickets.find(
      (t) => t.submittedBy.id === SOLICITANTE && t.status !== "resolved",
    )!;

    expect((await gqlAs(SOLICITANTE, RATE, { id: foreign.id, rating: 5 })).errors?.[0].message).toBe(
      FORBIDDEN,
    );
    expect((await gqlAs(TECNICO, RATE, { id: own.id, rating: 5 })).errors?.[0].message).toBe(
      FORBIDDEN,
    );
    expect((await gqlAs(SOLICITANTE, RATE, { id: open.id, rating: 5 })).errors?.[0].message).toBe(
      "Solo se puede puntuar un ticket resuelto",
    );
    const invalid = await Promise.all(
      [0, 6, 2.5].map((rating) => gqlAs(SOLICITANTE, RATE, { id: own.id, rating })),
    );
    for (const res of invalid) {
      expect(res.errors?.[0].message).toBe("La valoración va de 1 a 5");
    }
  });

  test("al puntuar, su promedio se actualiza", async () => {
    const own = mockTickets.find(
      (t) => t.submittedBy.id === SOLICITANTE && t.status === "resolved",
    )!;
    const res = await gqlAs<{ rateTicket: { rating: number; ratedAt: string } }>(
      SOLICITANTE,
      RATE,
      { id: own.id, rating: 4 },
    );
    expect(res.errors).toBeUndefined();
    expect(res.data!.rateTicket.rating).toBe(4);
    expect(res.data!.rateTicket.ratedAt).toBeTruthy();

    const overview = await overviewOf(SOLICITANTE);
    const rated = mockTickets.filter(
      (t) => t.submittedBy.id === SOLICITANTE && t.rating !== null,
    );
    expect(overview.satisfaction.count).toBe(rated.length);
    expect(overview.satisfaction.average).toBe(average(rated.map((t) => t.rating!)));
    expect(overview.satisfaction.average).toBe(4);
  });
});
