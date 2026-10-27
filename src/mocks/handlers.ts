import { graphql, http, HttpResponse } from "msw";
import { mockUsers, mockPasswords, mockTokenVersions } from "./data/users";
import { mockProducts, mockComponents } from "./data/equipment";
import { mockLocations } from "./data/locations";
import { mockInterventions } from "./data/interventions";
import { mockComments } from "./data/comments";
import { mockReservations } from "./data/reservations";
import { mockTickets } from "./data/tickets";
import { mockLoans } from "./data/loans";
import { mockServices } from "./data/services";
import { mockNotices, mockPendingSeen } from "./data/notices";
import { mockErrorReports } from "./data/errors";
import { requesterOverview } from "./requester";
import { mockActivityLogs } from "./generators";
import { overlapsInstantRange, withinInstantRange } from "@/lib/date-range";
import {
  INVALID_CREDENTIALS_MESSAGE,
  mockLoginGuard,
  mockRequestOrigin,
} from "./login-guard";
import {
  MAX_FP_MESSAGE,
  MAX_FP_ROUTE,
  MAX_FP_STACK,
  MAX_FP_USER_AGENT,
  sanitizeErrorText,
} from "@/lib/error-fingerprint";
import {
  firstError,
  locationCode,
  type UserFields,
  type InterventionFields,
  type LocationFields,
} from "@/lib/validation";
import {
  spanishLabel,
  validateComment,
  validateComponent,
  validateImportRow,
  validateIntervention,
  validateLoan,
  validateLocation,
  validateProduct,
  validateReservation,
  validateServiceRequest,
  validateStudent,
  validateTicket,
  validateNewPassword,
  validateUser,
} from "./spanish";
import { normalizeStudent, filterUsers } from "@/lib/students";
import type { ImportRowInput, UserImportRow } from "@/lib/csv";
import {
  CHANGEABLE_RESERVATION_STATUSES,
  CLOSED_SERVICE_STATUSES,
  INITIAL_EQUIPMENT_STATUSES,
  LOAN_STATUS_CONFIG,
  RETURNABLE_LOAN_STATUSES,
  RESERVATION_STATUS_CONFIG,
  SERVICE_STATUS_CONFIG,
  SERVICE_TRANSITIONS,
  TICKET_STATUS_CONFIG,
  TICKET_TRANSITIONS,
  type DashboardPeriod,
  UNRESERVABLE_EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_CONFIG,
} from "@/lib/constants";
import {
  ADMIN_ROLES,
  ASSIGNABLE_ROLES,
  STAFF_ROLES,
  canEditUser,
  canToggleUserActive,
  isStaff,
} from "@/lib/roles";
import type {
  User,
  UserRole,
  Location,
  LocationKind,
  Intervention,
  InterventionType,
  Comment,
  CommentEntity,
  NoticeEntity,
  NoticeKind,
  Reservation,
  ReservationResource,
  ReservationStatus,
  Product,
  Component,
  EquipmentStatus,
  Ticket,
  Loan,
  ServiceRequest,
  DashboardStats,
  Reports,
  TicketCategory,
  TicketStatus,
  LoanStatus,
  ServiceStatus,
  ErrorReport,
  ErrorReportStatus,
  StudentShift,
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

// Simula la verificacion de un token en un backend real: lo resuelve desde
// el header Authorization en vez de leer localStorage directamente. El token
// lleva la version con la que se emitio, asi que subirla (cambio de contrasena)
// deja sin efecto los tokens anteriores, igual que token_version en la API.
const MOCK_TOKEN_PREFIX = "mock-token-";
const TOKEN_VERSION_SUFFIX = /-v(\d+)$/;

function mockToken(user: User): string {
  return `${MOCK_TOKEN_PREFIX}${user.id}-v${mockTokenVersions[user.id] ?? 0}`;
}

function bumpTokenVersion(userId: string): void {
  mockTokenVersions[userId] = (mockTokenVersions[userId] ?? 0) + 1;
}

function getCaller(request: Request): User | null {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!token?.startsWith(MOCK_TOKEN_PREFIX)) return null;
  const rest = token.slice(MOCK_TOKEN_PREFIX.length);
  const versionMatch = TOKEN_VERSION_SUFFIX.exec(rest);
  // Un token sin sufijo es de la version 0 (los que arman los tests)
  const userId = versionMatch ? rest.slice(0, versionMatch.index) : rest;
  const version = versionMatch ? Number(versionMatch[1]) : 0;
  if ((mockTokenVersions[userId] ?? 0) !== version) return null;
  return mockUsers.find((u) => u.id === userId && u.isActive) ?? null;
}

function hasRole(caller: User | null, allowedRoles: UserRole[]): caller is User {
  return caller !== null && allowedRoles.includes(caller.role);
}

// 90 dias en barras diarias no se lee: se agrupa por semana
const PERIOD_BUCKETS: Record<DashboardPeriod, { days: number; bucketDays: number }> = {
  "7d": { days: 7, bucketDays: 1 },
  "30d": { days: 30, bucketDays: 1 },
  "90d": { days: 91, bucketDays: 7 },
};

const UNAUTHENTICATED = { errors: [{ message: "No autenticado" }] };
const FORBIDDEN = { errors: [{ message: "No tenés permisos para esta acción" }] };

// ── Issue tracker ────────────────────────────────────────────────────────────
// Misma forma que la API real: POST publico (upsert por huella) + lecturas y
// acciones de triage para administradores.
const ERROR_REPORT_STATUSES = new Set<ErrorReportStatus>(["new", "triaged", "resolved"]);
const ERROR_REPORT_ROLES = new Set(["root_admin", "admin", "tecnico", "solicitante", "anonymous"]);

interface MockReportInput {
  fingerprint?: unknown;
  message?: unknown;
  stack?: unknown;
  route?: unknown;
  userAgent?: unknown;
  role?: unknown;
}

function mockReportError(input: MockReportInput, caller: User | null) {
  const fingerprint = String(input.fingerprint ?? "").trim();
  if (!/^[a-z0-9]{8,64}$/i.test(fingerprint)) {
    return { error: "La huella del error no es válida" as string };
  }
  const message = sanitizeErrorText(input.message, MAX_FP_MESSAGE);
  if (!message) return { error: "El mensaje del error es obligatorio" };
  const route = sanitizeErrorText(input.route, MAX_FP_ROUTE) || "/";
  const stack = sanitizeErrorText(input.stack, MAX_FP_STACK) || null;
  const userAgent = sanitizeErrorText(input.userAgent, MAX_FP_USER_AGENT) || null;
  const role = caller?.role ?? String(input.role ?? "anonymous");
  const now = new Date().toISOString();
  const existing = mockErrorReports.find((r) => r.fingerprint === fingerprint);
  if (existing) {
    Object.assign(existing, {
      message,
      stack,
      route,
      userAgent,
      role: ERROR_REPORT_ROLES.has(role) ? role : "anonymous",
      lastSeen: now,
      updatedAt: now,
      occurrences: existing.occurrences + 1,
    });
    return { report: existing };
  }
  const report: ErrorReport = {
    id: nextId("err-", mockErrorReports, 3),
    fingerprint,
    message,
    stack,
    route,
    userAgent,
    role: ERROR_REPORT_ROLES.has(role) ? role : "anonymous",
    firstSeen: now,
    lastSeen: now,
    occurrences: 1,
    status: "new",
    githubIssueUrl: null,
    createdAt: now,
    updatedAt: now,
  };
  mockErrorReports.push(report);
  return { report };
}

function mockIssueDraft(report: ErrorReport): string {
  return [
    "## Contexto",
    "",
    `- **Ruta:** \`${report.route}\``,
    `- **Rol:** ${report.role ?? "anonymous"}`,
    `- **Navegador:** ${report.userAgent ?? "no informado"}`,
    `- **Huella:** \`${report.fingerprint}\``,
    `- **Ocurrencias:** ${report.occurrences}`,
    `- **Primera vez:** ${report.firstSeen}`,
    `- **Última vez:** ${report.lastSeen}`,
    "",
    "## Pasos para reproducir",
    "",
    `1. Abrir \`${report.route}\` con una sesión del rol indicado.`,
    "2. Repetir la acción que disparó el error.",
    "",
    "## Error",
    "",
    "~~~text",
    report.message,
    "~~~",
    "",
    "## Stack",
    "",
    "~~~text",
    report.stack ?? "(sin stack)",
    "~~~",
    "",
    "_Generado por Lux Issue Tracker (mock)._",
  ].join("\n");
}

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
      notify(loan.approvedBy, "loan", loan.id, "overdue", null);
      notify(loan.user, "loan", loan.id, "overdue", null);
    }
  }
}

const PENDING_SECTIONS: NoticeEntity[] = ["ticket", "service_request", "reservation", "loan"];

// Lo que espera que alguien del staff lo tome o lo apruebe, con quien lo pidio.
// En tickets es lo que esta en OOL: pendiente y sin responsable
function pendingIn(section: NoticeEntity): Array<{ createdAt: string; by: User }> {
  switch (section) {
    case "ticket":
      return mockTickets
        .filter((t) => t.status === "pending" && !t.assignedTo)
        .map((t) => ({ createdAt: t.createdAt, by: t.submittedBy }));
    case "service_request":
      return mockServices
        .filter((s) => s.status === "pending")
        .map((s) => ({ createdAt: s.createdAt, by: s.requestedBy }));
    case "reservation":
      return mockReservations
        .filter((r) => r.status === "pending")
        .map((r) => ({ createdAt: r.createdAt, by: r.user }));
    case "loan":
      return mockLoans
        .filter((l) => l.status === "pending")
        .map((l) => ({ createdAt: l.createdAt, by: l.user }));
  }
}

