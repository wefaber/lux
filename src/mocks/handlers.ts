import { graphql, HttpResponse } from "msw";
import { mockUsers, mockPasswords } from "./data/users";
import { mockProducts, mockComponents } from "./data/equipment";
import { mockTickets } from "./data/tickets";
import { mockLoans } from "./data/loans";
import { mockServices } from "./data/services";
import { mockActivityLogs } from "./generators";
import { validateComponent, validateProduct, type FieldErrors } from "@/lib/validation";
import {
  LOAN_STATUS_CONFIG,
  TICKET_STATUS_CONFIG,
  TICKET_TRANSITIONS,
  type DashboardPeriod,
} from "@/lib/constants";
import type {
  User,
  UserRole,
  Product,
  Component,
  Ticket,
  Loan,
  ServiceRequest,
  DashboardStats,
  Reports,
  TicketCategory,
  TicketStatus,
  LoanStatus,
  ServiceStatus,
} from "@/lib/types";

function filterByStatus<T extends { status: string }>(items: T[], status?: string): T[] {
  if (!status) return items;
  return items.filter((i) => i.status === status);
}

// Siguiente id correlativo de una coleccion, con el mismo formato que los datos
// de ejemplo: "tkt-015" -> "tkt-016". Antes se usaba Date.now(), que rompia la
// numeracion (tkt-1791397200123) y repetia el id si se creaban dos en el mismo ms.
function nextId(prefix: string, items: Array<{ id: string }>, pad = 0): string {
  const max = items.reduce((n, { id }) => {
    const suffix = id.startsWith(prefix) ? id.slice(prefix.length) : "";
    return /^\d+$/.test(suffix) ? Math.max(n, Number(suffix)) : n;
  }, 0);
  return prefix + String(max + 1).padStart(pad, "0");
}

// Los usuarios de ejemplo se numeran por rol: u-sol-12, u-tec-3, u-admin-2
const USER_ID_PREFIX: Record<UserRole, string> = {
  root_admin: "u-root-",
  admin: "u-admin-",
  tecnico: "u-tec-",
  solicitante: "u-sol-",
};

const STAFF_ROLES: UserRole[] = ["root_admin", "admin", "tecnico"];
const ELEVATED_ROLES: UserRole[] = ["root_admin", "admin"];

// Simula la verificacion de un token en un backend real: lo resuelve desde
// el header Authorization en vez de leer localStorage directamente.
function getCaller(request: Request): User | null {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.match(/^Bearer (.+)$/)?.[1];
  const userId = token?.match(/^mock-token-(.+)$/)?.[1];
  if (!userId) return null;
  return mockUsers.find((u) => u.id === userId && u.isActive) ?? null;
}

function hasRole(caller: User | null, allowedRoles: UserRole[]): caller is User {
  return caller !== null && allowedRoles.includes(caller.role);
}

function isStaff(user: User): boolean {
  return STAFF_ROLES.includes(user.role);
}

// 90 dias en barras diarias no se lee: se agrupa por semana
const PERIOD_BUCKETS: Record<DashboardPeriod, { days: number; bucketDays: number }> = {
  "7d": { days: 7, bucketDays: 1 },
  "30d": { days: 30, bucketDays: 1 },
  "90d": { days: 91, bucketDays: 7 },
};

const UNAUTHENTICATED = { errors: [{ message: "No autenticado" }] };
const FORBIDDEN = { errors: [{ message: "No tenés permisos para esta acción" }] };

// Estados en los que el prestamo compromete el equipo: aprobado y todavia no
// entregado, o entregado y todavia no devuelto.
const OPEN_LOAN_STATUSES = new Set<LoanStatus>(["approved", "active", "overdue"]);
// Incluye los pendientes: bloquean dar de baja lo que alguien ya pidio
const IN_COURSE_LOAN_STATUSES = new Set<LoanStatus>(["pending", ...OPEN_LOAN_STATUSES]);

function hasOpenLoan(equipmentId: string, exceptLoanId?: string): boolean {
  return mockLoans.some(
    (l) =>
      l.id !== exceptLoanId && l.equipment.id === equipmentId && OPEN_LOAN_STATUSES.has(l.status),
  );
}

// Un prestamo entregado cuya fecha de devolucion ya paso queda vencido. En un
// backend real lo haria un job programado; aca se resuelve en cada lectura.
function syncOverdueLoans(): void {
  const now = new Date();
  for (const loan of mockLoans) {
    if (loan.status === "active" && new Date(loan.returnDate) < now) {
      loan.status = "overdue";
    }
  }
}

function canTransitionTicket(ticket: Ticket, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[ticket.status].includes(to);
}

function invalidTicketTransition(ticket: Ticket, to: TicketStatus): string {
  return `No se puede pasar un ticket de "${TICKET_STATUS_CONFIG[ticket.status].label}" a "${TICKET_STATUS_CONFIG[to].label}"`;
}

function firstError(errors: FieldErrors<string>): string | null {
  return Object.values(errors)[0] ?? null;
}

