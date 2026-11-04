import { and, count, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { Component, LoanStatus, Product, Ticket, User } from "@/lib/types";
import { db, readAll } from "./db/client";
import * as t from "./db/schema";
import { withinInstantRange } from "./graphql/date-range";
import { toComponent, toLocation, toProduct, toTicket, toUser } from "./state";

// Lecturas acotadas: cada query pide a la base solo lo que necesita (WHERE por
// los filtros y relaciones por id) en vez de la foto completa de `loadState()`.
// Los objetos salen de los mismos mapeadores de state.ts, asi que el resultado
// es el mismo que el de filtrar la foto en memoria (ver issue #115).

/** Estados de un prestamo que ocupan el equipo. */
export const OPEN_LOAN_STATUS_LIST: LoanStatus[] = ["approved", "active", "overdue"];

/** `inArray` sin ids genera SQL invalido segun la version: se evita la consulta. */
function nonEmpty(ids: Iterable<string>): string[] | null {
  const list = [...new Set(ids)];
  return list.length > 0 ? list : null;
}

/** Equipos con sus componentes vigentes, a partir de filas ya leidas. */
async function withComponents(rows: t.ProductRow[]): Promise<Product[]> {
  const ids = nonEmpty(rows.map((row) => row.id));
  const componentRows = ids
    ? await db
        .select()
        .from(t.components)
        .where(and(inArray(t.components.productId, ids), isNull(t.components.deletedAt)))
    : [];
  const byProduct = new Map<string, Component[]>();
  for (const row of componentRows) {
    const component = toComponent(row);
    const list = byProduct.get(row.productId!);
    if (list) list.push(component);
    else byProduct.set(row.productId!, [component]);
  }
  return rows.map((row) => {
    const product = toProduct(row);
    product.components = byProduct.get(product.id) ?? [];
    return product;
  });
}

export interface ProductFilters {
  status?: string;
  locationId?: string;
  availableForLoan?: boolean;
}

/** Equipos vigentes; `availableForLoan` excluye los que tienen un prestamo abierto. */
export async function listProducts(filters: ProductFilters): Promise<Product[]> {
  const conditions = [isNull(t.products.deletedAt)];
  if (filters.status) conditions.push(eq(t.products.status, filters.status));
  if (filters.locationId) conditions.push(eq(t.products.locationId, filters.locationId));
  if (filters.availableForLoan) {
    conditions.push(eq(t.products.status, "available"));
    conditions.push(
      notExists(
        db
          .select({ one: sql`1` })
          .from(t.loans)
          .where(
            and(
              eq(t.loans.equipmentId, t.products.id),
              inArray(t.loans.status, OPEN_LOAN_STATUS_LIST),
              isNull(t.loans.deletedAt),
            ),
          ),
      ),
    );
  }
  const rows = await db
    .select()
    .from(t.products)
    .where(and(...conditions));
  return withComponents(rows);
}

export interface TicketFilters {
  status?: string;
  assignedToId?: string;
  submittedById?: string;
  equipmentId?: string;
  startDate?: string;
  endDate?: string;
}

/** Tickets vigentes que cumplen los filtros, con solo los usuarios, equipos y lugares que citan. */
export async function listTickets(filters: TicketFilters): Promise<Ticket[]> {
  const conditions = [isNull(t.tickets.deletedAt)];
  if (filters.status) conditions.push(eq(t.tickets.status, filters.status));
  if (filters.assignedToId) conditions.push(eq(t.tickets.assignedToId, filters.assignedToId));
  if (filters.submittedById) conditions.push(eq(t.tickets.submittedById, filters.submittedById));
  if (filters.equipmentId) conditions.push(eq(t.tickets.equipmentId, filters.equipmentId));
  let rows = await db
    .select()
    .from(t.tickets)
    .where(and(...conditions));
  // El rango compara instantes, no texto: se aplica sobre lo que ya devolvio la base
  if (filters.startDate || filters.endDate) {
    rows = rows.filter((row) =>
      withinInstantRange(row.createdAt, filters.startDate, filters.endDate),
    );
  }

  const userIds = nonEmpty(
    rows.flatMap((r) => (r.assignedToId ? [r.submittedById, r.assignedToId] : [r.submittedById])),
  );
  const productIds = nonEmpty(rows.flatMap((r) => (r.equipmentId ? [r.equipmentId] : [])));
  const locationIds = nonEmpty(rows.flatMap((r) => (r.locationId ? [r.locationId] : [])));
  const [userRows, productRows, locationRows] = await readAll([
    () =>
      userIds ? db.select().from(t.users).where(inArray(t.users.id, userIds)) : Promise.resolve([]),
    () =>
      productIds
        ? db.select().from(t.products).where(inArray(t.products.id, productIds))
        : Promise.resolve([]),
    () =>
      locationIds
        ? db.select().from(t.locations).where(inArray(t.locations.id, locationIds))
        : Promise.resolve([]),
  ] as const);
  const usersById = new Map<string, User>(userRows.map((r) => [r.id, toUser(r)]));
  const productsById = new Map<string, Product>(
    (await withComponents(productRows)).map((p) => [p.id, p]),
  );
  const locationsById = new Map(locationRows.map((r) => [r.id, toLocation(r)]));

  return rows.map((row) =>
    toTicket(row, {
      user: (id) => (id ? (usersById.get(id) ?? null) : null),
      product: (id) => (id ? (productsById.get(id) ?? null) : null),
      location: (id) => locationsById.get(id) ?? null,
    }),
  );
}

/** Conteos del tablero del staff, calculados en la base; los vencidos se sincronizan antes. */
export interface StaffCounts {
  ticketsByStatus: Record<string, number>;
  unassignedTickets: number;
  loansByStatus: Record<string, number>;
  servicesByStatus: Record<string, number>;
  serviceCreatedAt: string[];
  equipmentByStatus: Record<string, number>;
}

function tally(rows: Array<{ status: string; n: number }>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
}

export async function staffCounts(): Promise<StaffCounts> {
  const [tickets, unassigned, loans, services, serviceDates, equipment] = await readAll([
    () =>
      db
        .select({ status: t.tickets.status, n: count() })
        .from(t.tickets)
        .where(isNull(t.tickets.deletedAt))
        .groupBy(t.tickets.status),
    () =>
      db
        .select({ n: count() })
        .from(t.tickets)
        .where(
          and(
            isNull(t.tickets.deletedAt),
            eq(t.tickets.status, "pending"),
            isNull(t.tickets.assignedToId),
          ),
        ),
    () =>
      db
        .select({ status: t.loans.status, n: count() })
        .from(t.loans)
        .where(isNull(t.loans.deletedAt))
        .groupBy(t.loans.status),
    () =>
      db
        .select({ status: t.serviceRequests.status, n: count() })
        .from(t.serviceRequests)
        .where(isNull(t.serviceRequests.deletedAt))
        .groupBy(t.serviceRequests.status),
    // Solo la fecha: el reparto en tramos compara instantes en JS
    () =>
      db
        .select({ createdAt: t.serviceRequests.createdAt })
        .from(t.serviceRequests)
        .where(isNull(t.serviceRequests.deletedAt)),
    () =>
      db
        .select({ status: t.products.status, n: count() })
        .from(t.products)
        .where(isNull(t.products.deletedAt))
        .groupBy(t.products.status),
  ] as const);
  return {
    ticketsByStatus: tally(tickets),
    unassignedTickets: unassigned[0]?.n ?? 0,
    loansByStatus: tally(loans),
    servicesByStatus: tally(services),
    serviceCreatedAt: serviceDates.map((row) => row.createdAt),
    equipmentByStatus: tally(equipment),
  };
}

/** Prestamos entregados cuya devolucion ya paso: lo unico que `syncOverdueLoans` necesita escribir. */
export async function hasOverdueToSync(now: Date = new Date()): Promise<boolean> {
  const active = await db
    .select({ returnDate: t.loans.returnDate })
    .from(t.loans)
    .where(and(eq(t.loans.status, "active"), isNull(t.loans.deletedAt)));
  return active.some((loan) => new Date(loan.returnDate) < now);
}
