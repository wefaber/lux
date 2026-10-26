import type {
  CategoryEstimate,
  Loan,
  Location,
  Product,
  RequesterArea,
  RequesterOverview,
  Reservation,
  SatisfactionSummary,
  Ticket,
  TicketCategory,
  TicketEstimates,
} from "@/lib/types";

// Lo que ve el solicitante en su inicio. Se calcula aca, lejos de los resolvers,
// para poder probarlo sin base de datos: recibe las colecciones ya cargadas.
// El espejo en el frontend es src/mocks/requester.ts.

const TICKET_CATEGORIES: TicketCategory[] = ["hardware", "software", "network", "other"];

// Una categoria necesita al menos esta cantidad de tickets resueltos para tener
// su propio promedio; si no, se usa el promedio general
export const MIN_CATEGORY_SAMPLES = 3;

const HOUR = 3_600_000;

function hoursBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  const diff = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(diff) && diff >= 0 ? diff / HOUR : null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

function estimateFor(tickets: Ticket[]): Omit<CategoryEstimate, "category"> {
  const resolved = tickets.filter((t) => t.status === "resolved" && t.resolvedAt);
  const attend = resolved
    .map((t) => hoursBetween(t.createdAt, t.attendedAt))
    .filter((h): h is number => h !== null);
  const resolve = resolved
    .map((t) => hoursBetween(t.createdAt, t.resolvedAt))
    .filter((h): h is number => h !== null);
  return {
    toAttendHours: average(attend),
    toResolveHours: average(resolve),
    sampleSize: resolved.length,
  };
}

/** Promedios del area: general mas el de cada categoria con muestra suficiente. */
export function ticketEstimates(all: Ticket[]): TicketEstimates {
  const general = estimateFor(all);
  const byCategory: CategoryEstimate[] = TICKET_CATEGORIES.flatMap((category) => {
    const estimate = estimateFor(all.filter((t) => t.category === category));
    return estimate.sampleSize >= MIN_CATEGORY_SAMPLES ? [{ category, ...estimate }] : [];
  });
  return { ...general, byCategory };
}

/** Promedio de las valoraciones que dejo una persona (no del sistema). */
export function satisfactionOf(tickets: Ticket[], userId: string): SatisfactionSummary {
  const ratings = tickets
    .filter((t) => t.submittedBy.id === userId && t.rating !== null)
    .map((t) => t.rating as number);
  return { average: average(ratings), count: ratings.length };
}

/** Sus tickets sin resolver, del ultimo movimiento al mas viejo. */
export function activeTicketsOf(tickets: Ticket[], userId: string, limit = 5): Ticket[] {
  return tickets
    .filter((t) => t.submittedBy.id === userId && t.status !== "resolved")
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

// Un lugar entra en "areas que usa" solo si el propio solicitante lo toco con
// un ticket, un prestamo o una reserva.
function usedLocationIds(
  userId: string,
  tickets: Ticket[],
  loans: Loan[],
  reservations: Reservation[],
): Set<string> {
  const ids = new Set<string>();
  for (const t of tickets) {
    if (t.submittedBy.id === userId && t.equipment) ids.add(t.equipment.locationId);
  }
  for (const l of loans) {
    if (l.user.id === userId) ids.add(l.equipment.locationId);
  }
  for (const r of reservations) {
    if (r.user.id !== userId) continue;
    if (r.location) ids.add(r.location.id);
    if (r.equipment) ids.add(r.equipment.locationId);
  }
  return ids;
}

export function requesterAreas(
  userId: string,
  tickets: Ticket[],
  loans: Loan[],
  reservations: Reservation[],
  locations: Location[],
  products: Product[],
): RequesterArea[] {
  const used = usedLocationIds(userId, tickets, loans, reservations);
  return locations
    .filter((l) => l.deletedAt === null && used.has(l.id))
    .map((location) => {
      const equipment = products.filter((p) => p.deletedAt === null && p.locationId === location.id);
      const count = (status: Product["status"]) => equipment.filter((p) => p.status === status).length;
      return {
        location: { ...location, productCount: equipment.length },
        available: count("available"),
        inUse: count("in_use"),
        inRepair: count("in_repair"),
        retired: count("retired"),
        openTickets: tickets.filter(
          (t) =>
            t.submittedBy.id === userId &&
            t.status !== "resolved" &&
            t.equipment?.locationId === location.id,
        ).length,
      };
    })
    .toSorted((a, b) => a.location.name.localeCompare(b.location.name));
}

export function requesterOverview(
  userId: string,
  tickets: Ticket[],
  loans: Loan[],
  reservations: Reservation[],
  locations: Location[],
  products: Product[],
): RequesterOverview {
  return {
    activeTickets: activeTicketsOf(tickets, userId),
    estimates: ticketEstimates(tickets),
    satisfaction: satisfactionOf(tickets, userId),
    areas: requesterAreas(userId, tickets, loans, reservations, locations, products),
  };
}