// machineId y n° de serie identifican al equipo: no se repiten entre los vigentes
function duplicateProductError(
  fields: { machineId: string; serialNumber: string },
  exceptId?: string,
): string | null {
  const others = mockProducts.filter((p) => p.deletedAt === null && p.id !== exceptId);
  if (others.some((p) => p.machineId === fields.machineId)) {
    return `Ya existe un equipo con ID ${fields.machineId}`;
  }
  if (others.some((p) => p.serialNumber === fields.serialNumber)) {
    return `Ya existe un equipo con n° de serie ${fields.serialNumber}`;
  }
  return null;
}

const CLOSED_SERVICE_STATUSES = new Set<ServiceStatus>(["completed", "rejected"]);

// Horas entre el alta y la resolucion, redondeadas a un decimal
function averageResolutionHours(tickets: Ticket[]): number | null {
  const resolved = tickets.filter((t) => t.status === "resolved" && t.resolvedAt);
  if (resolved.length === 0) return null;
  const total = resolved.reduce(
    (sum, t) => sum + (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()),
    0,
  );
  return Math.round((total / resolved.length / 3_600_000) * 10) / 10;
}

function invalidLoanTransition(loan: Loan, action: string): string {
  return `No se puede ${action} un préstamo en estado "${LOAN_STATUS_CONFIG[loan.status].label}"`;
}

