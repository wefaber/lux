import { describe, expect, test } from "bun:test";
import type { RequesterData, StaffCounts } from "../queries";
import {
  dashboardPeriod,
  periodSince,
  requesterDashboard,
  servicesByPeriod,
  staffDashboard,
} from "./dashboard";

const DAY = 24 * 60 * 60 * 1000;
// 2026-11-03 15:30 UTC: el fin del dia (UTC) es 2026-11-04T00:00:00Z
const NOW = new Date("2026-11-03T15:30:00.000Z");

const emptyCounts = (): StaffCounts => ({
  ticketsByStatus: {},
  unassignedTickets: 0,
  loansByStatus: {},
  servicesByStatus: {},
  serviceCreatedAt: [],
  equipmentByStatus: {},
});

const emptyRequester = (): RequesterData => ({
  ownTickets: [],
  resolvedForEstimates: [],
  ownLoans: [],
  ownReservations: [],
  servicesByStatus: {},
  serviceCreatedAt: [],
  availableEquipment: 0,
  locations: [],
  areaProducts: [],
});

const place = (
  id: string,
  name: string,
  kind: "laboratory" | "classroom",
  deletedAt: string | null = null,
) => ({
  id,
  kind,
  number: 1,
  name,
  code: id.toUpperCase(),
  productCount: 0,
  createdAt: "",
  updatedAt: "",
  deletedAt,
});

describe("dashboardPeriod", () => {
  test("7d, 30d y 90d", () => {
    expect(dashboardPeriod("7d")).toEqual({ days: 7, bucketDays: 1 });
    expect(dashboardPeriod("30d")).toEqual({ days: 30, bucketDays: 1 });
    expect(dashboardPeriod("90d")).toEqual({ days: 91, bucketDays: 7 });
  });

  // Antes: PERIOD_BUCKETS["constructor"] devolvia una funcion y servicesByPeriod salia vacio
  test.each([undefined, "", "1y", "7D", "__proto__", "constructor", "toString", "hasOwnProperty"])(
    "periodo %p cae en 7d",
    (period) => {
      expect(dashboardPeriod(period)).toEqual({ days: 7, bucketDays: 1 });
    },
  );
});

describe("servicesByPeriod", () => {
  const p7 = dashboardPeriod("7d");

  test("sin solicitudes: 7 tramos en cero; el primero es hace 6 dias y el ultimo, hoy", () => {
    const series = servicesByPeriod([], p7, NOW);
    expect(series).toHaveLength(7);
    expect(series.every((s) => s.count === 0)).toBe(true);
    expect(series[0]?.date).toBe("2026-10-28");
    expect(series.at(-1)?.date).toBe("2026-11-03");
  });

  test("el inicio del tramo cuenta y el fin no (pertenece al siguiente)", () => {
    const series = servicesByPeriod(
      ["2026-11-03T00:00:00.000Z", "2026-11-02T23:59:59.999Z"],
      p7,
      NOW,
    );
    expect(series.at(-1)?.count).toBe(1);
    expect(series.at(-2)?.count).toBe(1);
  });

  test("antes del primer tramo y despues de hoy no cuentan", () => {
    const series = servicesByPeriod(
      ["2026-10-27T23:59:59.999Z", "2026-11-04T00:00:00.000Z"],
      p7,
      NOW,
    );
    expect(series.every((s) => s.count === 0)).toBe(true);
  });

  test("fechas invalidas no cuentan ni rompen", () => {
    const series = servicesByPeriod(["", "no-es-fecha", "2026-11-03T10:00:00Z"], p7, NOW);
    expect(series.reduce((a, s) => a + s.count, 0)).toBe(1);
  });

  test("con y sin milisegundos cuentan igual", () => {
    const series = servicesByPeriod(["2026-11-03T10:00:00Z", "2026-11-03T10:00:00.000Z"], p7, NOW);
    expect(series.at(-1)?.count).toBe(2);
  });

  test("a las 00:00:00.000 y a las 23:59:59.999 UTC el ultimo tramo es el mismo dia", () => {
    for (const at of ["2026-11-03T00:00:00.000Z", "2026-11-03T23:59:59.999Z"]) {
      expect(servicesByPeriod([], p7, new Date(at)).at(-1)?.date).toBe("2026-11-03");
    }
  });

  test("90d: 13 tramos de 7 dias; una solicitud en el borde va al tramo que arranca ahi", () => {
    const p90 = dashboardPeriod("90d");
    const boundary = new Date(Date.parse("2026-11-04T00:00:00.000Z") - 7 * DAY).toISOString();
    const series = servicesByPeriod([boundary], p90, NOW);
    expect(series).toHaveLength(13);
    expect(series.at(-1)).toEqual({ date: boundary.slice(0, 10), count: 1 });
    expect(series.at(-2)?.count).toBe(0);
  });

  test("no muta la fecha que recibe", () => {
    const now = new Date(NOW);
    servicesByPeriod([], p7, now);
    expect(now.toISOString()).toBe(NOW.toISOString());
  });
});

