import { describe, expect, test } from "bun:test";
import { mockTickets } from "./data/tickets";
import { mockServices } from "./data/services";
import { mockLoans } from "./data/loans";
import { mockProducts } from "./data/equipment";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";
import type { DashboardStats, Reports } from "@/lib/types";

useMockServer();

const { ADMIN, TECNICO, SOLICITANTE, OTRO_SOLICITANTE } = USERS;

const TICKETS = `query GetTickets($submittedById: ID) { tickets(submittedById: $submittedById) { id submittedBy { id } } }`;
const TICKET = `query GetTicket($id: ID!) { ticket(id: $id) { id } }`;
const SERVICES = `query GetServiceRequests($requestedById: ID) { serviceRequests(requestedById: $requestedById) { id requestedBy { id } } }`;
const SERVICE = `query GetServiceRequest($id: ID!) { serviceRequest(id: $id) { id } }`;
const STATS = `query GetDashboardStats($period: String) { dashboardStats(period: $period) { totalEquipment openTickets activeLoans pendingServices ticketsByStatus { status count } servicesByPeriod { date count } } }`;

describe("#22 el solicitante abre el detalle de lo suyo y solo de lo suyo", () => {
  test("lee su ticket y no el ajeno", async () => {
    const propio = mockTickets.find((t) => t.submittedBy.id === SOLICITANTE)!;
    const ajeno = mockTickets.find((t) => t.submittedBy.id !== SOLICITANTE)!;
    expect((await gqlAs(SOLICITANTE, TICKET, { id: propio.id })).errors).toBeUndefined();
    expect((await gqlAs(SOLICITANTE, TICKET, { id: ajeno.id })).errors?.[0].message).toBe(
      FORBIDDEN,
    );
  });

  test("lee su solicitud de servicio y no la ajena", async () => {
    const propia = mockServices.find((s) => s.requestedBy.id === SOLICITANTE)!;
    const ajena = mockServices.find((s) => s.requestedBy.id !== SOLICITANTE)!;
    expect((await gqlAs(SOLICITANTE, SERVICE, { id: propia.id })).errors).toBeUndefined();
    expect((await gqlAs(SOLICITANTE, SERVICE, { id: ajena.id })).errors?.[0].message).toBe(
      FORBIDDEN,
    );
  });

  test("el técnico lee cualquier ticket", async () => {
    const ajeno = mockTickets.find((t) => t.submittedBy.id !== TECNICO)!;
    expect((await gqlAs(TECNICO, TICKET, { id: ajeno.id })).errors).toBeUndefined();
  });
});

describe("#28 el alcance de las lecturas lo decide el servidor", () => {
  test("los listados del solicitante ignoran el filtro que manda el cliente", async () => {
    const tickets = await gqlAs<{ tickets: Array<{ submittedBy: { id: string } }> }>(
      SOLICITANTE,
      TICKETS,
      { submittedById: OTRO_SOLICITANTE },
    );
    expect(tickets.data!.tickets.length).toBeGreaterThan(0);
    for (const t of tickets.data!.tickets) expect(t.submittedBy.id).toBe(SOLICITANTE);

    const services = await gqlAs<{ serviceRequests: Array<{ requestedBy: { id: string } }> }>(
      SOLICITANTE,
      SERVICES,
    );
    expect(services.data!.serviceRequests.length).toBeGreaterThan(0);
    for (const s of services.data!.serviceRequests) expect(s.requestedBy.id).toBe(SOLICITANTE);
  });

  test("sin token no se lee nada", async () => {
    const queries = [TICKETS, SERVICES, STATS, `query GetProducts { products { id } }`];
    const results = await Promise.all(queries.map((q) => gqlAs(null, q)));
    for (const res of results) expect(res.errors?.[0].message).toBe("No autenticado");
  });

  test("usuarios, logs y OOL quedan fuera del solicitante", async () => {
    const queries = [
      `query GetUsers { users { id } }`,
      `query GetActivityLogs { activityLogs { id } }`,
      `query GetOolTickets { oolTickets { id } }`,
    ];
    const results = await Promise.all(queries.map((q) => gqlAs(SOLICITANTE, q)));
    for (const res of results) expect(res.errors?.[0].message).toBe(FORBIDDEN);
  });

  test("el solicitante puede leer su propio usuario pero no otro", async () => {
    const q = `query GetUser($id: ID!) { user(id: $id) { id } }`;
    expect((await gqlAs(SOLICITANTE, q, { id: SOLICITANTE })).errors).toBeUndefined();
    expect((await gqlAs(SOLICITANTE, q, { id: OTRO_SOLICITANTE })).errors?.[0].message).toBe(
      FORBIDDEN,
    );
  });

  test("los logs son solo para admin", async () => {
    const q = `query GetActivityLogs { activityLogs { id } }`;
    expect((await gqlAs(TECNICO, q)).errors?.[0].message).toBe(FORBIDDEN);
    expect((await gqlAs(ADMIN, q)).errors).toBeUndefined();
  });

  test("el dashboard del solicitante solo cuenta lo suyo", async () => {
    const res = await gqlAs<{ dashboardStats: DashboardStats }>(SOLICITANTE, STATS);
    const stats = res.data!.dashboardStats;
    const own = mockTickets.filter((t) => t.submittedBy.id === SOLICITANTE);
    expect(stats.openTickets).toBe(own.filter((t) => t.status !== "resolved").length);
    expect(stats.ticketsByStatus.reduce((n, t) => n + t.count, 0)).toBe(own.length);
    expect(stats.activeLoans).toBe(
      mockLoans.filter(
        (l) => l.user.id === SOLICITANTE && ["approved", "active", "overdue"].includes(l.status),
      ).length,
    );

    const global = (await gqlAs<{ dashboardStats: DashboardStats }>(ADMIN, STATS)).data!
      .dashboardStats;
    expect(global.openTickets).toBe(mockTickets.filter((t) => t.status !== "resolved").length);
    expect(global.totalEquipment).toBe(mockProducts.filter((p) => p.deletedAt === null).length);
    expect(stats.openTickets).toBeLessThan(global.openTickets);
  });

  test("la carga de trabajo del area solo le llega al staff", async () => {
    const own = (await gqlAs<{ dashboardStats: DashboardStats }>(SOLICITANTE, STATS)).data!
      .dashboardStats;
    expect(own.workQueue).toBeNull();

    const staff = (await gqlAs<{ dashboardStats: DashboardStats }>(TECNICO, STATS)).data!
      .dashboardStats;
    expect(staff.workQueue).toEqual({
      unassignedTickets: mockTickets.filter((t) => t.status === "pending" && !t.assignedTo).length,
      ticketsInProgress: mockTickets.filter((t) =>
        ["in_progress", "in_resolution"].includes(t.status),
      ).length,
      pendingServices: mockServices.filter((s) => s.status === "pending").length,
      overdueLoans: mockLoans.filter((l) => l.status === "overdue").length,
      equipmentInRepair: mockProducts.filter(
        (p) => p.deletedAt === null && p.status === "in_repair",
      ).length,
    });
  });
});

