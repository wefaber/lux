import { graphql, HttpResponse } from "msw";
import { mockUsers, mockPasswords } from "./data/users";
import { mockProducts, mockComponents } from "./data/equipment";
import { mockTickets } from "./data/tickets";
import { mockLoans } from "./data/loans";
import { mockServices } from "./data/services";
import { mockActivityLogs } from "./generators";
import { LOAN_STATUS_CONFIG } from "@/lib/constants";
import type {
  User,
  UserRole,
  Product,
  Component,
  Ticket,
  Loan,
  ServiceRequest,
  DashboardStats,
  TicketStatus,
  LoanStatus,
  ServiceStatus,
} from "@/lib/types";

function filterByStatus<T extends { status: string }>(items: T[], status?: string): T[] {
  if (!status) return items;
  return items.filter((i) => i.status === status);
}

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

// Estados en los que el prestamo compromete el equipo: aprobado y todavia no
// entregado, o entregado y todavia no devuelto.
const OPEN_LOAN_STATUSES = new Set<LoanStatus>(["approved", "active", "overdue"]);

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

  graphql.query("GetUsers", ({ variables }) => {
    const { role, isActive } = variables as { role?: string; isActive?: boolean };
    let users = [...mockUsers];
    if (role) users = users.filter((u) => u.role === role);
    if (isActive !== undefined) users = users.filter((u) => u.isActive === isActive);
    return HttpResponse.json({ data: { users } });
  }),

  graphql.query("GetUser", ({ variables }) => {
    const { id } = variables as { id: string };
    const user = mockUsers.find((u) => u.id === id);
    return HttpResponse.json({ data: { user: user ?? null } });
  }),

  graphql.query("GetProducts", ({ variables }) => {
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

  graphql.query("GetProduct", ({ variables }) => {
    const { id } = variables as { id: string };
    const product = mockProducts.find((p) => p.id === id) ?? null;
    return HttpResponse.json({ data: { product } });
  }),

  graphql.query("GetProductByMachineId", ({ variables }) => {
    const { machineId } = variables as { machineId: string };
    const product = mockProducts.find((p) => p.machineId === machineId && p.deletedAt === null) ?? null;
    return HttpResponse.json({ data: { productByMachineId: product } });
  }),

  graphql.query("GetComponents", ({ variables }) => {
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

  graphql.query("GetComponent", ({ variables }) => {
    const { id } = variables as { id: string };
    const component = mockComponents.find((c) => c.id === id) ?? null;
    return HttpResponse.json({ data: { component } });
  }),

  graphql.query("GetTickets", ({ variables }) => {
    const { status, assignedToId, submittedById } = variables as {
      status?: TicketStatus;
      assignedToId?: string;
      submittedById?: string;
    };
    let tickets = [...mockTickets];
    if (status) tickets = tickets.filter((t) => t.status === status);
    if (assignedToId) tickets = tickets.filter((t) => t.assignedTo?.id === assignedToId);
    if (submittedById) tickets = tickets.filter((t) => t.submittedBy.id === submittedById);
    return HttpResponse.json({ data: { tickets } });
  }),

  graphql.query("GetTicket", ({ variables }) => {
    const { id } = variables as { id: string };
    const ticket = mockTickets.find((t) => t.id === id) ?? null;
    return HttpResponse.json({ data: { ticket } });
  }),

  graphql.query("GetOolTickets", () => {
    const ool = mockTickets.filter((t) => t.status === "pending" && t.assignedTo === null);
    return HttpResponse.json({ data: { oolTickets: ool } });
  }),

  graphql.query("GetLoans", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json({ errors: [{ message: "No autenticado" }] });
    syncOverdueLoans();
    const { status, userId } = variables as { status?: LoanStatus; userId?: string };
    // El solicitante solo ve sus prestamos, mande el filtro que mande
    const scopedUserId = STAFF_ROLES.includes(caller.role) ? userId : caller.id;
    let loans = [...mockLoans];
    if (status) loans = filterByStatus<Loan>(loans, status);
    if (scopedUserId) loans = loans.filter((l) => l.user.id === scopedUserId);
    return HttpResponse.json({ data: { loans } });
  }),

  graphql.query("GetLoan", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json({ errors: [{ message: "No autenticado" }] });
    syncOverdueLoans();
    const { id } = variables as { id: string };
    const loan = mockLoans.find((l) => l.id === id) ?? null;
    if (loan && !STAFF_ROLES.includes(caller.role) && loan.user.id !== caller.id) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    return HttpResponse.json({ data: { loan } });
  }),

  graphql.query("GetServiceRequests", ({ variables }) => {
    const { status, requestedById } = variables as {
      status?: ServiceStatus;
      requestedById?: string;
    };
    let services = [...mockServices];
    if (status) services = filterByStatus<ServiceRequest>(services, status);
    if (requestedById) services = services.filter((s) => s.requestedBy.id === requestedById);
    return HttpResponse.json({ data: { serviceRequests: services } });
  }),

  graphql.query("GetServiceRequest", ({ variables }) => {
    const { id } = variables as { id: string };
    const serviceRequest = mockServices.find((s) => s.id === id) ?? null;
    return HttpResponse.json({ data: { serviceRequest } });
  }),

  graphql.query("GetDashboardStats", () => {
    const activeProducts = mockProducts.filter((p) => p.deletedAt === null);
    const openTickets = mockTickets.filter((t) => t.status !== "resolved");
    const activeLoans = mockLoans.filter((l) =>
      ["active", "approved", "overdue"].includes(l.status),
    );
    const pendingServices = mockServices.filter((s) => s.status === "pending");

    const ticketsByStatus: DashboardStats["ticketsByStatus"] = [
      { status: "pending", count: mockTickets.filter((t) => t.status === "pending").length },
      {
        status: "in_progress",
        count: mockTickets.filter((t) => t.status === "in_progress").length,
      },
      {
        status: "in_resolution",
        count: mockTickets.filter((t) => t.status === "in_resolution").length,
      },
      { status: "resolved", count: mockTickets.filter((t) => t.status === "resolved").length },
    ];

    const servicesByPeriod: DashboardStats["servicesByPeriod"] = Array.from(
      { length: 7 },
      (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const dateStr = d.toISOString().slice(0, 10);
        const count =
          mockServices.filter((s) => s.createdAt.startsWith(dateStr)).length +
          Math.floor(Math.random() * 3);
        return { date: dateStr, count };
      },
    );

    const stats: DashboardStats = {
      totalEquipment: activeProducts.length,
      openTickets: openTickets.length,
      activeLoans: activeLoans.length,
      pendingServices: pendingServices.length,
      ticketsByStatus,
      servicesByPeriod,
    };

    return HttpResponse.json({ data: { dashboardStats: stats } });
  }),

  graphql.query("GetActivityLogs", ({ variables }) => {
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
      id: `tkt-${Date.now()}`,
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
    ticket.assignedTo = caller;
    ticket.status = "in_progress";
    ticket.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { claimTicket: ticket } });
  }),

  graphql.mutation("UpdateTicket", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, input } = variables as { id: string; input: Partial<Ticket> };
    const ticket = mockTickets.find((t) => t.id === id);
    if (!ticket) return HttpResponse.json({ errors: [{ message: "Ticket no encontrado" }] });
    Object.assign(ticket, input, { updatedAt: new Date().toISOString() });
    return HttpResponse.json({ data: { updateTicket: ticket } });
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
    const loanUserId = STAFF_ROLES.includes(caller.role) ? (input.userId ?? caller.id) : caller.id;
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
      id: `loan-${Date.now()}`,
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
      id: `svc-${Date.now()}`,
      type: input.type as ServiceRequest["type"],
      status: "pending",
      requestedBy: user,
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
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id, input } = variables as {
      id: string;
      input: { status?: string; resolutionText?: string };
    };
    const service = mockServices.find((s) => s.id === id);
    if (!service) return HttpResponse.json({ errors: [{ message: "Solicitud no encontrada" }] });
    if (input.status) service.status = input.status as ServiceRequest["status"];
    if (input.resolutionText !== undefined) service.resolutionText = input.resolutionText;
    service.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { updateServiceRequest: service } });
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
      id: `u-${Date.now()}`,
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
    const newProduct: Product = {
      id: `prod-${Date.now()}`,
      type: "product",
      ...input,
      status: input.status as Product["status"],
      location: input.location as Product["location"],
      issues: input.issues ?? null,
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
    const { id, input } = variables as { id: string; input: Partial<Product> };
    const product = mockProducts.find((p) => p.id === id);
    if (!product) return HttpResponse.json({ errors: [{ message: "Producto no encontrado" }] });
    Object.assign(product, input, { updatedAt: new Date().toISOString() });
    return HttpResponse.json({ data: { updateProduct: product } });
  }),

  graphql.mutation("SoftDeleteProduct", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json({ errors: [{ message: "No tenés permisos para esta acción" }] });
    }
    const { id } = variables as { id: string };
    const product = mockProducts.find((p) => p.id === id);
    if (!product) return HttpResponse.json({ errors: [{ message: "Producto no encontrado" }] });
    product.deletedAt = new Date().toISOString();
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
    const newComponent: Component = {
      id: `comp-${Date.now()}`,
      type: "component",
      ...input,
      productId: input.productId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    mockComponents.push(newComponent);
    return HttpResponse.json({ data: { createComponent: newComponent } });
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
    ticket.assignedTo = tech;
    ticket.status = "in_progress";
    ticket.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { assignTicket: ticket } });
  }),
];