describe("periodSince", () => {
  test("queda un dia antes del primer tramo, para cualquier periodo", () => {
    for (const name of ["7d", "30d", "90d"]) {
      const period = dashboardPeriod(name);
      const first = servicesByPeriod([], period, NOW)[0]!.date; // dia en que arranca el primer tramo
      const since = periodSince(period, NOW);
      expect(Date.parse(since)).toBe(Date.parse(`${first}T00:00:00.000Z`) - DAY);
    }
  });

  test("nunca deja afuera una solicitud que la serie contaria", () => {
    const period = dashboardPeriod("7d");
    const since = Date.parse(periodSince(period, NOW));
    const firstStart = Date.parse(`${servicesByPeriod([], period, NOW)[0]!.date}T00:00:00.000Z`);
    expect(since).toBeLessThan(firstStart);
  });

  test("no muta la fecha que recibe", () => {
    const now = new Date(NOW);
    periodSince(dashboardPeriod("30d"), now);
    expect(now.toISOString()).toBe(NOW.toISOString());
  });
});

describe("staffDashboard", () => {
  const p7 = dashboardPeriod("7d");

  test("base vacia: todo en cero, los 4 estados de ticket y workQueue en cero", () => {
    const stats = staffDashboard(emptyCounts(), p7, NOW);
    expect([
      stats.totalEquipment,
      stats.openTickets,
      stats.activeLoans,
      stats.pendingServices,
    ]).toEqual([0, 0, 0, 0]);
    expect(stats.ticketsByStatus.map((s) => s.status)).toEqual([
      "pending",
      "in_progress",
      "in_resolution",
      "resolved",
    ]);
    expect(stats.ticketsByStatus.every((s) => s.count === 0)).toBe(true);
    expect(stats.workQueue).toEqual({
      unassignedTickets: 0,
      ticketsInProgress: 0,
      pendingServices: 0,
      overdueLoans: 0,
      equipmentInRepair: 0,
    });
    expect(stats.requesterOverview).toBeNull();
  });

  test("openTickets no cuenta los resueltos; ticketsInProgress junta en curso y en resolucion", () => {
    const counts = {
      ...emptyCounts(),
      ticketsByStatus: { pending: 2, in_progress: 3, in_resolution: 1, resolved: 40 },
    };
    const stats = staffDashboard(counts, p7, NOW);
    expect(stats.openTickets).toBe(6);
    expect(stats.workQueue?.ticketsInProgress).toBe(4);
  });

  test("solo resueltos: ningun ticket abierto", () => {
    expect(
      staffDashboard({ ...emptyCounts(), ticketsByStatus: { resolved: 5 } }, p7, NOW).openTickets,
    ).toBe(0);
  });

  test("prestamos abiertos: aprobado, entregado y vencido; no pendiente, devuelto ni rechazado", () => {
    const loansByStatus = {
      pending: 4,
      approved: 1,
      active: 2,
      overdue: 3,
      returned: 9,
      rejected: 5,
    };
    const stats = staffDashboard({ ...emptyCounts(), loansByStatus }, p7, NOW);
    expect(stats.activeLoans).toBe(6);
    expect(stats.workQueue?.overdueLoans).toBe(3);
  });

  test("equipos: el total suma todos los estados y en reparacion sale aparte", () => {
    const equipmentByStatus = { available: 10, in_use: 5, in_repair: 2, retired: 1 };
    const stats = staffDashboard({ ...emptyCounts(), equipmentByStatus }, p7, NOW);
    expect(stats.totalEquipment).toBe(18);
    expect(stats.workQueue?.equipmentInRepair).toBe(2);
  });

  test("solicitudes pendientes coinciden en el tablero y en la cola de trabajo", () => {
    const stats = staffDashboard(
      { ...emptyCounts(), servicesByStatus: { pending: 7, completed: 2 } },
      p7,
      NOW,
    );
    expect(stats.pendingServices).toBe(7);
    expect(stats.workQueue?.pendingServices).toBe(7);
  });

  test("un estado desconocido en la base no rompe las sumas", () => {
    const stats = staffDashboard(
      { ...emptyCounts(), ticketsByStatus: { pending: 1, archivado: 2 } },
      p7,
      NOW,
    );
    expect(stats.openTickets).toBe(1);
    expect(stats.ticketsByStatus.find((s) => s.status === "pending")?.count).toBe(1);
  });
});