// Hay algo pendiente que llego despues de la ultima vez que miro (y no lo pidio el)
function hasNewPending(user: User, section: NoticeEntity): boolean {
  const seen = mockPendingSeen.find((s) => s.userId === user.id && s.section === section);
  const seenAt = seen ? Date.parse(seen.seenAt) : 0;
  return pendingIn(section).some((p) => p.by.id !== user.id && Date.parse(p.createdAt) > seenAt);
}

// Un ticket o solicitud cambia de responsable (`next` null: queda sin asignar).
// Se avisa a quien lo tenia, a quien lo recibe y al solicitante, que ahora sabe
// quien lo atiende. Volver a asignar a la misma persona no avisa nada
function handOver(
  entityType: "ticket" | "service_request",
  entityId: string,
  requester: User,
  previous: User | null,
  next: User | null,
  by: User,
): void {
  if (previous?.id === next?.id) return;
  if (previous) notify(previous, entityType, entityId, "unassigned", by);
  if (next) {
    notify(next, entityType, entityId, "assigned", by);
    notify(requester, entityType, entityId, "taken", next);
  }
}

// Los avisos vistos se borran: con nextId, marcar como visto el ultimo haria que
// el siguiente reuse su id, y una pestaña desactualizada podria marcar como visto
// uno nuevo. Se lleva la cuenta aparte (desde lo guardado al cargar la pagina)
let lastNoticeNumber = 0;
function nextNoticeId(): string {
  const fromData = Number(nextId("ntc-", mockNotices).slice("ntc-".length)) - 1;
  lastNoticeNumber = Math.max(lastNoticeNumber, fromData) + 1;
  return `ntc-${String(lastNoticeNumber).padStart(3, "0")}`;
}

// Saca los avisos de un elemento que ya no tienen sentido (de un tipo dado)
function dropNotices(entityType: NoticeEntity, entityId: string, kind: NoticeKind): void {
  for (let i = mockNotices.length - 1; i >= 0; i--) {
    const n = mockNotices[i];
    if (n.entityType === entityType && n.entityId === entityId && n.kind === kind) {
      mockNotices.splice(i, 1);
    }
  }
}

// Deja un aviso a `to` sobre algo que hizo `by` (null: el sistema). Lo que uno
// hace sobre lo suyo no se avisa. Un aviso nuevo reemplaza al que hubiera
// sobre el mismo elemento: se muestra solo lo ultimo que paso
function notify(
  to: User | null | undefined,
  entityType: NoticeEntity,
  entityId: string,
  kind: NoticeKind,
  by: User | null,
): void {
  if (!to || to.id === by?.id) return;
  const id = nextNoticeId();
  const previous = mockNotices.findIndex(
    (n) => n.userId === to.id && n.entityType === entityType && n.entityId === entityId,
  );
  if (previous !== -1) mockNotices.splice(previous, 1);
  mockNotices.push({
    id,
    userId: to.id,
    entityType,
    entityId,
    kind,
    by,
    createdAt: new Date().toISOString(),
  });
}

function canTransitionTicket(ticket: Ticket, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[ticket.status].includes(to);
}

function invalidTicketTransition(ticket: Ticket, to: TicketStatus): string {
  return `No se puede pasar un ticket de "${spanishLabel(TICKET_STATUS_CONFIG[ticket.status])}" a "${spanishLabel(TICKET_STATUS_CONFIG[to])}"`;
}

// Equipo vigente por id: uno dado de baja no se vincula a tickets ni solicitudes nuevas
function activeProduct(id: string | undefined): Product | undefined {
  return mockProducts.find((p) => p.id === id && p.deletedAt === null);
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

// Reservas que ocupan su recurso: contra estas se controla el solapamiento
const BLOCKING_RESERVATION_STATUSES = new Set<ReservationStatus>(["approved", "active"]);
// Reservas que todavia cuentan para el recurso (impiden darlo de baja)
const OPEN_RESERVATION_STATUSES = new Set<ReservationStatus>(["pending", "approved", "active"]);

// El ciclo avanza solo con el tiempo, igual que los prestamos vencidos:
// aprobada -> en curso al empezar -> finalizada al terminar
function syncReservations(now: number = Date.now()): void {
  for (const r of mockReservations) {
    if (r.status !== "approved" && r.status !== "active") continue;
    const next: ReservationStatus =
      Date.parse(r.endsAt) <= now
        ? "completed"
        : Date.parse(r.startsAt) <= now
          ? "active"
          : r.status;
    if (next !== r.status) {
      r.status = next;
      r.updatedAt = new Date(now).toISOString();
    }
  }
}

function reservationResourceId(r: Reservation): string | undefined {
  return r.resourceType === "equipment" ? r.equipment?.id : r.location?.id;
}

// Un mismo equipo o espacio no puede tener dos reservas aprobadas en el mismo horario
function reservationOverlapError(
  resourceType: ReservationResource,
  resourceId: string,
  startsAt: string,
  endsAt: string,
  exceptId?: string,
): string | null {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const clash = mockReservations.find(
    (r) =>
      r.id !== exceptId &&
      BLOCKING_RESERVATION_STATUSES.has(r.status) &&
      r.resourceType === resourceType &&
      reservationResourceId(r) === resourceId &&
      Date.parse(r.startsAt) < end &&
      start < Date.parse(r.endsAt),
  );
  return clash ? `Se superpone con la reserva ${clash.id}, ya aprobada para ese horario` : null;
}

function invalidReservationTransition(r: Reservation, action: string): string {
  return `No se puede ${action} una reserva "${spanishLabel(RESERVATION_STATUS_CONFIG[r.status])}"`;
}

// Quien puede leer y escribir el hilo de un ticket o solicitud: el staff, o el
// solicitante que lo abrio (la misma regla que para ver el detalle)
function commentAccessError(
  caller: User,
  entityType: CommentEntity,
  entityId: string,
): { message: string } | null {
  const owner =
    entityType === "ticket"
      ? mockTickets.find((t) => t.id === entityId)?.submittedBy
      : entityType === "service_request"
        ? mockServices.find((s) => s.id === entityId)?.requestedBy
        : undefined;
  if (!owner) return { message: "No encontrado" };
  if (!isStaff(caller.role) && owner.id !== caller.id) return FORBIDDEN.errors[0];
  return null;
}

// Quienes siguen el hilo de un ticket o solicitud: quien lo abrio y quien lo atiende
function threadParticipants(entityType: CommentEntity, entityId: string): User[] {
  const item =
    entityType === "ticket"
      ? mockTickets.find((t) => t.id === entityId)
      : mockServices.find((s) => s.id === entityId);
  if (!item) return [];
  const owner = "submittedBy" in item ? item.submittedBy : item.requestedBy;
  return item.assignedTo && item.assignedTo.id !== owner.id ? [owner, item.assignedTo] : [owner];
}

// Si la intervencion dice venir de un ticket, tiene que ser un ticket de ese equipo
function interventionTicketError(ticketId: string | null, equipmentId: string): string | null {
  if (!ticketId) return null;
  const ticket = mockTickets.find((t) => t.id === ticketId);
  if (!ticket) return "El ticket no existe";
  if (ticket.equipmentId !== equipmentId) return "Ese ticket no corresponde a este equipo";
  return null;
}

// Ubicacion vigente por id: a una dada de baja no se le asignan equipos
function activeLocation(id: string | undefined): Location | undefined {
  return mockLocations.find((l) => l.id === id && l.deletedAt === null);
}

function productsIn(locationId: string): Product[] {
  return mockProducts.filter((p) => p.deletedAt === null && p.locationId === locationId);
}

function withProductCount(location: Location): Location {
  return { ...location, productCount: productsIn(location.id).length };
}

// "Administración" y "administracion" son la misma ubicacion
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Nombre y codigo (tipo + numero) no se repiten entre las ubicaciones vigentes
function duplicateLocationError(
  fields: LocationFields & { code: string },
  exceptId?: string,
): string | null {
  const others = mockLocations.filter((l) => l.deletedAt === null && l.id !== exceptId);
  const sameCode = others.find((l) => l.code === fields.code);
  if (sameCode) return `Ya existe ${sameCode.name} (${fields.code})`;
  if (others.some((l) => normalizeName(l.name) === normalizeName(fields.name))) {
    return `Ya existe una ubicación llamada ${fields.name}`;
  }
  return null;
}

// Estados de una solicitud que son una respuesta para quien la pidio
const SERVICE_RESPONSE_NOTICES = {
  approved: "approved",
  rejected: "rejected",
  completed: "completed",
} as const satisfies Partial<Record<ServiceStatus, NoticeKind>>;

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
  return `No se puede ${action} un préstamo en estado "${spanishLabel(LOAN_STATUS_CONFIG[loan.status])}"`;
}

function errorBody(message: string) {
  return { errors: [{ message }] };
}

// La cedula es el usuario de login y el email el contacto: ninguno se repite
function normalizeUserFields(f: UserFields): UserFields {
  return { ...f, name: f.name.trim(), dni: f.dni.trim(), email: f.email.trim().toLowerCase() };
}

function duplicateUserError(
  fields: { dni: string; email: string },
  exceptId?: string,
): string | null {
  const others = mockUsers.filter((u) => u.id !== exceptId);
  if (others.some((u) => u.dni === fields.dni)) {
    return `Ya existe un usuario con cédula ${fields.dni}`;
  }
  if (others.some((u) => u.email.toLowerCase() === fields.email)) {
    return `Ya existe un usuario con email ${fields.email}`;
  }
  return null;
}