export const handlers = [
  graphql.query("Login", ({ variables }) => {
    const { dni, password } = variables as { dni: string; password: string };
    const user = mockUsers.find((u) => u.dni === dni && u.isActive);
    if (!user || mockPasswords[dni] !== password) {
      return HttpResponse.json({
        errors: [{ message: "Credenciales inválidas" }],
      });
    }
    return HttpResponse.json({
      data: {
        login: { ...user, token: `mock-token-${user.id}` },
      },
    });
  }),

  graphql.query("GetMe", ({ request }) => {
    return HttpResponse.json({ data: { me: getCaller(request) } });
  }),

  graphql.query("GetUsers", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    if (!isStaff(caller)) return HttpResponse.json(FORBIDDEN);
    const { role, isActive } = variables as { role?: string; isActive?: boolean };
    let users = [...mockUsers];
    if (role) users = users.filter((u) => u.role === role);
    if (isActive !== undefined) users = users.filter((u) => u.isActive === isActive);
    return HttpResponse.json({ data: { users } });
  }),

  graphql.query("GetUser", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { id } = variables as { id: string };
    if (!isStaff(caller) && id !== caller.id) return HttpResponse.json(FORBIDDEN);
    const user = mockUsers.find((u) => u.id === id);
    return HttpResponse.json({ data: { user: user ?? null } });
  }),

  graphql.query("GetProducts", ({ request, variables }) => {
    if (!getCaller(request)) return HttpResponse.json(UNAUTHENTICATED);
    const { status, location, availableForLoan } = variables as {
      status?: string;
      location?: string;
      availableForLoan?: boolean;
    };
    let products = mockProducts.filter((p) => p.deletedAt === null);
    if (status) products = products.filter((p) => p.status === status);
    // Disponible pero ya aprobado para otro prestamo no se puede volver a pedir
    if (availableForLoan) {
      products = products.filter((p) => p.status === "available" && !hasOpenLoan(p.id));
    }
    if (location) products = products.filter((p) => p.location === location);
    return HttpResponse.json({ data: { products } });
  }),

  graphql.query("GetProduct", ({ request, variables }) => {
    if (!getCaller(request)) return HttpResponse.json(UNAUTHENTICATED);
    const { id } = variables as { id: string };
    const product = mockProducts.find((p) => p.id === id) ?? null;
    return HttpResponse.json({ data: { product } });
  }),

  graphql.query("GetProductByMachineId", ({ request, variables }) => {
    if (!getCaller(request)) return HttpResponse.json(UNAUTHENTICATED);
    const { machineId } = variables as { machineId: string };
    const product = mockProducts.find((p) => p.machineId === machineId && p.deletedAt === null) ?? null;
    return HttpResponse.json({ data: { productByMachineId: product } });
  }),

  graphql.query("GetComponents", ({ request, variables }) => {
    if (!getCaller(request)) return HttpResponse.json(UNAUTHENTICATED);
    const { productId, isWorking } = variables as { productId?: string; isWorking?: boolean };
    let components = mockComponents.filter((c) => c.deletedAt === null);
    if (productId !== undefined) {
      components = components.filter((c) => c.productId === productId);
    }
    if (isWorking !== undefined) {
      components = components.filter((c) => c.isWorking === isWorking);
    }
    return HttpResponse.json({ data: { components } });
  }),

  graphql.query("GetComponent", ({ request, variables }) => {
    if (!getCaller(request)) return HttpResponse.json(UNAUTHENTICATED);
    const { id } = variables as { id: string };
    const component = mockComponents.find((c) => c.id === id) ?? null;
    return HttpResponse.json({ data: { component } });
  }),

  graphql.query("GetTickets", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { status, assignedToId, submittedById, equipmentId } = variables as {
      status?: TicketStatus;
      assignedToId?: string;
      submittedById?: string;
      equipmentId?: string;
    };
    // El solicitante solo ve sus tickets, mande el filtro que mande
    const scopedSubmittedById = isStaff(caller) ? submittedById : caller.id;
    let tickets = [...mockTickets];
    if (status) tickets = tickets.filter((t) => t.status === status);
    if (assignedToId) tickets = tickets.filter((t) => t.assignedTo?.id === assignedToId);
    if (scopedSubmittedById) {
      tickets = tickets.filter((t) => t.submittedBy.id === scopedSubmittedById);
    }
    if (equipmentId) tickets = tickets.filter((t) => t.equipmentId === equipmentId);
    return HttpResponse.json({ data: { tickets } });
  }),

  graphql.query("GetTicket", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { id } = variables as { id: string };
    const ticket = mockTickets.find((t) => t.id === id) ?? null;
    if (ticket && !isStaff(caller) && ticket.submittedBy.id !== caller.id) {
      return HttpResponse.json(FORBIDDEN);
    }
    return HttpResponse.json({ data: { ticket } });
  }),

  graphql.query("GetOolTickets", ({ request }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) return HttpResponse.json(FORBIDDEN);
    const ool = mockTickets.filter((t) => t.status === "pending" && t.assignedTo === null);
    return HttpResponse.json({ data: { oolTickets: ool } });
  }),

  graphql.query("GetLoans", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json({ errors: [{ message: "No autenticado" }] });
    syncOverdueLoans();
    const { status, userId, equipmentId } = variables as {
      status?: LoanStatus;
      userId?: string;
      equipmentId?: string;
    };
    // El solicitante solo ve sus prestamos, mande el filtro que mande
    const scopedUserId = isStaff(caller) ? userId : caller.id;
    let loans = [...mockLoans];
    if (status) loans = filterByStatus<Loan>(loans, status);
    if (scopedUserId) loans = loans.filter((l) => l.user.id === scopedUserId);
    if (equipmentId) loans = loans.filter((l) => l.equipment.id === equipmentId);
    return HttpResponse.json({ data: { loans } });
  }),

  graphql.query("GetLoan", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json({ errors: [{ message: "No autenticado" }] });
    syncOverdueLoans();
    const { id } = variables as { id: string };
    const loan = mockLoans.find((l) => l.id === id) ?? null;
    if (loan && !isStaff(caller) && loan.user.id !== caller.id) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    return HttpResponse.json({ data: { loan } });
  }),

  graphql.query("GetServiceRequests", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { status, requestedById } = variables as {
      status?: ServiceStatus;
      requestedById?: string;
    };
    // El solicitante solo ve sus solicitudes, mande el filtro que mande
    const scopedRequestedById = isStaff(caller) ? requestedById : caller.id;
    let services = [...mockServices];
    if (status) services = filterByStatus<ServiceRequest>(services, status);
    if (scopedRequestedById) {
      services = services.filter((s) => s.requestedBy.id === scopedRequestedById);
    }
    return HttpResponse.json({ data: { serviceRequests: services } });
  }),

  graphql.query("GetServiceRequest", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { id } = variables as { id: string };
    const serviceRequest = mockServices.find((s) => s.id === id) ?? null;
    if (serviceRequest && !isStaff(caller) && serviceRequest.requestedBy.id !== caller.id) {
      return HttpResponse.json(FORBIDDEN);
    }
    return HttpResponse.json({ data: { serviceRequest } });
  }),

  graphql.query("GetDashboardStats", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    syncOverdueLoans();
    const { period } = variables as { period?: string };
    const { days, bucketDays } = PERIOD_BUCKETS[period as DashboardPeriod] ?? PERIOD_BUCKETS["7d"];

    // El staff ve el sistema completo; el solicitante, solo lo suyo
    const staff = isStaff(caller);
    const tickets = staff ? mockTickets : mockTickets.filter((t) => t.submittedBy.id === caller.id);
    const loans = staff ? mockLoans : mockLoans.filter((l) => l.user.id === caller.id);
    const services = staff
      ? mockServices
      : mockServices.filter((s) => s.requestedBy.id === caller.id);
    // Al solicitante le sirve saber cuantos equipos puede pedir, no el inventario total
    const equipment = mockProducts.filter(
      (p) => p.deletedAt === null && (staff || (p.status === "available" && !hasOpenLoan(p.id))),
    );

    const ticketStatuses: TicketStatus[] = ["pending", "in_progress", "in_resolution", "resolved"];
    const ticketsByStatus: DashboardStats["ticketsByStatus"] = ticketStatuses.map((status) => ({
      status,
      count: tickets.filter((t) => t.status === status).length,
    }));

    const todayEnd = new Date();
    todayEnd.setUTCHours(24, 0, 0, 0);
    const bucketCount = Math.ceil(days / bucketDays);
    const servicesByPeriod: DashboardStats["servicesByPeriod"] = Array.from(
      { length: bucketCount },
      (_, i) => {
        const end = new Date(todayEnd);
        end.setUTCDate(end.getUTCDate() - (bucketCount - 1 - i) * bucketDays);
        const start = new Date(end);
        start.setUTCDate(start.getUTCDate() - bucketDays);
        const count = services.filter((s) => {
          const created = new Date(s.createdAt);
          return created >= start && created < end;
        }).length;
        return { date: start.toISOString().slice(0, 10), count };
      },
    );

    const stats: DashboardStats = {
      totalEquipment: equipment.length,
      openTickets: tickets.filter((t) => t.status !== "resolved").length,
      activeLoans: loans.filter((l) => OPEN_LOAN_STATUSES.has(l.status)).length,
      pendingServices: services.filter((s) => s.status === "pending").length,
      ticketsByStatus,
      servicesByPeriod,
      // La carga de trabajo del area solo viaja al staff: al solicitante ni se le manda
      workQueue: staff
        ? {
            unassignedTickets: mockTickets.filter((t) => t.status === "pending" && !t.assignedTo)
              .length,
            ticketsInProgress: mockTickets.filter(
              (t) => t.status === "in_progress" || t.status === "in_resolution",
            ).length,
            pendingServices: mockServices.filter((s) => s.status === "pending").length,
            overdueLoans: mockLoans.filter((l) => l.status === "overdue").length,
            equipmentInRepair: mockProducts.filter(
              (p) => p.deletedAt === null && p.status === "in_repair",
            ).length,
          }
        : null,
    };

    return HttpResponse.json({ data: { dashboardStats: stats } });
  }),

  graphql.query("GetReports", ({ request }) => {
    if (!hasRole(getCaller(request), ELEVATED_ROLES)) return HttpResponse.json(FORBIDDEN);
    syncOverdueLoans();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const overdueLoans: Reports["overdueLoans"] = mockLoans
      .filter((l) => l.status === "overdue")
      .map((l) => ({
        loanId: l.id,
        machineId: l.equipment.machineId,
        equipment: `${l.equipment.brand} ${l.equipment.model}`,
        user: l.user.name,
        returnDate: l.returnDate,
        daysOverdue: Math.floor((now - new Date(l.returnDate).getTime()) / DAY),
      }))
      .toSorted((a, b) => b.daysOverdue - a.daysOverdue);

    const categories: TicketCategory[] = ["hardware", "software", "network", "other"];
    const resolution: Reports["resolution"] = {
      resolvedCount: mockTickets.filter((t) => t.status === "resolved" && t.resolvedAt).length,
      averageHours: averageResolutionHours(mockTickets),
      byCategory: categories.map((category) => {
        const tickets = mockTickets.filter((t) => t.category === category);
        return {
          category,
          resolvedCount: tickets.filter((t) => t.status === "resolved" && t.resolvedAt).length,
          averageHours: averageResolutionHours(tickets),
        };
      }),
    };

    const topIncidentEquipment: Reports["topIncidentEquipment"] = mockProducts
      .map((p) => {
        const tickets = mockTickets.filter((t) => t.equipmentId === p.id);
        return {
          equipmentId: p.id,
          machineId: p.machineId,
          equipment: `${p.brand} ${p.model}`,
          ticketCount: tickets.length,
          openCount: tickets.filter((t) => t.status !== "resolved").length,
        };
      })
      .filter((e) => e.ticketCount > 0)
      .toSorted((a, b) => b.ticketCount - a.ticketCount || b.openCount - a.openCount)
      .slice(0, 10);

    const reports: Reports = { overdueLoans, resolution, topIncidentEquipment };
    return HttpResponse.json({ data: { reports } });
  }),

  graphql.query("GetActivityLogs", ({ request, variables }) => {
    if (!hasRole(getCaller(request), ELEVATED_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { userId, operation, startDate, endDate } = variables as {
      userId?: string;
      operation?: string;
      startDate?: string;
      endDate?: string;
    };
    let logs = [...mockActivityLogs];
    if (userId) logs = logs.filter((l) => l.userId === userId);
    if (operation) logs = logs.filter((l) => l.operation === operation);
    if (startDate) logs = logs.filter((l) => l.timestamp >= startDate);
    if (endDate) logs = logs.filter((l) => l.timestamp <= endDate);
    return HttpResponse.json({ data: { activityLogs: logs } });
  }),

  graphql.mutation("CreateTicket", ({ request, variables }) => {
    const user = getCaller(request);
    if (!user) return HttpResponse.json({ errors: [{ message: "No autenticado" }] });
    const { input } = variables as {
      input: { title: string; description: string; category: string; equipmentId?: string };
    };
    const equipment = input.equipmentId
      ? (mockProducts.find((p) => p.id === input.equipmentId) ?? null)
      : null;
    const newTicket: Ticket = {
      id: nextId("tkt-", mockTickets, 3),
      title: input.title,
      description: input.description,
      category: input.category as Ticket["category"],
      status: "pending",
      submittedBy: user,
      assignedTo: null,
      equipmentId: input.equipmentId ?? null,
      equipment,
      diagnosis: null,
      corrected: null,
      actionsTaken: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resolvedAt: null,
    };
    mockTickets.push(newTicket);
    return HttpResponse.json({ data: { createTicket: newTicket } });
  }),

  graphql.mutation("ClaimTicket", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id } = variables as { id: string };
    const ticket = mockTickets.find((t) => t.id === id);
    if (!ticket) return HttpResponse.json({ errors: [{ message: "Ticket no encontrado" }] });
    if (ticket.status !== "pending") {
      return HttpResponse.json({
        errors: [{ message: invalidTicketTransition(ticket, "in_progress") }],
      });
    }
    ticket.assignedTo = caller;
    ticket.status = "in_progress";
    ticket.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { claimTicket: ticket } });
  }),

  graphql.mutation("UpdateTicket", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, input } = variables as {
      id: string;
      input: Partial<Pick<Ticket, "title" | "description" | "category" | "equipmentId">>;
    };
    const ticket = mockTickets.find((t) => t.id === id);
    if (!ticket) return HttpResponse.json({ errors: [{ message: "Ticket no encontrado" }] });
    // Solo datos descriptivos: el estado se mueve por changeTicketStatus/completeTicket
    const { title, description, category, equipmentId } = input;
    if (title !== undefined) ticket.title = title;
    if (description !== undefined) ticket.description = description;
    if (category !== undefined) ticket.category = category;
    if (equipmentId !== undefined) {
      ticket.equipmentId = equipmentId;
      ticket.equipment = mockProducts.find((p) => p.id === equipmentId) ?? null;
    }
    ticket.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { updateTicket: ticket } });
  }),

  graphql.mutation("ChangeTicketStatus", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, status } = variables as { id: string; status: TicketStatus };
    const ticket = mockTickets.find((t) => t.id === id);
    if (!ticket) return HttpResponse.json({ errors: [{ message: "Ticket no encontrado" }] });
    if (!(status in TICKET_STATUS_CONFIG)) {
      return HttpResponse.json({ errors: [{ message: "Estado inválido" }] });
    }
    if (status === "resolved") {
      return HttpResponse.json({
        errors: [{ message: "Para resolver un ticket completá el diagnóstico" }],
      });
    }
    // Tomar el ticket asigna responsable: no se hace cambiando el estado a mano
    if (ticket.status === "pending" || !canTransitionTicket(ticket, status)) {
      return HttpResponse.json({ errors: [{ message: invalidTicketTransition(ticket, status) }] });
    }
    if (status === "pending") ticket.assignedTo = null;
    if (ticket.status === "resolved") ticket.resolvedAt = null;
    ticket.status = status;
    ticket.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { changeTicketStatus: ticket } });
  }),

  graphql.mutation("CompleteTicket", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, input } = variables as {
      id: string;
      input: { diagnosis: string; corrected: boolean; actionsTaken: string };
    };
    const ticket = mockTickets.find((t) => t.id === id);
    if (!ticket) return HttpResponse.json({ errors: [{ message: "Ticket no encontrado" }] });
    if (!canTransitionTicket(ticket, "resolved")) {
      return HttpResponse.json({
        errors: [{ message: invalidTicketTransition(ticket, "resolved") }],
      });
    }
    if (!input.diagnosis?.trim() || typeof input.corrected !== "boolean") {
      return HttpResponse.json({
        errors: [{ message: "Completá el diagnóstico y si se corrigió el problema" }],
      });
    }
    ticket.status = "resolved";
    ticket.diagnosis = input.diagnosis;
    ticket.corrected = input.corrected;
    ticket.actionsTaken = input.actionsTaken;
    ticket.resolvedAt = new Date().toISOString();
    ticket.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { completeTicket: ticket } });
  }),

  graphql.mutation("CreateLoan", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json({ errors: [{ message: "No autenticado" }] });
    const { input } = variables as {
      input: {
        equipmentId: string;
        userId?: string;
        issueDate: string;
        returnDate: string;
        componentIds?: string[];
      };
    };
    // El staff puede registrar un prestamo a nombre de otro usuario; el
    // solicitante solo puede pedirlo para si mismo.
    const loanUserId = isStaff(caller) ? (input.userId ?? caller.id) : caller.id;
    const equipment = mockProducts.find((p) => p.id === input.equipmentId && p.deletedAt === null);
    const loanUser = mockUsers.find((u) => u.id === loanUserId && u.isActive);
    if (!equipment || !loanUser) {
      return HttpResponse.json({ errors: [{ message: "Equipo o usuario no encontrado" }] });
    }
    if (equipment.status !== "available" || hasOpenLoan(equipment.id)) {
      return HttpResponse.json({
        errors: [{ message: "El equipo no está disponible para préstamo" }],
      });
    }
    if (!(new Date(input.returnDate) > new Date(input.issueDate))) {
      return HttpResponse.json({
        errors: [{ message: "La fecha de devolución debe ser posterior a la de entrega" }],
      });
    }
    const components = input.componentIds
      ? mockComponents.filter((c) => input.componentIds!.includes(c.id))
      : [];
    const newLoan: Loan = {
      id: nextId("loan-", mockLoans, 3),
      equipment,
      user: loanUser,
      status: "pending",
      approvedBy: null,
      deliveredBy: null,
      deliveredAt: null,
      issueDate: input.issueDate,
      returnDate: input.returnDate,
      actualReturnDate: null,
      rejectionReason: null,
      components,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockLoans.push(newLoan);
    return HttpResponse.json({ data: { createLoan: newLoan } });
  }),

  graphql.mutation("ApproveLoan", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id } = variables as { id: string };
    const loan = mockLoans.find((l) => l.id === id);
    if (!loan) return HttpResponse.json({ errors: [{ message: "Préstamo no encontrado" }] });
    if (loan.status !== "pending") {
      return HttpResponse.json({ errors: [{ message: invalidLoanTransition(loan, "aprobar") }] });
    }
    if (hasOpenLoan(loan.equipment.id, loan.id)) {
      return HttpResponse.json({
        errors: [{ message: "El equipo ya está comprometido en otro préstamo" }],
      });
    }
    loan.status = "approved";
    loan.approvedBy = caller;
    loan.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { approveLoan: loan } });
  }),

  graphql.mutation("RejectLoan", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, reason } = variables as { id: string; reason: string };
    const loan = mockLoans.find((l) => l.id === id);
    if (!loan) return HttpResponse.json({ errors: [{ message: "Préstamo no encontrado" }] });
    if (loan.status !== "pending") {
      return HttpResponse.json({ errors: [{ message: invalidLoanTransition(loan, "rechazar") }] });
    }
    if (!reason?.trim()) {
      return HttpResponse.json({ errors: [{ message: "Indicá el motivo del rechazo" }] });
    }
    loan.status = "rejected";
    loan.rejectionReason = reason.trim();
    loan.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { rejectLoan: loan } });
  }),

  graphql.mutation("DeliverLoan", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id } = variables as { id: string };
    const loan = mockLoans.find((l) => l.id === id);
    if (!loan) return HttpResponse.json({ errors: [{ message: "Préstamo no encontrado" }] });
    if (loan.status !== "approved") {
      return HttpResponse.json({ errors: [{ message: invalidLoanTransition(loan, "entregar") }] });
    }
    if (loan.equipment.status !== "available") {
      return HttpResponse.json({
        errors: [{ message: "El equipo no está disponible para entregar" }],
      });
    }
    const now = new Date().toISOString();
    loan.status = "active";
    loan.deliveredBy = caller;
    loan.deliveredAt = now;
    loan.updatedAt = now;
    loan.equipment.status = "in_use";
    loan.equipment.updatedAt = now;
    return HttpResponse.json({ data: { deliverLoan: loan } });
  }),

  graphql.mutation("ReturnLoan", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, damaged, issues } = variables as {
      id: string;
      damaged?: boolean;
      issues?: string;
    };
    const loan = mockLoans.find((l) => l.id === id);
    if (!loan) return HttpResponse.json({ errors: [{ message: "Préstamo no encontrado" }] });
    if (loan.status !== "active" && loan.status !== "overdue") {
      return HttpResponse.json({ errors: [{ message: invalidLoanTransition(loan, "devolver") }] });
    }
    const now = new Date().toISOString();
    loan.status = "returned";
    loan.actualReturnDate = now;
    loan.updatedAt = now;
    // Si vuelve con fallas pasa a reparacion en vez de quedar disponible
    loan.equipment.status = damaged ? "in_repair" : "available";
    if (damaged && issues?.trim()) loan.equipment.issues = issues.trim();
    loan.equipment.updatedAt = now;
    return HttpResponse.json({ data: { returnLoan: loan } });
  }),

  graphql.mutation("CreateServiceRequest", ({ request, variables }) => {
    const user = getCaller(request);
    if (!user) return HttpResponse.json({ errors: [{ message: "No autenticado" }] });
    const { input } = variables as {
      input: {
        type: string;
        description: string;
        labNumber?: string;
        softwareName?: string;
        equipmentId?: string;
      };
    };
    const newService: ServiceRequest = {
      id: nextId("svc-", mockServices, 3),
      type: input.type as ServiceRequest["type"],
      status: "pending",
      requestedBy: user,
      assignedTo: null,
      description: input.description,
      labNumber: input.labNumber ?? null,
      softwareName: input.softwareName ?? null,
      equipmentId: input.equipmentId ?? null,
      resolutionText: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockServices.push(newService);
    return HttpResponse.json({ data: { createServiceRequest: newService } });
  }),

  graphql.mutation("UpdateServiceRequest", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, input } = variables as {
      id: string;
      input: { status?: string; resolutionText?: string };
    };
    const service = mockServices.find((s) => s.id === id);
    if (!service) return HttpResponse.json({ errors: [{ message: "Solicitud no encontrada" }] });
    if (input.status) service.status = input.status as ServiceRequest["status"];
    // Quien la pone en marcha o la cierra sin responsable queda como responsable
    if (!service.assignedTo && (input.status === "in_progress" || input.status === "completed")) {
      service.assignedTo = caller;
    }
    if (input.resolutionText !== undefined) service.resolutionText = input.resolutionText;
    service.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { updateServiceRequest: service } });
  }),

  graphql.mutation("ClaimServiceRequest", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id } = variables as { id: string };
    const service = mockServices.find((s) => s.id === id);
    if (!service) return HttpResponse.json({ errors: [{ message: "Solicitud no encontrada" }] });
    if (CLOSED_SERVICE_STATUSES.has(service.status)) {
      return HttpResponse.json({ errors: [{ message: "La solicitud ya está cerrada" }] });
    }
    if (service.assignedTo) {
      return HttpResponse.json({
        errors: [{ message: `La solicitud ya la tomó ${service.assignedTo.name}` }],
      });
    }
    service.assignedTo = caller;
    service.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { claimServiceRequest: service } });
  }),

  graphql.mutation("AssignServiceRequest", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, technicianId } = variables as { id: string; technicianId: string };
    const service = mockServices.find((s) => s.id === id);
    const tech = mockUsers.find((u) => u.id === technicianId && u.isActive);
    if (!service || !tech) return HttpResponse.json({ errors: [{ message: "No encontrado" }] });
    if (!isStaff(tech)) {
      return HttpResponse.json({
        errors: [{ message: "Solo se puede asignar a personal técnico" }],
      });
    }
    if (CLOSED_SERVICE_STATUSES.has(service.status)) {
      return HttpResponse.json({ errors: [{ message: "La solicitud ya está cerrada" }] });
    }
    service.assignedTo = tech;
    service.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { assignServiceRequest: service } });
  }),

  graphql.mutation("CreateUser", ({ request, variables }) => {
    if (!hasRole(getCaller(request), ELEVATED_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { input } = variables as {
      input: {
        name: string;
        dni: string;
        email: string;
        password?: string;
        role: string;
        isActive?: boolean;
      };
    };
    const newUser: User = {
      id: nextId(USER_ID_PREFIX[input.role as UserRole] ?? "u-", mockUsers),
      name: input.name,
      dni: input.dni,
      email: input.email,
      role: input.role as User["role"],
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (input.password) {
      mockPasswords[input.dni] = input.password;
    }
    mockUsers.push(newUser);
    return HttpResponse.json({ data: { createUser: newUser } });
  }),

  graphql.mutation("UpdateUser", ({ request, variables }) => {
    if (!hasRole(getCaller(request), ELEVATED_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, input } = variables as {
      id: string;
      input: Partial<User & { password?: string }>;
    };
    const user = mockUsers.find((u) => u.id === id);
    if (!user) return HttpResponse.json({ errors: [{ message: "Usuario no encontrado" }] });
    const { password, ...rest } = input;
    Object.assign(user, rest, { updatedAt: new Date().toISOString() });
    if (password) mockPasswords[user.dni] = password;
    return HttpResponse.json({ data: { updateUser: user } });
  }),

  graphql.mutation("DeleteUser", ({ request, variables }) => {
    if (!hasRole(getCaller(request), ELEVATED_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id } = variables as { id: string };
    const user = mockUsers.find((u) => u.id === id);
    if (!user || user.role === "root_admin") {
      return HttpResponse.json({ errors: [{ message: "No se puede eliminar este usuario" }] });
    }
    user.isActive = false;
    user.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { deleteUser: true } });
  }),

  graphql.mutation("CreateProduct", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { input } = variables as {
      input: {
        machineId: string;
        kind: string;
        brand: string;
        model: string;
        serialNumber: string;
        partNumber: string;
        status: string;
        issues?: string;
        location: string;
      };
    };
    const fields = {
      ...input,
      machineId: input.machineId.trim().toUpperCase(),
      brand: input.brand.trim(),
      model: input.model.trim(),
      serialNumber: input.serialNumber.trim().toUpperCase(),
      partNumber: input.partNumber.trim().toUpperCase(),
    };
    const error = firstError(validateProduct(fields)) ?? duplicateProductError(fields);
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    const newProduct: Product = {
      id: nextId("prod-", mockProducts),
      type: "product",
      ...fields,
      status: fields.status as Product["status"],
      location: fields.location as Product["location"],
      issues: fields.issues?.trim() || null,
      components: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    mockProducts.push(newProduct);
    return HttpResponse.json({ data: { createProduct: newProduct } });
  }),

  graphql.mutation("UpdateProduct", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, input } = variables as {
      id: string;
      input: Partial<
        Pick<
          Product,
          "machineId" | "kind" | "brand" | "model" | "serialNumber" | "partNumber" | "location"
        > & { issues: string | null }
      >;
    };
    const product = mockProducts.find((p) => p.id === id && p.deletedAt === null);
    if (!product) return HttpResponse.json({ errors: [{ message: "Producto no encontrado" }] });
    // Solo campos descriptivos: lo que no se manda queda como estaba. El estado
    // lo mueven los prestamos y la baja, no la edicion.
    const next = {
      machineId: (input.machineId ?? product.machineId).trim().toUpperCase(),
      kind: input.kind ?? product.kind,
      location: input.location ?? product.location,
      brand: (input.brand ?? product.brand).trim(),
      model: (input.model ?? product.model).trim(),
      serialNumber: (input.serialNumber ?? product.serialNumber).trim().toUpperCase(),
      partNumber: (input.partNumber ?? product.partNumber).trim().toUpperCase(),
    };
    const error = firstError(validateProduct(next)) ?? duplicateProductError(next, product.id);
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    Object.assign(product, next, { updatedAt: new Date().toISOString() });
    if (input.issues !== undefined) product.issues = input.issues?.trim() || null;
    return HttpResponse.json({ data: { updateProduct: product } });
  }),

  graphql.mutation("SoftDeleteProduct", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id } = variables as { id: string };
    const product = mockProducts.find((p) => p.id === id && p.deletedAt === null);
    if (!product) return HttpResponse.json({ errors: [{ message: "Producto no encontrado" }] });
    syncOverdueLoans();
    if (mockLoans.some((l) => l.equipment.id === id && IN_COURSE_LOAN_STATUSES.has(l.status))) {
      return HttpResponse.json({
        errors: [{ message: "No se puede dar de baja: el equipo tiene préstamos en curso" }],
      });
    }
    if (mockTickets.some((t) => t.equipmentId === id && t.status !== "resolved")) {
      return HttpResponse.json({
        errors: [{ message: "No se puede dar de baja: el equipo tiene tickets abiertos" }],
      });
    }
    const now = new Date().toISOString();
    product.status = "retired";
    product.deletedAt = now;
    product.updatedAt = now;
    return HttpResponse.json({ data: { softDeleteProduct: true } });
  }),

  graphql.mutation("CreateComponent", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { input } = variables as {
      input: {
        name: string;
        model: string;
        manufacturer: string;
        serialNumber: string;
        partNumber: string;
        isFactory: boolean;
        isWorking: boolean;
        productId?: string;
      };
    };
    const fields = {
      ...input,
      name: input.name.trim(),
      model: input.model.trim(),
      manufacturer: input.manufacturer.trim(),
      serialNumber: input.serialNumber.trim().toUpperCase(),
      partNumber: input.partNumber.trim().toUpperCase(),
    };
    const error = firstError(validateComponent(fields));
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    const newComponent: Component = {
      id: nextId("comp-", mockComponents),
      type: "component",
      ...fields,
      productId: fields.productId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    mockComponents.push(newComponent);
    return HttpResponse.json({ data: { createComponent: newComponent } });
  }),

  graphql.mutation("UpdateComponent", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, input } = variables as {
      id: string;
      input: Partial<
        Pick<
          Component,
          | "name"
          | "model"
          | "manufacturer"
          | "serialNumber"
          | "partNumber"
          | "isFactory"
          | "isWorking"
        >
      >;
    };
    const component = mockComponents.find((c) => c.id === id && c.deletedAt === null);
    if (!component) {
      return HttpResponse.json({ errors: [{ message: "Componente no encontrado" }] });
    }
    const next = {
      name: (input.name ?? component.name).trim(),
      model: (input.model ?? component.model).trim(),
      manufacturer: (input.manufacturer ?? component.manufacturer).trim(),
      serialNumber: (input.serialNumber ?? component.serialNumber).trim().toUpperCase(),
      partNumber: (input.partNumber ?? component.partNumber).trim().toUpperCase(),
    };
    const error = firstError(validateComponent(next));
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    Object.assign(component, next, { updatedAt: new Date().toISOString() });
    if (input.isFactory !== undefined) component.isFactory = input.isFactory;
    if (input.isWorking !== undefined) component.isWorking = input.isWorking;
    return HttpResponse.json({ data: { updateComponent: component } });
  }),

  graphql.mutation("SoftDeleteComponent", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id } = variables as { id: string };
    const component = mockComponents.find((c) => c.id === id && c.deletedAt === null);
    if (!component) {
      return HttpResponse.json({ errors: [{ message: "Componente no encontrado" }] });
    }
    syncOverdueLoans();
    const inOpenLoan = mockLoans.some(
      (l) => IN_COURSE_LOAN_STATUSES.has(l.status) && l.components.some((c) => c.id === id),
    );
    if (inOpenLoan) {
      return HttpResponse.json({
        errors: [
          { message: "No se puede dar de baja: el componente está en un préstamo en curso" },
        ],
      });
    }
    const now = new Date().toISOString();
    component.deletedAt = now;
    component.updatedAt = now;
    // El equipo deja de listarlo entre sus componentes
    for (const product of mockProducts) {
      product.components = product.components.filter((c) => c.id !== id);
    }
    return HttpResponse.json({ data: { softDeleteComponent: true } });
  }),

  graphql.mutation("ChangePassword", ({ request }) => {
    if (!getCaller(request)) return HttpResponse.json({ errors: [{ message: "No autenticado" }] });
    return HttpResponse.json({ data: { changePassword: true } });
  }),

  graphql.mutation("AssignTicket", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, technicianId } = variables as { id: string; technicianId: string };
    const ticket = mockTickets.find((t) => t.id === id);
    const tech = mockUsers.find((u) => u.id === technicianId);
    if (!ticket || !tech) return HttpResponse.json({ errors: [{ message: "No encontrado" }] });
    if (!isStaff(tech)) {
      return HttpResponse.json({
        errors: [{ message: "Solo se puede asignar a personal técnico" }],
      });
    }
    // Asignar un pendiente lo pone en progreso; reasignar no cambia el estado
    if (ticket.status === "resolved") {
      return HttpResponse.json({
        errors: [{ message: "No se puede reasignar un ticket resuelto" }],
      });
    }
    ticket.assignedTo = tech;
    if (ticket.status === "pending") ticket.status = "in_progress";
    ticket.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { assignTicket: ticket } });
  }),
];