describe("requesterDashboard", () => {
  const p7 = dashboardPeriod("7d");
  const caller = { id: "u-sol-001" };

  test("base vacia: ceros, sin workQueue y con el resumen del solicitante vacio", () => {
    const stats = requesterDashboard(caller, emptyRequester(), p7, NOW);
    expect([
      stats.totalEquipment,
      stats.openTickets,
      stats.activeLoans,
      stats.pendingServices,
    ]).toEqual([0, 0, 0, 0]);
    expect(stats.workQueue).toBeNull();
    expect(stats.requesterOverview?.activeTickets).toEqual([]);
    expect(stats.requesterOverview?.areas).toEqual([]);
    expect(stats.requesterOverview?.satisfaction).toEqual({ average: null, count: 0 });
    expect(stats.requesterOverview?.estimates.sampleSize).toBe(0);
  });

  test("equipos disponibles, prestamos propios abiertos y solicitudes pendientes propias", () => {
    const data: RequesterData = {
      ...emptyRequester(),
      availableEquipment: 12,
      ownLoans: [
        { status: "active", user: caller, equipment: { locationId: "loc-1" } },
        { status: "returned", user: caller, equipment: { locationId: "loc-1" } },
        { status: "pending", user: caller, equipment: { locationId: "loc-2" } },
      ],
      servicesByStatus: { pending: 2, completed: 4 },
    };
    const stats = requesterDashboard(caller, data, p7, NOW);
    expect(stats.totalEquipment).toBe(12);
    expect(stats.activeLoans).toBe(1);
    expect(stats.pendingServices).toBe(2);
  });

  test("areas: lugares que uso, ordenados por nombre; solo cuentan equipos vigentes", () => {
    const data: RequesterData = {
      ...emptyRequester(),
      ownLoans: [{ status: "active", user: caller, equipment: { locationId: "loc-1" } }],
      ownReservations: [{ user: caller, location: { id: "loc-2" }, equipment: null }],
      locations: [place("loc-1", "Lab 1", "laboratory"), place("loc-2", "Aula", "classroom")],
      areaProducts: [
        { locationId: "loc-1", status: "available", deletedAt: null },
        { locationId: "loc-1", status: "in_repair", deletedAt: null },
        { locationId: "loc-1", status: "available", deletedAt: "2026-01-01T00:00:00.000Z" },
        { locationId: "loc-3", status: "available", deletedAt: null },
      ],
    };
    const areas = requesterDashboard(caller, data, p7, NOW).requesterOverview?.areas ?? [];
    expect(areas.map((a) => a.location.id)).toEqual(["loc-2", "loc-1"]);
    expect(areas[1]).toMatchObject({ available: 1, inRepair: 1, retired: 0 });
    expect(areas[1]?.location.productCount).toBe(2);
    expect(areas[0]).toMatchObject({ available: 0, inUse: 0, inRepair: 0 });
  });

  test("un lugar dado de baja no aparece aunque lo haya usado", () => {
    const data: RequesterData = {
      ...emptyRequester(),
      ownLoans: [{ status: "active", user: caller, equipment: { locationId: "loc-x" } }],
      locations: [place("loc-x", "Baja", "laboratory", "2026-01-01T00:00:00.000Z")],
    };
    expect(requesterDashboard(caller, data, p7, NOW).requesterOverview?.areas).toEqual([]);
  });

  test("el promedio del area usa los resueltos de todos; con 3 hay promedio por categoria y con 2 no", () => {
    const resolved = (hours: number) => ({
      category: "hardware" as const,
      status: "resolved" as const,
      createdAt: "2026-10-01T00:00:00.000Z",
      attendedAt: "2026-10-01T01:00:00.000Z",
      resolvedAt: new Date(
        Date.parse("2026-10-01T00:00:00.000Z") + hours * 3_600_000,
      ).toISOString(),
    });
    const three = requesterDashboard(
      caller,
      { ...emptyRequester(), resolvedForEstimates: [resolved(2), resolved(4), resolved(6)] },
      p7,
      NOW,
    );
    expect(three.requesterOverview?.estimates).toMatchObject({ sampleSize: 3, toResolveHours: 4 });
    expect(three.requesterOverview?.estimates.byCategory.map((c) => c.category)).toEqual([
      "hardware",
    ]);

    const two = requesterDashboard(
      caller,
      { ...emptyRequester(), resolvedForEstimates: [resolved(2), resolved(4)] },
      p7,
      NOW,
    );
    expect(two.requesterOverview?.estimates.sampleSize).toBe(2);
    expect(two.requesterOverview?.estimates.byCategory).toEqual([]);
  });
});