// El rol del root_admin es fijo, nadie se vuelve root_admin y nadie se cambia su
// propio rol (un admin que se baja a tecnico se queda sin acceso para deshacerlo)
function roleChangeError(caller: User, user: User, role: string): string | null {
  if (role === user.role) return null;
  if (user.role === "root_admin") return "El rol del Super Admin no se puede cambiar";
  if (!ASSIGNABLE_ROLES.includes(role as UserRole)) return "No se puede asignar el rol Super Admin";
  if (user.id === caller.id) return "No podés cambiar tu propio rol";
  return null;
}

// La regla vive en lib/roles (la interfaz la usa para mostrar el boton); aca
// solo se traduce a un mensaje
function activationError(caller: User, user: User): string | null {
  if (canToggleUserActive(caller, user)) return null;
  if (user.role === "root_admin") return "El Super Admin no se puede desactivar";
  if (user.id === caller.id) return "No podés desactivar tu propia cuenta";
  return FORBIDDEN.errors[0].message;
}

export const handlers = [
  graphql.query("Login", ({ variables, request }) => {
    const { dni, password } = variables as { dni: string; password: string };
    const origin = mockRequestOrigin(request);
    // Mismo orden que la API: primero el bloqueo (y con el mismo mensaje genérico),
    // después la verificación. El fallo que dispara el bloqueo todavía responde
    // INVALID_CREDENTIALS; el siguiente pedido ya recibe TOO_MANY_ATTEMPTS.
    const lock = mockLoginGuard.check(dni, origin);
    if (lock.locked) {
      return HttpResponse.json({
        errors: [
          {
            message: INVALID_CREDENTIALS_MESSAGE,
            extensions: {
              code: "TOO_MANY_ATTEMPTS",
              status: 429,
              retryAfterSeconds: lock.retryAfterSeconds,
            },
          },
        ],
      });
    }
    const user = mockUsers.find((u) => u.dni === dni && u.isActive);
    if (!user || mockPasswords[dni] !== password) {
      mockLoginGuard.recordFailure(dni, origin);
      return HttpResponse.json({
        errors: [
          {
            message: INVALID_CREDENTIALS_MESSAGE,
            extensions: { code: "INVALID_CREDENTIALS", status: 401 },
          },
        ],
      });
    }
    mockLoginGuard.recordSuccess(dni);
    return HttpResponse.json({
      data: {
        login: { ...user, token: mockToken(user) },
      },
    });
  }),

  graphql.mutation("Logout", () => {
    return HttpResponse.json({ data: { logout: true } });
  }),

  graphql.query("GetMe", ({ request }) => {
    return HttpResponse.json({ data: { me: getCaller(request) } });
  }),

  graphql.query("GetUsers", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    if (!isStaff(caller.role)) return HttpResponse.json(FORBIDDEN);
    const { role, isActive, studentGroup, studentShift, subject } = variables as {
      role?: string;
      isActive?: boolean;
      studentGroup?: string;
      studentShift?: string;
      subject?: string;
    };
    let users = [...mockUsers];
    if (isActive !== undefined) users = users.filter((u) => u.isActive === isActive);
    // Mismos filtros que la API real (y que la pantalla, que filtra en memoria)
    users = filterUsers(users, {
      role: role as UserRole | "",
      group: studentGroup,
      shift: studentShift as StudentShift | "",
      subject,
    });
    return HttpResponse.json({ data: { users } });
  }),

  graphql.query("GetUser", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { id } = variables as { id: string };
    if (!isStaff(caller.role) && id !== caller.id) return HttpResponse.json(FORBIDDEN);
    const user = mockUsers.find((u) => u.id === id);
    return HttpResponse.json({ data: { user: user ?? null } });
  }),

  graphql.query("GetProducts", ({ request, variables }) => {
    if (!getCaller(request)) return HttpResponse.json(UNAUTHENTICATED);
    const { status, locationId, availableForLoan } = variables as {
      status?: string;
      locationId?: string;
      availableForLoan?: boolean;
    };
    let products = mockProducts.filter((p) => p.deletedAt === null);
    if (status) products = products.filter((p) => p.status === status);
    // Disponible pero ya aprobado para otro prestamo no se puede volver a pedir
    if (availableForLoan) {
      products = products.filter((p) => p.status === "available" && !hasOpenLoan(p.id));
    }
    if (locationId) products = products.filter((p) => p.locationId === locationId);
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
    const product =
      mockProducts.find((p) => p.machineId === machineId && p.deletedAt === null) ?? null;
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
    const { status, assignedToId, submittedById, equipmentId, startDate, endDate } =
      variables as {
        status?: TicketStatus;
        assignedToId?: string;
        submittedById?: string;
        equipmentId?: string;
        startDate?: string;
        endDate?: string;
      };
    // El solicitante solo ve sus tickets, mande el filtro que mande
    const scopedSubmittedById = isStaff(caller.role) ? submittedById : caller.id;
    let tickets = [...mockTickets];
    if (status) tickets = tickets.filter((t) => t.status === status);
    if (assignedToId) tickets = tickets.filter((t) => t.assignedTo?.id === assignedToId);
    if (scopedSubmittedById) {
      tickets = tickets.filter((t) => t.submittedBy.id === scopedSubmittedById);
    }
    if (equipmentId) tickets = tickets.filter((t) => t.equipmentId === equipmentId);
    // Rango por fecha de creacion, con los extremos ya en el dia local del cliente
    if (startDate || endDate) {
      tickets = tickets.filter((t) => withinInstantRange(t.createdAt, startDate, endDate));
    }
    return HttpResponse.json({ data: { tickets } });
  }),

  graphql.query("GetTicket", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { id } = variables as { id: string };
    const ticket = mockTickets.find((t) => t.id === id) ?? null;
    if (ticket && !isStaff(caller.role) && ticket.submittedBy.id !== caller.id) {
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
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    syncOverdueLoans();
    const { status, userId, equipmentId, startDate, endDate } = variables as {
      status?: LoanStatus;
      userId?: string;
      equipmentId?: string;
      startDate?: string;
      endDate?: string;
    };
    // El solicitante solo ve sus prestamos, mande el filtro que mande
    const scopedUserId = isStaff(caller.role) ? userId : caller.id;
    let loans = [...mockLoans];
    if (status) loans = filterByStatus<Loan>(loans, status);
    if (scopedUserId) loans = loans.filter((l) => l.user.id === scopedUserId);
    if (equipmentId) loans = loans.filter((l) => l.equipment.id === equipmentId);
    // Rango por fecha de entrega (issueDate), la que muestra la lista
    if (startDate || endDate) {
      loans = loans.filter((l) => withinInstantRange(l.issueDate, startDate, endDate));
    }
    return HttpResponse.json({ data: { loans } });
  }),

  graphql.query("GetLoan", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    syncOverdueLoans();
    const { id } = variables as { id: string };
    const loan = mockLoans.find((l) => l.id === id) ?? null;
    if (loan && !isStaff(caller.role) && loan.user.id !== caller.id) {
      return HttpResponse.json(FORBIDDEN);
    }
    return HttpResponse.json({ data: { loan } });
  }),

  graphql.query("GetServiceRequests", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { status, requestedById, startDate, endDate } = variables as {
      status?: ServiceStatus;
      requestedById?: string;
      startDate?: string;
      endDate?: string;
    };
    // El solicitante solo ve sus solicitudes, mande el filtro que mande
    const scopedRequestedById = isStaff(caller.role) ? requestedById : caller.id;
    let services = [...mockServices];
    if (status) services = filterByStatus<ServiceRequest>(services, status);
    if (scopedRequestedById) {
      services = services.filter((s) => s.requestedBy.id === scopedRequestedById);
    }
    // Rango por fecha de creacion de la solicitud
    if (startDate || endDate) {
      services = services.filter((s) => withinInstantRange(s.createdAt, startDate, endDate));
    }
    return HttpResponse.json({ data: { serviceRequests: services } });
  }),

  graphql.query("GetServiceRequest", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { id } = variables as { id: string };
    const serviceRequest = mockServices.find((s) => s.id === id) ?? null;
    if (serviceRequest && !isStaff(caller.role) && serviceRequest.requestedBy.id !== caller.id) {
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
    const staff = isStaff(caller.role);
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
      // Lo del solicitante tampoco viaja al staff: cada rol ve su tablero
      requesterOverview: staff
        ? null
        : requesterOverview(
            caller.id,
            mockTickets,
            mockLoans,
            mockReservations,
            mockLocations,
            mockProducts,
          ),
    };

    return HttpResponse.json({ data: { dashboardStats: stats } });
  }),

  graphql.query("GetReports", ({ request }) => {
    if (!hasRole(getCaller(request), ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
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
    if (!hasRole(getCaller(request), ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { userId, operation, startDate, endDate } = variables as {
      userId?: string;
      operation?: string;
      startDate?: string;
      endDate?: string;
    };
    let logs = [...mockActivityLogs];
    if (userId) logs = logs.filter((l) => l.userId === userId);
    if (operation) logs = logs.filter((l) => l.operation === operation);
    // Instantes, no texto: un "hasta" con milisegundos incluye los registros
    // guardados sin ellos (los del mismo segundo) sin depender del formato
    if (startDate || endDate) {
      logs = logs.filter((l) => withinInstantRange(l.timestamp, startDate, endDate));
    }
    return HttpResponse.json({ data: { activityLogs: logs } });
  }),

  graphql.mutation("CreateTicket", ({ request, variables }) => {
    const user = getCaller(request);
    if (!user) return HttpResponse.json(UNAUTHENTICATED);
    const { input } = variables as {
      input: { title: string; description: string; category: string; equipmentId?: string };
    };
    const error = firstError(validateTicket(input));
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    const equipment = input.equipmentId ? (activeProduct(input.equipmentId) ?? null) : null;
    if (input.equipmentId && !equipment) {
      return HttpResponse.json({ errors: [{ message: "Equipo no encontrado" }] });
    }
    const newTicket: Ticket = {
      id: nextId("tkt-", mockTickets, 3),
      title: input.title.trim(),
      description: input.description.trim(),
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
      attendedAt: null,
      rating: null,
      ratedAt: null,
    };
    mockTickets.push(newTicket);
    return HttpResponse.json({ data: { createTicket: newTicket } });
  }),

  graphql.mutation("ClaimTicket", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
    }
    const { id } = variables as { id: string };
    const ticket = mockTickets.find((t) => t.id === id);
    if (!ticket) return HttpResponse.json({ errors: [{ message: "Ticket no encontrado" }] });
    if (ticket.status !== "pending") {
      return HttpResponse.json({
        errors: [{ message: invalidTicketTransition(ticket, "in_progress") }],
      });
    }
    handOver("ticket", ticket.id, ticket.submittedBy, ticket.assignedTo, caller, caller);
    ticket.assignedTo = caller;
    ticket.status = "in_progress";
    // Primera vez que alguien lo toma: es lo que mide el tiempo de atencion
    ticket.attendedAt ??= new Date().toISOString();
    ticket.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { claimTicket: ticket } });
  }),

  graphql.mutation("UpdateTicket", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
    }
    const { id, input } = variables as {
      id: string;
      input: Partial<Pick<Ticket, "title" | "description" | "category" | "equipmentId">>;
    };
    const ticket = mockTickets.find((t) => t.id === id);
    if (!ticket) return HttpResponse.json({ errors: [{ message: "Ticket no encontrado" }] });
    // Solo datos descriptivos: el estado se mueve por changeTicketStatus/completeTicket
    const fields = {
      title: input.title ?? ticket.title,
      description: input.description ?? ticket.description,
      category: input.category ?? ticket.category,
    };
    const error = firstError(validateTicket(fields));
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    const { equipmentId } = input;
    const equipment = equipmentId ? activeProduct(equipmentId) : undefined;
    if (equipmentId && !equipment) {
      return HttpResponse.json({ errors: [{ message: "Equipo no encontrado" }] });
    }
    ticket.title = fields.title.trim();
    ticket.description = fields.description.trim();
    ticket.category = fields.category;
    if (equipmentId !== undefined) {
      ticket.equipmentId = equipmentId || null;
      ticket.equipment = equipment ?? null;
    }
    ticket.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { updateTicket: ticket } });
  }),

  graphql.mutation("ChangeTicketStatus", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
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
    if (status === "pending") {
      handOver("ticket", ticket.id, ticket.submittedBy, ticket.assignedTo, null, caller);
      ticket.assignedTo = null;
    }
    if (ticket.status === "resolved") ticket.resolvedAt = null;
    // Al reabrir se cae la valoracion de la resolucion anterior
    if (status === "in_progress" && ticket.ratedAt) {
      ticket.rating = null;
      ticket.ratedAt = null;
    }
    ticket.status = status;
    ticket.updatedAt = new Date().toISOString();
    if (status === "in_resolution") {
      notify(ticket.submittedBy, "ticket", ticket.id, "in_resolution", caller);
    }
    return HttpResponse.json({ data: { changeTicketStatus: ticket } });
  }),

  graphql.mutation("CompleteTicket", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
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
    notify(ticket.submittedBy, "ticket", ticket.id, "resolved", caller);
    return HttpResponse.json({ data: { completeTicket: ticket } });
  }),

  graphql.mutation("RateTicket", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { id, rating } = variables as { id: string; rating: number };
    const ticket = mockTickets.find((t) => t.id === id);
    if (!ticket) return HttpResponse.json({ errors: [{ message: "Ticket no encontrado" }] });
    // Cada uno puntua lo suyo: el ticket tiene que ser del que llama
    if (ticket.submittedBy.id !== caller.id) return HttpResponse.json(FORBIDDEN);
    if (ticket.status !== "resolved") {
      return HttpResponse.json({
        errors: [{ message: "Solo se puede puntuar un ticket resuelto" }],
      });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return HttpResponse.json({ errors: [{ message: "La valoración va de 1 a 5" }] });
    }
    ticket.rating = rating;
    ticket.ratedAt = new Date().toISOString();
    return HttpResponse.json({ data: { rateTicket: ticket } });
  }),

  graphql.mutation("CreateLoan", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
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
    const loanUserId = isStaff(caller.role) ? (input.userId ?? caller.id) : caller.id;
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
    const dateError = firstError(validateLoan(input));
    if (dateError) {
      return HttpResponse.json({ errors: [{ message: dateError }] });
    }
    const componentIds = input.componentIds ?? [];
    const components = mockComponents.filter(
      (c) => componentIds.includes(c.id) && c.deletedAt === null && c.productId === equipment.id,
    );
    if (components.length !== new Set(componentIds).size) {
      return HttpResponse.json({
        errors: [{ message: "Algún componente no existe o no pertenece a este equipo" }],
      });
    }
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
      return HttpResponse.json(FORBIDDEN);
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
    notify(loan.user, "loan", loan.id, "approved", caller);
    return HttpResponse.json({ data: { approveLoan: loan } });
  }),

  graphql.mutation("RejectLoan", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
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
    notify(loan.user, "loan", loan.id, "rejected", caller);
    return HttpResponse.json({ data: { rejectLoan: loan } });
  }),

  graphql.mutation("DeliverLoan", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
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
    notify(loan.user, "loan", loan.id, "delivered", caller);
    return HttpResponse.json({ data: { deliverLoan: loan } });
  }),

  graphql.mutation("ReturnLoan", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
    }
    const { id, damaged, issues } = variables as {
      id: string;
      damaged?: boolean;
      issues?: string;
    };
    const loan = mockLoans.find((l) => l.id === id);
    if (!loan) return HttpResponse.json({ errors: [{ message: "Préstamo no encontrado" }] });
    if (!RETURNABLE_LOAN_STATUSES.includes(loan.status)) {
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
    // Ya devuelto, el "vencio" no le sirve a nadie y lo dejaria fijado arriba
    dropNotices("loan", loan.id, "overdue");
    return HttpResponse.json({ data: { returnLoan: loan } });
  }),

  graphql.mutation("CreateServiceRequest", ({ request, variables }) => {
    const user = getCaller(request);
    if (!user) return HttpResponse.json(UNAUTHENTICATED);
    const { input } = variables as {
      input: {
        type: string;
        description: string;
        labNumber?: string;
        softwareName?: string;
        equipmentId?: string;
      };
    };
    const error = firstError(validateServiceRequest(input));
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    if (input.equipmentId && !activeProduct(input.equipmentId)) {
      return HttpResponse.json({ errors: [{ message: "Equipo no encontrado" }] });
    }
    const newService: ServiceRequest = {
      id: nextId("svc-", mockServices, 3),
      type: input.type as ServiceRequest["type"],
      status: "pending",
      requestedBy: user,
      assignedTo: null,
      description: input.description.trim(),
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
      return HttpResponse.json(FORBIDDEN);
    }
    const { id, input } = variables as {
      id: string;
      input: { status?: string; resolutionText?: string };
    };
    const service = mockServices.find((s) => s.id === id);
    if (!service) return HttpResponse.json({ errors: [{ message: "Solicitud no encontrada" }] });
    const previousStatus = service.status;
    const status = input.status as ServiceStatus | undefined;
    if (status !== undefined && status !== previousStatus) {
      if (!Object.hasOwn(SERVICE_STATUS_CONFIG, status)) {
        return HttpResponse.json({ errors: [{ message: "Estado inválido" }] });
      }
      if (!SERVICE_TRANSITIONS[previousStatus].includes(status)) {
        return HttpResponse.json({
          errors: [
            {
              message: `No se puede pasar una solicitud de "${spanishLabel(SERVICE_STATUS_CONFIG[previousStatus])}" a "${spanishLabel(SERVICE_STATUS_CONFIG[status])}"`,
            },
          ],
        });
      }
      service.status = status;
    }
    // Quien la pone en marcha o la cierra sin responsable queda como responsable.
    // Va antes que la respuesta: si tambien la cierra, el aviso que queda es ese
    if (!service.assignedTo && (input.status === "in_progress" || input.status === "completed")) {
      handOver("service_request", service.id, service.requestedBy, null, caller, caller);
      service.assignedTo = caller;
    }
    if (input.resolutionText !== undefined) service.resolutionText = input.resolutionText;
    service.updatedAt = new Date().toISOString();
    // Al solicitante se le avisa la respuesta: aprobada, rechazada o completada
    // hasOwn y no `in`: el estado viene del cliente y "constructor" pasaria
    if (
      service.status !== previousStatus &&
      Object.hasOwn(SERVICE_RESPONSE_NOTICES, service.status)
    ) {
      const kind =
        SERVICE_RESPONSE_NOTICES[service.status as keyof typeof SERVICE_RESPONSE_NOTICES];
      notify(service.requestedBy, "service_request", service.id, kind, caller);
    }
    return HttpResponse.json({ data: { updateServiceRequest: service } });
  }),

  graphql.mutation("ClaimServiceRequest", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
    }
    const { id } = variables as { id: string };
    const service = mockServices.find((s) => s.id === id);
    if (!service) return HttpResponse.json({ errors: [{ message: "Solicitud no encontrada" }] });
    if (CLOSED_SERVICE_STATUSES.includes(service.status)) {
      return HttpResponse.json({ errors: [{ message: "La solicitud ya está cerrada" }] });
    }
    if (service.assignedTo) {
      return HttpResponse.json({
        errors: [{ message: `La solicitud ya la tomó ${service.assignedTo.name}` }],
      });
    }
    handOver("service_request", service.id, service.requestedBy, null, caller, caller);
    service.assignedTo = caller;
    service.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { claimServiceRequest: service } });
  }),

  graphql.mutation("AssignServiceRequest", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
    }
    const { id, technicianId } = variables as { id: string; technicianId: string };
    const service = mockServices.find((s) => s.id === id);
    const tech = mockUsers.find((u) => u.id === technicianId && u.isActive);
    if (!service || !tech) return HttpResponse.json({ errors: [{ message: "No encontrado" }] });
    if (!isStaff(tech.role)) {
      return HttpResponse.json({
        errors: [{ message: "Solo se puede asignar a personal técnico" }],
      });
    }
    if (CLOSED_SERVICE_STATUSES.includes(service.status)) {
      return HttpResponse.json({ errors: [{ message: "La solicitud ya está cerrada" }] });
    }
    handOver("service_request", service.id, service.requestedBy, service.assignedTo, tech, caller);
    service.assignedTo = tech;
    service.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { assignServiceRequest: service } });
  }),

  graphql.mutation("CreateUser", ({ request, variables }) => {
    if (!hasRole(getCaller(request), ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { input } = variables as {
      input: {
        name: string;
        dni: string;
        email: string;
        password?: string;
        role: string;
        isActive?: boolean;
        studentGroup?: string | null;
        studentShift?: string | null;
        studentSubjects?: string[] | null;
      };
    };
    const fields = normalizeUserFields({ ...input, password: input.password ?? "" });
    const rawStudent = {
      studentGroup: input.studentGroup ?? null,
      studentShift: input.studentShift ?? null,
      studentSubjects: input.studentSubjects ?? [],
    };
    const studentError =
      fields.role === "solicitante" ? firstError(validateStudent(rawStudent)) : null;
    const error =
      firstError(validateUser(fields, true)) ??
      studentError ??
      (ASSIGNABLE_ROLES.includes(fields.role as UserRole)
        ? null
        : "No se puede crear otro Super Admin") ??
      duplicateUserError(fields);
    if (error) return HttpResponse.json(errorBody(error));
    const now = new Date().toISOString();
    const newUser: User = {
      id: nextId(USER_ID_PREFIX[fields.role as UserRole], mockUsers),
      name: fields.name,
      dni: fields.dni,
      email: fields.email,
      role: fields.role as UserRole,
      isActive: input.isActive ?? true,
      ...normalizeStudent(rawStudent, fields.role as UserRole),
      createdAt: now,
      updatedAt: now,
    };
    mockPasswords[newUser.dni] = fields.password;
    mockUsers.push(newUser);
    return HttpResponse.json({ data: { createUser: newUser } });
  }),

  graphql.mutation("UpdateUser", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { id, input } = variables as {
      id: string;
      input: Partial<
        Pick<
          User,
          | "name"
          | "dni"
          | "email"
          | "role"
          | "isActive"
          | "studentGroup"
          | "studentShift"
          | "studentSubjects"
        >
      > & {
        password?: string;
      };
    };
    const user = mockUsers.find((u) => u.id === id);
    if (!user) return HttpResponse.json(errorBody("Usuario no encontrado"));
    if (!canEditUser(caller, user)) return HttpResponse.json(FORBIDDEN);
    // Solo estos campos: el id, las fechas y demas no se tocan desde afuera
    const fields = normalizeUserFields({
      name: input.name ?? user.name,
      dni: input.dni ?? user.dni,
      email: input.email ?? user.email,
      role: input.role ?? user.role,
      password: input.password ?? "",
    });
    // Sin campo en el input se conserva lo que habia; un rol distinto de
    // solicitante deja la ficha vacia (normalizeStudent)
    const rawStudent = {
      studentGroup: input.studentGroup !== undefined ? input.studentGroup : user.studentGroup,
      studentShift: input.studentShift !== undefined ? input.studentShift : user.studentShift,
      studentSubjects:
        input.studentSubjects !== undefined ? input.studentSubjects : user.studentSubjects,
    };
    const togglesActive = input.isActive !== undefined && input.isActive !== user.isActive;
    const studentError =
      fields.role === "solicitante" ? firstError(validateStudent(rawStudent)) : null;
    const error =
      firstError(validateUser(fields, false)) ??
      studentError ??
      roleChangeError(caller, user, fields.role) ??
      duplicateUserError(fields, user.id) ??
      (togglesActive ? activationError(caller, user) : null);
    if (error) return HttpResponse.json(errorBody(error));
    // La contraseña se guarda por cedula: si cambia la cedula, la contraseña la sigue
    if (fields.dni !== user.dni) {
      mockPasswords[fields.dni] = mockPasswords[user.dni];
      delete mockPasswords[user.dni];
    }
    Object.assign(user, {
      name: fields.name,
      dni: fields.dni,
      email: fields.email,
      role: fields.role as UserRole,
      isActive: input.isActive ?? user.isActive,
      ...normalizeStudent(rawStudent, fields.role as UserRole),
      updatedAt: new Date().toISOString(),
    });
    if (fields.password) {
      mockPasswords[user.dni] = fields.password;
      // Un reset de un administrador tambien corta las sesiones abiertas
      bumpTokenVersion(user.id);
    }
    return HttpResponse.json({ data: { updateUser: user } });
  }),

  // Baja logica directa; activar y desactivar desde la gestion usa updateUser(isActive)
  graphql.mutation("DeleteUser", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { id } = variables as { id: string };
    const user = mockUsers.find((u) => u.id === id);
    if (!user) return HttpResponse.json(errorBody("Usuario no encontrado"));
    const error = activationError(caller, user);
    if (error) return HttpResponse.json(errorBody(error));
    user.isActive = false;
    user.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { deleteUser: true } });
  }),

  // Importación masiva (CSV exportado de Excel). Igual que la API real: cada
  // fila se valida sola, los errores no abortan el lote y quien ya existe solo
  // recibe los datos de estudiante del archivo.
  graphql.mutation("ImportUsers", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { rows } = variables as { rows: ImportRowInput[] };
    const results: Array<{
      line: number;
      status: string;
      userId: string | null;
      error: string | null;
    }> = [];
    const seenDni = new Map<string, number>();
    const seenEmail = new Map<string, number>();
    let created = 0;
    let updated = 0;
    let failed = 0;
    const fail = (line: number, error: string) => {
      failed++;
      results.push({ line, status: "error", userId: null, error });
    };

    for (const raw of rows) {
      const parsed = validateImportRow(raw);
      if ("error" in parsed) {
        fail(raw.line ?? 1, parsed.error);
        continue;
      }
      const row: UserImportRow = parsed.row;
      const firstDni = seenDni.get(row.dni);
      if (firstDni !== undefined) {
        fail(row.line, `Documento ${row.dni} repetido en la fila ${firstDni}`);
        continue;
      }
      const firstEmail = seenEmail.get(row.email);
      if (firstEmail !== undefined) {
        fail(row.line, `Email ${row.email} repetido en la fila ${firstEmail}`);
        continue;
      }
      seenDni.set(row.dni, row.line);
      seenEmail.set(row.email, row.line);

      const byDni = mockUsers.find((u) => u.dni === row.dni);
      const byEmail = mockUsers.find((u) => u.email.toLowerCase() === row.email);
      if (byDni && byEmail && byDni.id !== byEmail.id) {
        fail(row.line, "El documento y el email pertenecen a usuarios distintos");
        continue;
      }
      const existing = byDni ?? byEmail;
      if (existing) {
        if (existing.role !== "solicitante") {
          fail(row.line, `La persona ya existe con rol ${existing.role}`);
          continue;
        }
        // Celda vacia = dejar el dato como estaba
        Object.assign(existing, {
          studentGroup: row.studentGroup ?? existing.studentGroup,
          studentShift: row.studentShift ?? existing.studentShift,
          studentSubjects: row.studentSubjects.length
            ? row.studentSubjects
            : existing.studentSubjects,
          updatedAt: new Date().toISOString(),
        });
        updated++;
        results.push({ line: row.line, status: "updated", userId: existing.id, error: null });
        continue;
      }

      const now = new Date().toISOString();
      const newUser: User = {
        id: nextId(USER_ID_PREFIX[row.role], mockUsers),
        name: row.name,
        dni: row.dni,
        email: row.email,
        role: row.role,
        isActive: row.isActive,
        studentGroup: row.studentGroup,
        studentShift: row.studentShift as User["studentShift"],
        studentSubjects: row.studentSubjects,
        createdAt: now,
        updatedAt: now,
      };
      // Sin contraseña en el archivo, la clave inicial es el documento
      mockPasswords[newUser.dni] = row.password ?? newUser.dni;
      mockUsers.push(newUser);
      created++;
      results.push({ line: row.line, status: "created", userId: newUser.id, error: null });
    }

    return HttpResponse.json({
      data: { importUsers: { created, updated, failed, rows: results } },
    });
  }),

  graphql.mutation("CreateProduct", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
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
        locationId: string;
      };
    };
    const location = activeLocation(input.locationId);
    const fields = {
      machineId: input.machineId.trim().toUpperCase(),
      kind: input.kind,
      location,
      brand: input.brand.trim(),
      model: input.model.trim(),
      serialNumber: input.serialNumber.trim().toUpperCase(),
      partNumber: input.partNumber.trim().toUpperCase(),
    };
    const status = (input.status || "available") as EquipmentStatus;
    const error =
      firstError(validateProduct(fields)) ??
      duplicateProductError(fields) ??
      (INITIAL_EQUIPMENT_STATUSES.includes(status) ? null : "Estado inicial inválido");
    if (error || !location) {
      return HttpResponse.json({ errors: [{ message: error ?? "Ubicación inválida" }] });
    }
    const newProduct: Product = {
      id: nextId("prod-", mockProducts),
      type: "product",
      ...fields,
      status,
      locationId: location.id,
      location: location.name,
      issues: input.issues?.trim() || null,
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
      return HttpResponse.json(FORBIDDEN);
    }
    const { id, input } = variables as {
      id: string;
      input: Partial<
        Pick<
          Product,
          "machineId" | "kind" | "brand" | "model" | "serialNumber" | "partNumber" | "locationId"
        > & { issues: string | null }
      >;
    };
    const product = mockProducts.find((p) => p.id === id && p.deletedAt === null);
    if (!product) return HttpResponse.json({ errors: [{ message: "Producto no encontrado" }] });
    // Solo campos descriptivos: lo que no se manda queda como estaba. El estado
    // lo mueven los prestamos y la baja, no la edicion.
    const location = activeLocation(input.locationId ?? product.locationId);
    const next = {
      machineId: (input.machineId ?? product.machineId).trim().toUpperCase(),
      kind: input.kind ?? product.kind,
      location,
      brand: (input.brand ?? product.brand).trim(),
      model: (input.model ?? product.model).trim(),
      serialNumber: (input.serialNumber ?? product.serialNumber).trim().toUpperCase(),
      partNumber: (input.partNumber ?? product.partNumber).trim().toUpperCase(),
    };
    const error = firstError(validateProduct(next)) ?? duplicateProductError(next, product.id);
    if (error || !location) {
      return HttpResponse.json({ errors: [{ message: error ?? "Ubicación inválida" }] });
    }
    Object.assign(product, next, {
      locationId: location.id,
      location: location.name,
      updatedAt: new Date().toISOString(),
    });
    if (input.issues !== undefined) product.issues = input.issues?.trim() || null;
    return HttpResponse.json({ data: { updateProduct: product } });
  }),

  graphql.mutation("SoftDeleteProduct", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
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
    syncReservations();
    if (
      mockReservations.some(
        (r) => r.equipment?.id === id && OPEN_RESERVATION_STATUSES.has(r.status),
      )
    ) {
      return HttpResponse.json({
        errors: [{ message: "No se puede dar de baja: el equipo tiene reservas vigentes" }],
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
      return HttpResponse.json(FORBIDDEN);
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
      return HttpResponse.json(FORBIDDEN);
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
      return HttpResponse.json(FORBIDDEN);
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

  graphql.mutation("ChangePassword", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { currentPassword, newPassword } = variables as {
      currentPassword: string;
      newPassword: string;
    };
    if (mockPasswords[caller.dni] !== currentPassword) {
      return HttpResponse.json(errorBody("La contraseña actual no es correcta"));
    }
    const error = validateNewPassword(currentPassword, newPassword ?? "");
    if (error) return HttpResponse.json(errorBody(error));
    mockPasswords[caller.dni] = newPassword;
    // Cierra las sesiones abiertas, la actual incluida: hay que volver a entrar
    bumpTokenVersion(caller.id);
    return HttpResponse.json({ data: { changePassword: true } });
  }),

  graphql.mutation("AssignTicket", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) {
      return HttpResponse.json(FORBIDDEN);
    }
    const { id, technicianId } = variables as { id: string; technicianId: string };
    const ticket = mockTickets.find((t) => t.id === id);
    // Como en solicitudes: a alguien dado de baja no se le asigna (ni se le avisa)
    const tech = mockUsers.find((u) => u.id === technicianId && u.isActive);
    if (!ticket || !tech) return HttpResponse.json({ errors: [{ message: "No encontrado" }] });
    if (!isStaff(tech.role)) {
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
    handOver("ticket", ticket.id, ticket.submittedBy, ticket.assignedTo, tech, caller);
    ticket.assignedTo = tech;
    if (ticket.status === "pending") ticket.status = "in_progress";
    ticket.attendedAt ??= new Date().toISOString();
    ticket.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { assignTicket: ticket } });
  }),

  // ── Reservas ───────────────────────────────────────────────────────────────
  // El solicitante pide y sigue las suyas; el staff ve todas y las gestiona

  graphql.query("GetReservations", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    syncReservations();
    const { status, startDate, endDate } = variables as {
      status?: ReservationStatus;
      startDate?: string;
      endDate?: string;
    };
    // El solicitante solo ve las suyas, mande el filtro que mande
    let reservations = isStaff(caller.role)
      ? [...mockReservations]
      : mockReservations.filter((r) => r.user.id === caller.id);
    if (status) reservations = reservations.filter((r) => r.status === status);
    // Rango por el horario de la reserva: se incluyen las que se solapan con
    // esos dias, aunque hayan empezado antes
    if (startDate || endDate) {
      reservations = reservations.filter((r) =>
        overlapsInstantRange(r.startsAt, r.endsAt, startDate, endDate),
      );
    }
    reservations.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    return HttpResponse.json({ data: { reservations } });
  }),

  graphql.query("GetReservation", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    syncReservations();
    const { id } = variables as { id: string };
    const reservation = mockReservations.find((r) => r.id === id) ?? null;
    if (reservation && !isStaff(caller.role) && reservation.user.id !== caller.id) {
      return HttpResponse.json(FORBIDDEN);
    }
    return HttpResponse.json({ data: { reservation } });
  }),

  graphql.mutation("CreateReservation", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    syncReservations();
    const { input } = variables as {
      input: {
        resourceType: ReservationResource;
        equipmentId?: string;
        locationId?: string;
        startsAt: string;
        endsAt: string;
        purpose: string;
      };
    };
    let equipment: Product | null = null;
    let location: Location | null = null;
    if (input.resourceType === "equipment") {
      equipment = mockProducts.find((p) => p.id === input.equipmentId && !p.deletedAt) ?? null;
      if (!equipment) return HttpResponse.json({ errors: [{ message: "Equipo no encontrado" }] });
      // Hay equipos con estado "retired" sin deletedAt: tampoco se reservan
      if (UNRESERVABLE_EQUIPMENT_STATUSES.includes(equipment.status)) {
        const state = spanishLabel(EQUIPMENT_STATUS_CONFIG[equipment.status]).toLowerCase();
        return HttpResponse.json({
          errors: [{ message: `El equipo está ${state}: no se puede reservar` }],
        });
      }
    } else if (input.resourceType === "location") {
      location = activeLocation(input.locationId) ?? null;
      if (!location) return HttpResponse.json({ errors: [{ message: "Ubicación no encontrada" }] });
    } else {
      return HttpResponse.json({ errors: [{ message: "Elegí un equipo o un espacio" }] });
    }
    const fields = { startsAt: input.startsAt, endsAt: input.endsAt, purpose: input.purpose };
    const resourceId = (equipment ?? location)!.id;
    const error =
      firstError(validateReservation(fields)) ??
      reservationOverlapError(input.resourceType, resourceId, fields.startsAt, fields.endsAt);
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    const now = new Date().toISOString();
    const reservation: Reservation = {
      id: nextId("rsv-", mockReservations, 3),
      resourceType: input.resourceType,
      equipment,
      location,
      user: caller,
      purpose: fields.purpose.trim(),
      startsAt: new Date(fields.startsAt).toISOString(),
      endsAt: new Date(fields.endsAt).toISOString(),
      status: "pending",
      reviewedBy: null,
      rejectionReason: null,
      cancelledBy: null,
      createdAt: now,
      updatedAt: now,
    };
    mockReservations.push(reservation);
    return HttpResponse.json({ data: { createReservation: reservation } });
  }),

  graphql.mutation("ApproveReservation", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) return HttpResponse.json(FORBIDDEN);
    syncReservations();
    const { id } = variables as { id: string };
    const reservation = mockReservations.find((r) => r.id === id);
    if (!reservation) return HttpResponse.json({ errors: [{ message: "Reserva no encontrada" }] });
    if (reservation.status !== "pending") {
      return HttpResponse.json({
        errors: [{ message: invalidReservationTransition(reservation, "aprobar") }],
      });
    }
    if (Date.parse(reservation.endsAt) <= Date.now()) {
      return HttpResponse.json({
        errors: [{ message: "La reserva ya terminó: no se puede aprobar" }],
      });
    }
    // Entre dos pedidos para el mismo horario, el que se aprueba primero gana
    const overlap = reservationOverlapError(
      reservation.resourceType,
      reservationResourceId(reservation)!,
      reservation.startsAt,
      reservation.endsAt,
      reservation.id,
    );
    if (overlap) return HttpResponse.json({ errors: [{ message: overlap }] });
    reservation.status = "approved";
    reservation.reviewedBy = caller;
    reservation.updatedAt = new Date().toISOString();
    syncReservations();
    notify(reservation.user, "reservation", reservation.id, "approved", caller);
    return HttpResponse.json({ data: { approveReservation: reservation } });
  }),

  graphql.mutation("RejectReservation", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) return HttpResponse.json(FORBIDDEN);
    syncReservations();
    const { id, reason } = variables as { id: string; reason: string };
    const reservation = mockReservations.find((r) => r.id === id);
    if (!reservation) return HttpResponse.json({ errors: [{ message: "Reserva no encontrada" }] });
    if (reservation.status !== "pending") {
      return HttpResponse.json({
        errors: [{ message: invalidReservationTransition(reservation, "rechazar") }],
      });
    }
    // El solicitante ve el motivo: tiene que decir algo
    if ((reason ?? "").trim().length < 5) {
      return HttpResponse.json({
        errors: [{ message: "Indicá el motivo del rechazo (mínimo 5 caracteres)" }],
      });
    }
    reservation.status = "rejected";
    reservation.reviewedBy = caller;
    reservation.rejectionReason = reason.trim();
    reservation.updatedAt = new Date().toISOString();
    notify(reservation.user, "reservation", reservation.id, "rejected", caller);
    return HttpResponse.json({ data: { rejectReservation: reservation } });
  }),

  graphql.mutation("UpdateReservation", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) return HttpResponse.json(FORBIDDEN);
    syncReservations();
    const { id, input } = variables as {
      id: string;
      input: Partial<{ startsAt: string; endsAt: string; purpose: string }>;
    };
    const reservation = mockReservations.find((r) => r.id === id);
    if (!reservation) return HttpResponse.json({ errors: [{ message: "Reserva no encontrada" }] });
    // Lo que ya empezo o se cerro no se reprograma
    if (!CHANGEABLE_RESERVATION_STATUSES.includes(reservation.status)) {
      return HttpResponse.json({
        errors: [{ message: invalidReservationTransition(reservation, "modificar") }],
      });
    }
    const fields = {
      startsAt: input.startsAt ?? reservation.startsAt,
      endsAt: input.endsAt ?? reservation.endsAt,
      purpose: input.purpose ?? reservation.purpose,
    };
    const error =
      firstError(validateReservation(fields)) ??
      reservationOverlapError(
        reservation.resourceType,
        reservationResourceId(reservation)!,
        fields.startsAt,
        fields.endsAt,
        reservation.id,
      );
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    Object.assign(reservation, {
      startsAt: new Date(fields.startsAt).toISOString(),
      endsAt: new Date(fields.endsAt).toISOString(),
      purpose: fields.purpose.trim(),
      updatedAt: new Date().toISOString(),
    });
    syncReservations();
    notify(reservation.user, "reservation", reservation.id, "modified", caller);
    return HttpResponse.json({ data: { updateReservation: reservation } });
  }),

  graphql.mutation("CancelReservation", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    syncReservations();
    const { id } = variables as { id: string };
    const reservation = mockReservations.find((r) => r.id === id);
    if (!reservation) return HttpResponse.json({ errors: [{ message: "Reserva no encontrada" }] });
    // Solo quien la pidio la cancela, y antes de que empiece. El staff aprueba,
    // rechaza o modifica, pero no cancela reservas ajenas
    if (reservation.user.id !== caller.id) return HttpResponse.json(FORBIDDEN);
    if (!CHANGEABLE_RESERVATION_STATUSES.includes(reservation.status)) {
      return HttpResponse.json({
        errors: [{ message: invalidReservationTransition(reservation, "cancelar") }],
      });
    }
    reservation.status = "cancelled";
    reservation.cancelledBy = caller;
    reservation.updatedAt = new Date().toISOString();
    // Quien la aprobo no se entera de otra forma (si seguia pendiente no hay a quien)
    notify(reservation.reviewedBy, "reservation", reservation.id, "cancelled", caller);
    return HttpResponse.json({ data: { cancelReservation: reservation } });
  }),

  // ── Avisos ─────────────────────────────────────────────────────────────────
  // Cada uno ve solo los suyos y los marca como vistos de a uno

  graphql.query("GetNotices", ({ request }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    // Un prestamo puede haber vencido sin que nadie abriera la lista
    syncOverdueLoans();
    const notices = mockNotices
      .filter((n) => n.userId === caller.id)
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
    return HttpResponse.json({ data: { notices } });
  }),

  graphql.mutation("AcknowledgeNotice", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { id } = variables as { id: string };
    const index = mockNotices.findIndex((n) => n.id === id);
    if (index === -1) return HttpResponse.json({ errors: [{ message: "Aviso no encontrado" }] });
    if (mockNotices[index].userId !== caller.id) return HttpResponse.json(FORBIDDEN);
    mockNotices.splice(index, 1);
    return HttpResponse.json({ data: { acknowledgeNotice: true } });
  }),

  // Secciones con pedidos pendientes que el staff todavia no vio: el punto del
  // boton OOL (tickets) o de la opcion "Pendiente" del filtro (las demas)
  graphql.query("GetPendingNews", ({ request }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    if (!isStaff(caller.role)) return HttpResponse.json({ data: { pendingNews: [] } });
    syncReservations();
    const pendingNews = PENDING_SECTIONS.filter((section) => hasNewPending(caller, section));
    return HttpResponse.json({ data: { pendingNews } });
  }),

  graphql.mutation("MarkPendingSeen", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { section } = variables as { section: NoticeEntity };
    if (!PENDING_SECTIONS.includes(section)) {
      return HttpResponse.json({ errors: [{ message: "Sección inválida" }] });
    }
    const seenAt = new Date().toISOString();
    const seen = mockPendingSeen.find((s) => s.userId === caller.id && s.section === section);
    if (seen) seen.seenAt = seenAt;
    else mockPendingSeen.push({ userId: caller.id, section, seenAt });
    return HttpResponse.json({ data: { markPendingSeen: true } });
  }),

  // ── Comentarios ────────────────────────────────────────────────────────────
  // Hilo de un ticket o solicitud entre quien lo abrio y el staff

  graphql.query("GetComments", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { entityType, entityId } = variables as { entityType: CommentEntity; entityId: string };
    const denied = commentAccessError(caller, entityType, entityId);
    if (denied) return HttpResponse.json({ errors: [denied] });
    const comments = mockComments
      .filter((c) => c.entityType === entityType && c.entityId === entityId)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
    return HttpResponse.json({ data: { comments } });
  }),

  graphql.mutation("CreateComment", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!caller) return HttpResponse.json(UNAUTHENTICATED);
    const { input } = variables as {
      input: { entityType: CommentEntity; entityId: string; body: string };
    };
    const denied = commentAccessError(caller, input.entityType, input.entityId);
    if (denied) return HttpResponse.json({ errors: [denied] });
    const error = validateComment(input.body);
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    const comment: Comment = {
      id: nextId("cmt-", mockComments, 3),
      entityType: input.entityType,
      entityId: input.entityId,
      author: caller,
      body: input.body.trim(),
      createdAt: new Date().toISOString(),
    };
    mockComments.push(comment);
    // Se avisa a la otra parte del hilo: quien lo abrio y quien lo atiende
    for (const participant of threadParticipants(input.entityType, input.entityId)) {
      notify(participant, input.entityType, input.entityId, "comment", caller);
    }
    return HttpResponse.json({ data: { createComment: comment } });
  }),

  // ── Intervenciones ─────────────────────────────────────────────────────────
  // Trabajo hecho sobre un equipo, con o sin ticket. Como el inventario, es del staff

  graphql.query("GetInterventions", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { equipmentId } = variables as { equipmentId: string };
    const interventions = mockInterventions
      .filter((i) => i.equipmentId === equipmentId)
      .toSorted((a, b) => b.performedAt.localeCompare(a.performedAt));
    return HttpResponse.json({ data: { interventions } });
  }),

  graphql.mutation("CreateIntervention", ({ request, variables }) => {
    const caller = getCaller(request);
    if (!hasRole(caller, STAFF_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { input } = variables as {
      input: Partial<InterventionFields> & { equipmentId: string; ticketId?: string | null };
    };
    const product = mockProducts.find((p) => p.id === input.equipmentId);
    if (!product) return HttpResponse.json({ errors: [{ message: "Equipo no encontrado" }] });
    if (product.deletedAt) {
      return HttpResponse.json({
        errors: [{ message: "No se registran intervenciones en un equipo dado de baja" }],
      });
    }
    const now = new Date().toISOString();
    const fields: InterventionFields = {
      type: input.type ?? "",
      description: (input.description ?? "").trim(),
      partsReplaced: input.partsReplaced?.trim() || null,
      performedAt: input.performedAt ?? now,
    };
    const ticketId = input.ticketId || null;
    const error =
      firstError(validateIntervention(fields)) ?? interventionTicketError(ticketId, product.id);
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    const intervention: Intervention = {
      id: nextId("int-", mockInterventions, 3),
      equipmentId: product.id,
      technician: caller,
      ...fields,
      type: fields.type as InterventionType,
      performedAt: new Date(fields.performedAt).toISOString(),
      ticketId,
      createdAt: now,
      updatedAt: now,
    };
    mockInterventions.push(intervention);
    return HttpResponse.json({ data: { createIntervention: intervention } });
  }),

  graphql.mutation("UpdateIntervention", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { id, input } = variables as {
      id: string;
      input: Partial<InterventionFields> & { ticketId?: string | null };
    };
    const intervention = mockInterventions.find((i) => i.id === id);
    if (!intervention) {
      return HttpResponse.json({ errors: [{ message: "Intervención no encontrada" }] });
    }
    // El equipo y el tecnico que la registro no cambian; lo demas, si se manda
    const fields: InterventionFields = {
      type: input.type ?? intervention.type,
      description: (input.description ?? intervention.description).trim(),
      partsReplaced:
        input.partsReplaced !== undefined
          ? input.partsReplaced?.trim() || null
          : intervention.partsReplaced,
      performedAt: input.performedAt ?? intervention.performedAt,
    };
    const ticketId = input.ticketId !== undefined ? input.ticketId || null : intervention.ticketId;
    const error =
      firstError(validateIntervention(fields)) ??
      interventionTicketError(ticketId, intervention.equipmentId);
    if (error) return HttpResponse.json({ errors: [{ message: error }] });
    Object.assign(intervention, fields, {
      type: fields.type as InterventionType,
      performedAt: new Date(fields.performedAt).toISOString(),
      ticketId,
      updatedAt: new Date().toISOString(),
    });
    return HttpResponse.json({ data: { updateIntervention: intervention } });
  }),

  // ── Ubicaciones ────────────────────────────────────────────────────────────
  // Cualquiera con sesion las consulta (filtros y formularios); el ABM es del staff

  graphql.query("GetLocations", ({ request }) => {
    if (!getCaller(request)) return HttpResponse.json(UNAUTHENTICATED);
    const locations = mockLocations.filter((l) => l.deletedAt === null).map(withProductCount);
    return HttpResponse.json({ data: { locations } });
  }),

  graphql.mutation("CreateLocation", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { input } = variables as { input: LocationFields };
    const fields = { kind: input.kind, number: Number(input.number), name: input.name.trim() };
    const code = locationCode(fields.kind, fields.number);
    const error =
      firstError(validateLocation(fields)) ??
      (code ? duplicateLocationError({ ...fields, code }) : "Ubicación inválida");
    if (error || !code) {
      return HttpResponse.json({ errors: [{ message: error ?? "Ubicación inválida" }] });
    }
    const now = new Date().toISOString();
    const location: Location = {
      id: nextId("loc-", mockLocations),
      ...fields,
      kind: fields.kind as LocationKind,
      code,
      productCount: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    mockLocations.push(location);
    return HttpResponse.json({ data: { createLocation: location } });
  }),

  graphql.mutation("UpdateLocation", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { id, input } = variables as { id: string; input: Partial<LocationFields> };
    const location = activeLocation(id);
    if (!location) return HttpResponse.json({ errors: [{ message: "Ubicación no encontrada" }] });
    const fields = {
      kind: input.kind ?? location.kind,
      number: input.number !== undefined ? Number(input.number) : location.number,
      name: (input.name ?? location.name).trim(),
    };
    const code = locationCode(fields.kind, fields.number);
    const error =
      firstError(validateLocation(fields)) ??
      (code ? duplicateLocationError({ ...fields, code }, id) : "Ubicación inválida");
    if (error || !code) {
      return HttpResponse.json({ errors: [{ message: error ?? "Ubicación inválida" }] });
    }
    // Tipo y numero forman el codigo, que arranca el ID de maquina de cada equipo:
    // cambiarlos con equipos adentro los dejaria mal nombrados
    const products = productsIn(id);
    if (code !== location.code && products.length > 0) {
      return HttpResponse.json({
        errors: [
          {
            message: `No se puede cambiar el tipo ni el número: ${products.length} equipo(s) usan ${location.code} en su ID de máquina`,
          },
        ],
      });
    }
    Object.assign(location, fields, {
      kind: fields.kind as LocationKind,
      code,
      updatedAt: new Date().toISOString(),
    });
    // Los equipos guardan el nombre para mostrarlo: se actualiza con el renombre
    for (const p of products) p.location = location.name;
    return HttpResponse.json({ data: { updateLocation: withProductCount(location) } });
  }),

  graphql.mutation("SoftDeleteLocation", ({ request, variables }) => {
    if (!hasRole(getCaller(request), STAFF_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { id } = variables as { id: string };
    const location = activeLocation(id);
    if (!location) return HttpResponse.json({ errors: [{ message: "Ubicación no encontrada" }] });
    syncReservations();
    if (
      mockReservations.some((r) => r.location?.id === id && OPEN_RESERVATION_STATUSES.has(r.status))
    ) {
      return HttpResponse.json({
        errors: [{ message: "No se puede eliminar: la ubicación tiene reservas vigentes" }],
      });
    }
    const count = productsIn(id).length;
    if (count > 0) {
      return HttpResponse.json({
        errors: [
          {
            message: `No se puede eliminar: tiene ${count} equipo(s). Movelos a otra ubicación primero`,
          },
        ],
      });
    }
    location.deletedAt = new Date().toISOString();
    return HttpResponse.json({ data: { softDeleteLocation: true } });
  }),

  // ── Issue tracker ──────────────────────────────────────────────────────────
  // POST publico (sin sesion) que usa el navegador. Devuelve el sobre de
  // /api/v1 y hace upsert por fingerprint, igual que la API real.
  http.post("*/api/v1/errors", async ({ request }) => {
    let input: MockReportInput;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      input = parsed as MockReportInput;
    } catch {
      return HttpResponse.json(
        { status: 400, message: "El cuerpo debe ser un objeto JSON", data: null },
        { status: 400 },
      );
    }
    const result = mockReportError(input, getCaller(request));
    if (result.error) {
      return HttpResponse.json(
        { status: 422, message: result.error, data: null },
        { status: 422 },
      );
    }
    return HttpResponse.json(
      { status: 201, message: "Error registrado", data: result.report },
      { status: 201 },
    );
  }),

  graphql.query("GetErrorReports", ({ request, variables }) => {
    if (!hasRole(getCaller(request), ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { status, search, limit } = variables as {
      status?: string;
      search?: string;
      limit?: number;
    };
    const needle = search?.trim().toLowerCase();
    const reports = mockErrorReports
      .filter((r) => !status || r.status === status)
      .filter(
        (r) =>
          !needle ||
          r.message.toLowerCase().includes(needle) ||
          r.route.toLowerCase().includes(needle) ||
          r.fingerprint.toLowerCase().includes(needle),
      )
      .toSorted((a, b) => b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, Math.min(Math.max(Number(limit ?? 500), 1), 500));
    return HttpResponse.json({ data: { errorReports: reports } });
  }),

  graphql.query("GetErrorReport", ({ request, variables }) => {
    if (!hasRole(getCaller(request), ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { id } = variables as { id: string };
    const report = mockErrorReports.find((r) => r.id === id);
    if (!report) return HttpResponse.json({ errors: [{ message: "Reporte de error no encontrado" }] });
    return HttpResponse.json({ data: { errorReport: report } });
  }),

  // El mock no tiene credenciales reales: refleja el estado "sin configurar"
  // para que la UI muestre el camino de copiar el borrador.
  graphql.query("GetErrorReportSettings", ({ request }) => {
    if (!hasRole(getCaller(request), ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
    return HttpResponse.json({
      data: {
        errorReportSettings: { githubConfigured: false, llmConfigured: false, repository: null },
      },
    });
  }),

  graphql.query("GetGithubIssueDraft", ({ request, variables }) => {
    if (!hasRole(getCaller(request), ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { id } = variables as { id: string };
    const report = mockErrorReports.find((r) => r.id === id);
    if (!report) return HttpResponse.json({ errors: [{ message: "Reporte de error no encontrado" }] });
    return HttpResponse.json({ data: { githubIssueDraft: mockIssueDraft(report) } });
  }),

  graphql.mutation("ReportError", ({ request, variables }) => {
    const { input } = variables as { input: MockReportInput };
    const result = mockReportError(input, getCaller(request));
    if (result.error) return HttpResponse.json({ errors: [{ message: result.error }] });
    return HttpResponse.json({ data: { reportError: result.report } });
  }),

  graphql.mutation("UpdateErrorReportStatus", ({ request, variables }) => {
    if (!hasRole(getCaller(request), ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { id, status } = variables as { id: string; status: string };
    if (!ERROR_REPORT_STATUSES.has(status as ErrorReportStatus)) {
      return HttpResponse.json({ errors: [{ message: "Estado del reporte inválido" }] });
    }
    const report = mockErrorReports.find((r) => r.id === id);
    if (!report) return HttpResponse.json({ errors: [{ message: "Reporte de error no encontrado" }] });
    report.status = status as ErrorReportStatus;
    report.updatedAt = new Date().toISOString();
    return HttpResponse.json({ data: { updateErrorReportStatus: report } });
  }),

  graphql.mutation("CreateGithubIssue", ({ request, variables }) => {
    if (!hasRole(getCaller(request), ADMIN_ROLES)) return HttpResponse.json(FORBIDDEN);
    const { id } = variables as { id: string };
    const report = mockErrorReports.find((r) => r.id === id);
    if (!report) return HttpResponse.json({ errors: [{ message: "Reporte de error no encontrado" }] });
    if (report.githubIssueUrl) {
      return HttpResponse.json({
        data: {
          createGithubIssue: {
            url: report.githubIssueUrl,
            usedLlm: false,
            alreadyExisted: true,
          },
        },
      });
    }
    return HttpResponse.json({
      errors: [
        {
          message:
            "GitHub no está configurado: definí GITHUB_TOKEN y GITHUB_REPO en la API. Mientras tanto, copiá el borrador local.",
        },
      ],
    });
  }),
];
