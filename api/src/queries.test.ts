import { beforeAll, describe, expect, test } from "bun:test";
import type { State } from "./state";
import type * as Queries from "./queries";

// Compara las queries acotadas (queries.ts) con filtrar la foto completa de
// `loadState()` en memoria, que es lo que hacian los resolvers antes del issue
// #115. Necesita una base con el seed cargado (DATABASE_URL); sin ella se omite.
const withDb = process.env.DATABASE_URL ? describe : describe.skip;

const byId = <T extends { id: string }>(items: T[]) =>
  items.toSorted((a, b) => a.id.localeCompare(b.id));

withDb("queries acotadas vs foto completa", () => {
  let state: State;
  let q: typeof Queries;
  beforeAll(async () => {
    state = await (await import("./state")).loadState();
    q = await import("./queries");
  });

  test("tickets: sin filtros y con cada filtro", async () => {
    const someTicket = state.tickets[0]!;
    const cases = [
      {},
      { status: "pending" },
      { status: "resolved" },
      { assignedToId: someTicket.assignedTo?.id ?? "u-tec-001" },
      { submittedById: someTicket.submittedBy.id },
      { equipmentId: someTicket.equipmentId ?? "p-001" },
      { status: "pending", submittedById: someTicket.submittedBy.id },
      { startDate: "2000-01-01T00:00:00.000Z", endDate: "2100-01-01T00:00:00.000Z" },
      { startDate: "2100-01-01T00:00:00.000Z" },
    ];
    for (const f of cases) {
      const expected = state.tickets.filter(
        (t) =>
          (!("status" in f) || t.status === f.status) &&
          (!("assignedToId" in f) || t.assignedTo?.id === f.assignedToId) &&
          (!("submittedById" in f) || t.submittedBy.id === f.submittedById) &&
          (!("equipmentId" in f) || t.equipmentId === f.equipmentId) &&
          (!("startDate" in f) || Date.parse(t.createdAt) >= Date.parse(f.startDate!)) &&
          (!("endDate" in f) || Date.parse(t.createdAt) <= Date.parse(f.endDate!)),
      );
      expect(byId(await q.listTickets(f))).toEqual(byId(expected));
    }
  });

  test("productos: filtros y disponibles para prestamo", async () => {
    const hasOpenLoan = (id: string) =>
      state.loans.some((l) => l.equipment.id === id && q.OPEN_LOAN_STATUS_LIST.includes(l.status));
    const alive = state.products.filter((p) => p.deletedAt === null);
    const location = alive[0]!.locationId;
    expect(byId(await q.listProducts({}))).toEqual(byId(alive));
    expect(byId(await q.listProducts({ status: "in_repair" }))).toEqual(
      byId(alive.filter((p) => p.status === "in_repair")),
    );
    expect(byId(await q.listProducts({ locationId: location }))).toEqual(
      byId(alive.filter((p) => p.locationId === location)),
    );
    expect(byId(await q.listProducts({ availableForLoan: true }))).toEqual(
      byId(alive.filter((p) => p.status === "available" && !hasOpenLoan(p.id))),
    );
  });

  test("conteos del tablero del staff", async () => {
    const counts = await q.staffCounts();
    const tally = (items: Array<{ status: string }>) => {
      const out: Record<string, number> = {};
      for (const item of items) out[item.status] = (out[item.status] ?? 0) + 1;
      return out;
    };
    expect(counts.ticketsByStatus).toEqual(tally(state.tickets));
    expect(counts.loansByStatus).toEqual(tally(state.loans));
    expect(counts.servicesByStatus).toEqual(tally(state.services));
    expect(counts.equipmentByStatus).toEqual(
      tally(state.products.filter((p) => p.deletedAt === null)),
    );
    expect(counts.unassignedTickets).toBe(
      state.tickets.filter((t) => t.status === "pending" && !t.assignedTo).length,
    );
    expect(counts.serviceCreatedAt.toSorted()).toEqual(
      state.services.map((s) => s.createdAt).toSorted(),
    );
  });

  // El corte por fecha solo poda lo que se lee: la serie del tablero tiene que salir igual
  test("serie de solicitudes: igual con el corte por periodo que sin el", async () => {
    const { servicesByPeriod, dashboardPeriod, periodSince } = await import("./graphql/dashboard");
    for (const name of ["7d", "30d", "90d"]) {
      const period = dashboardPeriod(name);
      const full = await q.staffCounts();
      const cut = await q.staffCounts(periodSince(period));
      expect(servicesByPeriod(cut.serviceCreatedAt, period)).toEqual(
        servicesByPeriod(full.serviceCreatedAt, period),
      );
      expect(cut.serviceCreatedAt.length).toBeLessThanOrEqual(full.serviceCreatedAt.length);
    }
    // Un corte en el futuro no deja ninguna fecha, y el resto de los conteos no cambia
    const none = await q.staffCounts("2999-01-01T00:00:00.000Z");
    expect(none.serviceCreatedAt).toEqual([]);
    expect(none.ticketsByStatus).toEqual((await q.staffCounts()).ticketsByStatus);
  });

  test("tablero del solicitante: igual que calcularlo sobre la foto completa", async () => {
    const { requesterOverview } = await import("./graphql/requester");
    const { requesterDashboard, dashboardPeriod } = await import("./graphql/dashboard");
    const open = new Set<string>(q.OPEN_LOAN_STATUS_LIST);
    // Con el seed son pocos; con una base grande se toma una muestra (los que mas tickets tienen
    // y el primero sin nada) para que el test no dependa del tamaño de los datos
    const counts = new Map<string, number>();
    for (const t of state.tickets)
      counts.set(t.submittedBy.id, (counts.get(t.submittedBy.id) ?? 0) + 1);
    const ticketsOf = (id: string) => counts.get(id) ?? 0;
    const all = state.users.filter((u) => u.role === "solicitante");
    expect(all.length).toBeGreaterThan(0);
    const requesters =
      all.length <= 12
        ? all
        : [
            ...all.toSorted((a, b) => ticketsOf(b.id) - ticketsOf(a.id)).slice(0, 11),
            all.find((u) => ticketsOf(u.id) === 0)!,
          ].filter(Boolean);
    for (const caller of requesters) {
      const stats = requesterDashboard(
        caller,
        await q.requesterData(caller),
        dashboardPeriod("7d"),
      );
      const own = state.tickets.filter((t) => t.submittedBy.id === caller.id);
      const hasOpenLoan = (id: string) =>
        state.loans.some((l) => l.equipment.id === id && open.has(l.status));
      expect(stats.totalEquipment).toBe(
        state.products.filter(
          (p) => p.deletedAt === null && p.status === "available" && !hasOpenLoan(p.id),
        ).length,
      );
      expect(stats.openTickets).toBe(own.filter((t) => t.status !== "resolved").length);
      expect(stats.activeLoans).toBe(
        state.loans.filter((l) => l.user.id === caller.id && open.has(l.status)).length,
      );
      expect(stats.pendingServices).toBe(
        state.services.filter((s) => s.requestedBy.id === caller.id && s.status === "pending")
          .length,
      );
      expect(stats.ticketsByStatus).toEqual(
        (["pending", "in_progress", "in_resolution", "resolved"] as const).map((status) => ({
          status,
          count: own.filter((t) => t.status === status).length,
        })),
      );
      expect(stats.workQueue).toBeNull();
      expect(stats.requesterOverview).toEqual(
        requesterOverview(
          caller.id,
          state.tickets,
          state.loans,
          state.reservations,
          state.locations,
          state.products,
        ),
      );
    }
  }, 30000);

  test("tecnico: las personas relacionadas salen igual de la base que de la foto", async () => {
    const { relatedUserIds } = await import("./graphql/privacy");
    const technicians = state.users.filter((u) => u.role === "tecnico");
    expect(technicians.length).toBeGreaterThan(0);
    for (const tech of technicians) {
      expect(await q.relatedUserIdsFromDb(tech.id)).toEqual(relatedUserIds(state, tech.id));
    }
    expect((await q.relatedUserIdsFromDb("u-no-existe")).size).toBe(0);
  });

  // Regresion: `tickets` ya no carga la foto (ctx.state vacio) y el tecnico perdia dni y email
  test("tecnico: ve el contacto de sus personas aunque la query no cargue la foto", async () => {
    const { canSeeContact, relatedUserIds } = await import("./graphql/privacy");
    const tech = state.users.find(
      (u) => u.role === "tecnico" && relatedUserIds(state, u.id).size > 0,
    );
    if (!tech) throw new Error("el seed no tiene un tecnico con personas relacionadas");
    const related = [...relatedUserIds(state, tech.id)][0]!;
    const unrelated = state.users.find(
      (u) =>
        u.id !== tech.id && !relatedUserIds(state, tech.id).has(u.id) && u.role !== "root_admin",
    )!;
    const stateless = { caller: tech, ip: "test", token: null } as unknown as Parameters<
      typeof canSeeContact
    >[0];
    const withState = { ...stateless, state } as Parameters<typeof canSeeContact>[0];
    for (const ctx of [stateless, withState]) {
      expect(await canSeeContact(ctx, { id: related })).toBe(true);
      expect(await canSeeContact(ctx, { id: unrelated.id })).toBe(false);
      expect(await canSeeContact(ctx, { id: tech.id })).toBe(true);
    }
  });
});
