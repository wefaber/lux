import type { DashboardPeriod } from "@/lib/constants";
import type { DashboardStats, TicketStatus, User } from "@/lib/types";
import { OPEN_LOAN_STATUS_LIST } from "../db/enums";
import type { RequesterData, StaffCounts } from "../queries";
import { requesterOverview } from "./requester";

// Arma el tablero a partir de los conteos que leen las queries acotadas
// (queries.ts). Es puro, sin base de datos: asi se prueban los bordes (base
// vacia, limites de cada tramo, periodo desconocido).

export interface Period {
  days: number;
  bucketDays: number;
}

const PERIOD_BUCKETS: Record<DashboardPeriod, Period> = {
  "7d": { days: 7, bucketDays: 1 },
  "30d": { days: 30, bucketDays: 1 },
  "90d": { days: 91, bucketDays: 7 },
};

/**
 * Periodo desconocido o ausente: ultimos 7 dias. Se busca con hasOwn y no con
 * `PERIOD_BUCKETS[period]`: "constructor" o "__proto__" devolverian propiedades
 * heredadas de Object, `days` seria undefined y la serie saldria vacia.
 */
export function dashboardPeriod(period: string | undefined): Period {
  const known = period !== undefined && Object.hasOwn(PERIOD_BUCKETS, period);
  return PERIOD_BUCKETS[known ? (period as DashboardPeriod) : "7d"];
}

const DASHBOARD_TICKET_STATUSES: TicketStatus[] = [
  "pending",
  "in_progress",
  "in_resolution",
  "resolved",
];

// Cantidad de solicitudes por tramo del periodo, hasta el fin del dia (UTC) de hoy.
// Cada tramo incluye su inicio y excluye su fin.
export function servicesByPeriod(
  createdAt: string[],
  { days, bucketDays }: Period,
  now: Date = new Date(),
) {
  const todayEnd = new Date(now);
  todayEnd.setUTCHours(24, 0, 0, 0);
  const bucketCount = Math.ceil(days / bucketDays);
  return Array.from({ length: bucketCount }, (_, i) => {
    const end = new Date(todayEnd);
    end.setUTCDate(end.getUTCDate() - (bucketCount - 1 - i) * bucketDays);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - bucketDays);
    const count = createdAt.filter((value) => {
      const created = new Date(value);
      return created >= start && created < end;
    }).length;
    return { date: start.toISOString().slice(0, 10), count };
  });
}

// Inicio del primer tramo (menos un dia de margen, porque solo poda lo que se lee): las
// solicitudes anteriores no entran en la serie. Es el corte para `staffCounts` y `requesterData`.
export function periodSince({ days, bucketDays }: Period, now: Date = new Date()): string {
  const start = new Date(now);
  start.setUTCHours(24, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - Math.ceil(days / bucketDays) * bucketDays - 1);
  return start.toISOString();
}

const sumStatuses = (by: Record<string, number>, statuses: readonly string[]) =>
  statuses.reduce((total, status) => total + (by[status] ?? 0), 0);

// Tablero del staff a partir de los conteos de la base.
export function staffDashboard(
  counts: StaffCounts,
  period: Period,
  now: Date = new Date(),
): DashboardStats {
  const { ticketsByStatus, loansByStatus, servicesByStatus, equipmentByStatus } = counts;
  return {
    totalEquipment: sumStatuses(equipmentByStatus, Object.keys(equipmentByStatus)),
    openTickets: sumStatuses(ticketsByStatus, ["pending", "in_progress", "in_resolution"]),
    activeLoans: sumStatuses(loansByStatus, OPEN_LOAN_STATUS_LIST),
    pendingServices: servicesByStatus.pending ?? 0,
    ticketsByStatus: DASHBOARD_TICKET_STATUSES.map((status) => ({
      status,
      count: ticketsByStatus[status] ?? 0,
    })),
    servicesByPeriod: servicesByPeriod(counts.serviceCreatedAt, period, now),
    workQueue: {
      unassignedTickets: counts.unassignedTickets,
      ticketsInProgress: sumStatuses(ticketsByStatus, ["in_progress", "in_resolution"]),
      pendingServices: servicesByStatus.pending ?? 0,
      overdueLoans: loansByStatus.overdue ?? 0,
      equipmentInRepair: equipmentByStatus.in_repair ?? 0,
    },
    requesterOverview: null,
  };
}

// Tablero del solicitante: solo sus filas, mas los promedios del area.
export function requesterDashboard(
  caller: Pick<User, "id">,
  data: RequesterData,
  period: Period,
  now: Date = new Date(),
): DashboardStats {
  const own = data.ownTickets;
  const openLoans = new Set<string>(OPEN_LOAN_STATUS_LIST);
  return {
    totalEquipment: data.availableEquipment,
    openTickets: own.filter((tk) => tk.status !== "resolved").length,
    activeLoans: data.ownLoans.filter((l) => openLoans.has(l.status)).length,
    pendingServices: data.servicesByStatus.pending ?? 0,
    ticketsByStatus: DASHBOARD_TICKET_STATUSES.map((status) => ({
      status,
      count: own.filter((tk) => tk.status === status).length,
    })),
    servicesByPeriod: servicesByPeriod(data.serviceCreatedAt, period, now),
    workQueue: null,
    // Lo del solicitante tampoco viaja al staff: cada rol ve su tablero
    requesterOverview: requesterOverview(
      caller.id,
      own,
      data.ownLoans,
      data.ownReservations,
      data.locations,
      data.areaProducts,
      data.resolvedForEstimates,
    ),
  };
}