describe("#26 métricas de solicitudes reales y por período", () => {
  test("dos lecturas seguidas devuelven lo mismo", async () => {
    const a = await gqlAs(ADMIN, STATS, { period: "30d" });
    const b = await gqlAs(ADMIN, STATS, { period: "30d" });
    expect(a).toEqual(b);
  });

  test("el conteo coincide con las solicitudes creadas en el período", async () => {
    const cases = [
      ["7d", 7, 7],
      ["30d", 30, 30],
      ["90d", 13, 91],
    ] as const;
    const results = await Promise.all(
      cases.map(([period]) => gqlAs<{ dashboardStats: DashboardStats }>(ADMIN, STATS, { period })),
    );
    cases.forEach(([, buckets, days], i) => {
      const series = results[i].data!.dashboardStats.servicesByPeriod;
      expect(series).toHaveLength(buckets);
      const since = new Date();
      since.setUTCHours(24, 0, 0, 0);
      since.setUTCDate(since.getUTCDate() - days);
      const expected = mockServices.filter((s) => new Date(s.createdAt) >= since).length;
      expect(series.reduce((n, s) => n + s.count, 0)).toBe(expected);
      expect(expected).toBeGreaterThan(0);
    });
  });

  test("un período desconocido cae en 7 días", async () => {
    const res = await gqlAs<{ dashboardStats: DashboardStats }>(ADMIN, STATS, { period: "1y" });
    expect(res.data!.dashboardStats.servicesByPeriod).toHaveLength(7);
  });
});

describe("#27 reportes para el administrador", () => {
  const REPORTS = `query GetReports { reports { overdueLoans { loanId daysOverdue } resolution { resolvedCount averageHours byCategory { category resolvedCount averageHours } } topIncidentEquipment { equipmentId ticketCount openCount } } }`;

  test("solo el admin los consulta", async () => {
    expect((await gqlAs(TECNICO, REPORTS)).errors?.[0].message).toBe(FORBIDDEN);
    expect((await gqlAs(SOLICITANTE, REPORTS)).errors?.[0].message).toBe(FORBIDDEN);
  });

  test("los números se reconcilian con los datos", async () => {
    const res = await gqlAs<{ reports: Reports }>(ADMIN, REPORTS);
    const { overdueLoans, resolution, topIncidentEquipment } = res.data!.reports;

    expect(overdueLoans.map((l) => l.loanId).toSorted()).toEqual(
      mockLoans
        .filter((l) => l.status === "overdue")
        .map((l) => l.id)
        .toSorted(),
    );
    for (let i = 1; i < overdueLoans.length; i++) {
      expect(overdueLoans[i - 1].daysOverdue).toBeGreaterThanOrEqual(overdueLoans[i].daysOverdue);
    }

    const resolved = mockTickets.filter((t) => t.status === "resolved" && t.resolvedAt);
    expect(resolution.resolvedCount).toBe(resolved.length);
    expect(resolution.byCategory.reduce((n, c) => n + c.resolvedCount, 0)).toBe(resolved.length);
    const hours =
      resolved.reduce(
        (n, t) => n + new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime(),
        0,
      ) /
      resolved.length /
      3_600_000;
    expect(resolution.averageHours).toBeCloseTo(hours, 0);

    const top = topIncidentEquipment[0];
    expect(top.ticketCount).toBe(
      mockTickets.filter((t) => t.equipmentId === top.equipmentId).length,
    );
    for (const e of topIncidentEquipment)
      expect(e.ticketCount).toBeLessThanOrEqual(top.ticketCount);
  });
});
