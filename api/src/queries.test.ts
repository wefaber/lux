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
});
