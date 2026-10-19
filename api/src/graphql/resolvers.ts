import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { InterventionFields, LocationFields } from "@/lib/validation";
import {
  locationCode,
  validateComment,
  validateComponent,
  validateIntervention,
  validateLocation,
  validateProduct,
  validateReservation,
} from "@/lib/validation";
import {
  LOAN_STATUS_CONFIG,
  RESERVATION_STATUS_CONFIG,
  TICKET_STATUS_CONFIG,
  TICKET_TRANSITIONS,
  type DashboardPeriod,
} from "@/lib/constants";
import type {
  Comment,
  CommentEntity,
  DashboardStats,
  Loan,
  LoanStatus,
  Location,
  NoticeEntity,
  NoticeKind,
  Product,
  Reports,
  Reservation,
  ReservationResource,
  ReservationStatus,
  ServiceRequest,
  ServiceStatus,
  Ticket,
  TicketCategory,
  TicketStatus,
  User,
  UserRole,
} from "@/lib/types";
import { ASSIGNABLE_ROLES, canEditUser, canToggleUserActive } from "@/lib/roles";
import { signToken } from "../auth";
import type { Ctx } from "../context";
import {
  conflict,
  FORBIDDEN_MESSAGE,
  forbidden,
  invalid,
  invalidCredentials,
  notFound,
  tooManyAttempts,
  unauthenticated,
} from "../errors";
import { writeAudit } from "../audit";
import { loginIpMaxAttempts, loginLockMinutes, loginMaxAttempts } from "../env";
import { LoginGuard } from "../login-guard";
import { userFieldResolvers } from "./privacy";
import { revokeToken } from "../sessions";
import { db } from "../db/client";
import * as t from "../db/schema";
import {
  EQUIPMENT_STATUSES,
  SERVICE_STATUSES,
  SERVICE_TYPES,
  TICKET_CATEGORIES,
} from "../db/enums";
import { toUser, type State } from "../state";
import { withState, withTransaction, type AuditSpec, type Resolver } from "./wrap";

export type { Ctx };

const STAFF_ROLES: UserRole[] = ["root_admin", "admin", "tecnico"];
const ELEVATED_ROLES: UserRole[] = ["root_admin", "admin"];

function isStaff(user: User): boolean {
  return STAFF_ROLES.includes(user.role);
}

function requireAuth(ctx: Ctx): User {
  if (!ctx.caller) throw unauthenticated();
  return ctx.caller;
}

function requireRole(ctx: Ctx, roles: UserRole[]): User {
  const caller = requireAuth(ctx);
  if (!roles.includes(caller.role)) throw forbidden();
  return caller;
}

// Mismas reglas que los mocks (src/mocks/handlers.ts): el rol del root_admin es
// fijo, nadie se vuelve root_admin y nadie se cambia su propio rol.
function roleChangeError(caller: User, user: User, role: string): string | null {
  if (role === user.role) return null;
  if (user.role === "root_admin") return "El rol del Super Admin no se puede cambiar";
  if (!ASSIGNABLE_ROLES.includes(role as UserRole)) return "No se puede asignar el rol Super Admin";
  if (user.id === caller.id) return "No podés cambiar tu propio rol";
  return null;
}

// El root_admin no se desactiva y nadie se desactiva a sí mismo (RF-USR-005).
function activationError(caller: User, user: User): string | null {
  if (canToggleUserActive(caller, user)) return null;
  if (user.role === "root_admin") return "El Super Admin no se puede desactivar";
  if (user.id === caller.id) return "No podés desactivar tu propia cuenta";
  return FORBIDDEN_MESSAGE;
}

// Un tecnico no toca el trabajo de otro: si el ticket o la solicitud tiene a otra
// persona asignada, solo la puede modificar un administrador. Lo que esta sin
// asignar (recien creado o devuelto a la cola) lo puede trabajar cualquier
// tecnico, que es como se reclama (claim*). El asignado conserva el control.
function assertCanWorkOn(caller: User, assignedTo: User | null, what: string): void {
  if (caller.role !== "tecnico") return;
  if (assignedTo && assignedTo.id !== caller.id) {
    throw forbidden(`${what} está asignado a otro técnico`);
  }
}

function filterByStatus<T extends { status: string }>(items: T[], status?: string | null): T[] {
  if (!status) return items;
  return items.filter((i) => i.status === status);
}

// Siguiente id correlativo de una coleccion, con el mismo formato que los datos
// de ejemplo: "tkt-015" -> "tkt-016".
function maxSuffix(prefix: string, items: Array<{ id: string }>): number {
  return items.reduce((n, { id }) => {
    const suffix = id.startsWith(prefix) ? id.slice(prefix.length) : "";
    return /^\d+$/.test(suffix) ? Math.max(n, Number(suffix)) : n;
  }, 0);
}

// Las filas con baja logica no estan en `items` pero siguen ocupando su id.
function nextId(state: State, prefix: string, items: Array<{ id: string }>, pad = 0): string {
  const retired = Array.from(state.deletedIds, (id) => ({ id }));
  const last = Math.max(maxSuffix(prefix, items), maxSuffix(prefix, retired));
  return prefix + String(last + 1).padStart(pad, "0");
}

const USER_ID_PREFIX: Record<UserRole, string> = {
  root_admin: "u-root-",
  admin: "u-admin-",
  tecnico: "u-tec-",
  solicitante: "u-sol-",
};

const OPEN_LOAN_STATUSES = new Set<LoanStatus>(["approved", "active", "overdue"]);
const IN_COURSE_LOAN_STATUSES = new Set<LoanStatus>(["pending", ...OPEN_LOAN_STATUSES]);

function hasOpenLoan(state: State, equipmentId: string, exceptLoanId?: string): boolean {
  return state.loans.some(
    (l) =>
      l.id !== exceptLoanId && l.equipment.id === equipmentId && OPEN_LOAN_STATUSES.has(l.status),
  );
}

const PENDING_SECTIONS: NoticeEntity[] = ["ticket", "service_request", "reservation", "loan"];

function pendingIn(state: State, section: NoticeEntity): Array<{ createdAt: string; by: User }> {
  switch (section) {
    case "ticket":
      return state.tickets
        .filter((t) => t.status === "pending" && !t.assignedTo)
        .map((t) => ({ createdAt: t.createdAt, by: t.submittedBy }));
    case "service_request":
      return state.services
        .filter((s) => s.status === "pending")
        .map((s) => ({ createdAt: s.createdAt, by: s.requestedBy }));
    case "reservation":
      return state.reservations
        .filter((r) => r.status === "pending")
        .map((r) => ({ createdAt: r.createdAt, by: r.user }));
    case "loan":
      return state.loans
        .filter((l) => l.status === "pending")
        .map((l) => ({ createdAt: l.createdAt, by: l.user }));
  }
}

function hasNewPending(state: State, user: User, section: NoticeEntity): boolean {
  const seen = state.pendingSeen.find((s) => s.userId === user.id && s.section === section);
  const seenAt = seen ? Date.parse(seen.seenAt) : 0;
  return pendingIn(state, section).some(
    (p) => p.by.id !== user.id && Date.parse(p.createdAt) > seenAt,
  );
}

// Los avisos vistos se borran; se lleva la cuenta aparte para no reusar un id que
// una pestaña desactualizada pueda marcar como visto.
let lastNoticeNumber = 0;
function nextNoticeId(state: State): string {
  lastNoticeNumber = Math.max(lastNoticeNumber, maxSuffix("ntc-", state.notices)) + 1;
  return `ntc-${String(lastNoticeNumber).padStart(3, "0")}`;
}

async function dropNotices(
  state: State,
  entityType: NoticeEntity,
  entityId: string,
  kind: NoticeKind,
): Promise<void> {
  await db
    .delete(t.notices)
    .where(
      and(
        eq(t.notices.entityType, entityType),
        eq(t.notices.entityId, entityId),
        eq(t.notices.kind, kind),
      ),
    );
  for (let i = state.notices.length - 1; i >= 0; i--) {
    const n = state.notices[i];
    if (n && n.entityType === entityType && n.entityId === entityId && n.kind === kind) {
      state.notices.splice(i, 1);
    }
  }
}

// Al dar de baja algo se retiran todos sus avisos pendientes.
async function dropNoticesOf(
  state: State,
  entityType: NoticeEntity,
  entityId: string,
): Promise<void> {
  await db
    .delete(t.notices)
    .where(and(eq(t.notices.entityType, entityType), eq(t.notices.entityId, entityId)));
  state.notices = state.notices.filter(
    (n) => !(n.entityType === entityType && n.entityId === entityId),
  );
}

function removeFrom<T extends { id: string }>(items: T[], byId: Map<string, T>, id: string): T[] {
  byId.delete(id);
  return items.filter((item) => item.id !== id);
}

// Quien puede dar de baja algo ajeno: administradores. El dueño solo cancela lo
// suyo mientras nadie lo tomo.
function canRetire(caller: User, ownerId: string | undefined, ownerMayCancel: boolean): boolean {
  return ELEVATED_ROLES.includes(caller.role) || (ownerId === caller.id && ownerMayCancel);
}

// Deja un aviso a `to` sobre algo que hizo `by` (null: el sistema).
async function notify(
  state: State,
  to: User | null | undefined,
  entityType: NoticeEntity,
  entityId: string,
  kind: NoticeKind,
  by: User | null,
): Promise<void> {
  if (!to || to.id === by?.id) return;
  const index = state.notices.findIndex(
    (n) => n.userId === to.id && n.entityType === entityType && n.entityId === entityId,
  );
  if (index !== -1) {
    await db
      .delete(t.notices)
      .where(
        and(
          eq(t.notices.userId, to.id),
          eq(t.notices.entityType, entityType),
          eq(t.notices.entityId, entityId),
        ),
      );
    state.notices.splice(index, 1);
  }
  const id = nextNoticeId(state);
  const createdAt = new Date().toISOString();
  await db
    .insert(t.notices)
    .values({ id, userId: to.id, entityType, entityId, kind, byId: by?.id ?? null, createdAt });
  state.notices.push({ id, userId: to.id, entityType, entityId, kind, by, createdAt });
}

// Un ticket o solicitud cambia de responsable (`next` null: queda sin asignar).
async function handOver(
  state: State,
  entityType: "ticket" | "service_request",
  entityId: string,
  requester: User,
  previous: User | null,
  next: User | null,
  by: User,
): Promise<void> {
  if (previous?.id === next?.id) return;
  if (previous) await notify(state, previous, entityType, entityId, "unassigned", by);
  if (next) {
    await notify(state, next, entityType, entityId, "assigned", by);
    await notify(state, requester, entityType, entityId, "taken", next);
  }
}

// Un prestamo entregado cuya fecha de devolucion ya paso queda vencido.
async function syncOverdueLoans(state: State): Promise<void> {
  const now = new Date();
  for (const loan of state.loans) {
    if (loan.status === "active" && new Date(loan.returnDate) < now) {
      loan.status = "overdue";
      await db.update(t.loans).set({ status: "overdue" }).where(eq(t.loans.id, loan.id));
      await notify(state, loan.approvedBy, "loan", loan.id, "overdue", null);
      await notify(state, loan.user, "loan", loan.id, "overdue", null);
    }
  }
}

const BLOCKING_RESERVATION_STATUSES = new Set<ReservationStatus>(["approved", "active"]);
const OPEN_RESERVATION_STATUSES = new Set<ReservationStatus>(["pending", "approved", "active"]);

async function syncReservations(state: State, now: number = Date.now()): Promise<void> {
  for (const r of state.reservations) {
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
      await db
        .update(t.reservations)
        .set({ status: next, updatedAt: r.updatedAt })
        .where(eq(t.reservations.id, r.id));
    }
  }
}

function reservationResourceId(r: Reservation): string | undefined {
  return r.resourceType === "equipment" ? r.equipment?.id : r.location?.id;
}

function reservationOverlapError(
  state: State,
  resourceType: ReservationResource,
  resourceId: string,
  startsAt: string,
  endsAt: string,
  exceptId?: string,
): string | null {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const clash = state.reservations.find(
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

function canTransitionTicket(ticket: Ticket, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[ticket.status].includes(to);
}

function invalidTicketTransition(ticket: Ticket, to: TicketStatus): string {
  return `No se puede pasar un ticket de "${TICKET_STATUS_CONFIG[ticket.status].label}" a "${TICKET_STATUS_CONFIG[to].label}"`;
}

function invalidReservationTransition(r: Reservation, action: string): string {
  return `No se puede ${action} una reserva "${RESERVATION_STATUS_CONFIG[r.status].label}"`;
}

function invalidLoanTransition(loan: Loan, action: string): string {
  return `No se puede ${action} un préstamo en estado "${LOAN_STATUS_CONFIG[loan.status].label}"`;
}

function firstError(errors: Record<string, string | undefined>): string | null {
  return Object.values(errors)[0] ?? null;
}

// Valor de un campo de lista cerrada (estado, categoria, tipo): la base lo exige
// con un CHECK, aca se responde con un mensaje claro antes de llegar a ella.
function assertOneOf(value: string, allowed: readonly string[], message: string): void {
  if (!allowed.includes(value)) throw invalid(message);
}

// Una referencia a un equipo tiene que apuntar a uno que exista (FK de la base).
function assertProductExists(state: State, id: string | null | undefined, message: string): void {
  if (id && !state.productsById.has(id)) throw invalid(message);
}

// Primero las reglas de formato (422); si pasan, las que chocan con el estado
// actual, como un duplicado o una superposicion (409).
function assertRules(validation: string | null, clash: () => string | null = () => null): void {
  if (validation) throw invalid(validation);
  const clashing = clash();
  if (clashing) throw conflict(clashing);
}

function duplicateProductError(
  state: State,
  fields: { machineId: string; serialNumber: string },
  exceptId?: string,
): string | null {
  const others = state.products.filter((p) => p.deletedAt === null && p.id !== exceptId);
  if (others.some((p) => p.machineId === fields.machineId)) {
    return `Ya existe un equipo con ID ${fields.machineId}`;
  }
  if (others.some((p) => p.serialNumber === fields.serialNumber)) {
    return `Ya existe un equipo con n° de serie ${fields.serialNumber}`;
  }
  return null;
}

function assertCommentAccess(
  state: State,
  caller: User,
  entityType: CommentEntity,
  entityId: string,
): void {
  const owner =
    entityType === "ticket"
      ? state.tickets.find((t) => t.id === entityId)?.submittedBy
      : entityType === "service_request"
        ? state.services.find((s) => s.id === entityId)?.requestedBy
        : undefined;
  if (!owner) throw notFound("No encontrado");
  if (!isStaff(caller) && owner.id !== caller.id) throw forbidden();
}

function threadParticipants(state: State, entityType: CommentEntity, entityId: string): User[] {
  const item =
    entityType === "ticket"
      ? state.tickets.find((t) => t.id === entityId)
      : state.services.find((s) => s.id === entityId);
  if (!item) return [];
  const owner = "submittedBy" in item ? item.submittedBy : item.requestedBy;
  return item.assignedTo && item.assignedTo.id !== owner.id ? [owner, item.assignedTo] : [owner];
}

function interventionTicketError(
  state: State,
  ticketId: string | null,
  equipmentId: string,
): string | null {
  if (!ticketId) return null;
  const ticket = state.tickets.find((t) => t.id === ticketId);
  if (!ticket) return "El ticket no existe";
  if (ticket.equipmentId !== equipmentId) return "Ese ticket no corresponde a este equipo";
  return null;
}

function activeLocation(state: State, id: string | undefined | null): Location | undefined {
  return state.locations.find((l) => l.id === id && l.deletedAt === null);
}

function productsIn(state: State, locationId: string): Product[] {
  return state.products.filter((p) => p.deletedAt === null && p.locationId === locationId);
}

function withProductCount(state: State, location: Location): Location {
  return { ...location, productCount: productsIn(state, location.id).length };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function duplicateLocationError(
  state: State,
  fields: LocationFields & { code: string },
  exceptId?: string,
): string | null {
  const others = state.locations.filter((l) => l.deletedAt === null && l.id !== exceptId);
  const sameCode = others.find((l) => l.code === fields.code);
  if (sameCode) return `Ya existe ${sameCode.name} (${fields.code})`;
  if (others.some((l) => normalizeName(l.name) === normalizeName(fields.name))) {
    return `Ya existe una ubicación llamada ${fields.name}`;
  }
  return null;
}

const CLOSED_SERVICE_STATUSES = new Set<ServiceStatus>(["completed", "rejected"]);
const SERVICE_RESPONSE_NOTICES = {
  approved: "approved",
  rejected: "rejected",
  completed: "completed",
} as const satisfies Partial<Record<ServiceStatus, NoticeKind>>;

function averageResolutionHours(tickets: Ticket[]): number | null {
  const resolved = tickets.filter((t) => t.status === "resolved" && t.resolvedAt);
  if (resolved.length === 0) return null;
  const total = resolved.reduce(
    (sum, t) => sum + (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()),
    0,
  );
  return Math.round((total / resolved.length / 3_600_000) * 10) / 10;
}

const PERIOD_BUCKETS: Record<DashboardPeriod, { days: number; bucketDays: number }> = {
  "7d": { days: 7, bucketDays: 1 },
  "30d": { days: 30, bucketDays: 1 },
  "90d": { days: 91, bucketDays: 7 },
};

const nowIso = () => new Date().toISOString();

const loginGuard = new LoginGuard({
  maxAttempts: loginMaxAttempts(),
  ipMaxAttempts: loginIpMaxAttempts(),
  lockMs: loginLockMinutes() * 60 * 1000,
});

// Tope de largo de la contrasena que se acepta verificar (evita usar argon2 como DoS).
const MAX_PASSWORD_LENGTH = 512;

let placeholder: Promise<string> | undefined;
function placeholderHash(): Promise<string> {
  placeholder ??= Bun.password.hash(crypto.randomUUID(), { algorithm: "argon2id" });
  return placeholder;
}

// Tope de filas de una consulta del registro de actividad.
const ACTIVITY_LOG_LIMIT = 1000;

// ── Queries ──────────────────────────────────────────────────────────────────

const Query = {
  login: async (_p: unknown, args: { dni: string; password: string }, ctx: Ctx) => {
    const lock = loginGuard.check(args.dni, ctx.ip);
    if (lock.locked) {
      const minutes = Math.ceil(lock.retryAfterSeconds / 60);
      throw tooManyAttempts(
        `Demasiados intentos fallidos. Probá de nuevo en ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`,
        lock.retryAfterSeconds,
      );
    }
    const [row] = await db.select().from(t.users).where(eq(t.users.dni, args.dni)).limit(1);
    // Se verifica siempre contra algun hash (el real o uno de relleno) para que el
    // tiempo de respuesta no delate si el documento existe.
    const active = row?.isActive === true;
    const hash = active ? row.passwordHash : await placeholderHash();
    const passwordOk = args.password.length <= MAX_PASSWORD_LENGTH && (await Bun.password.verify(args.password, hash));
    if (!active || !passwordOk) {
      const { dniLocked, ipLocked } = loginGuard.recordFailure(args.dni, ctx.ip);
      const who = { userId: row?.id ?? "anonymous", userName: row?.name ?? "Anónimo" };
      await writeAudit({ ...who, operation: "LOGIN_FAILED", entity: "Session", entityId: row?.id ?? "-", details: `IP ${ctx.ip}` });
      if (dniLocked || ipLocked) {
        await writeAudit({
          ...who,
          operation: "ACCOUNT_LOCKED",
          entity: "Session",
          entityId: row?.id ?? "-",
          details: `Bloqueo por ${dniLocked ? "documento" : "IP"} desde ${ctx.ip}`,
        });
      }
      throw invalidCredentials();
    }
    loginGuard.recordSuccess(args.dni);
    const user = toUser(row);
    await writeAudit({ userId: user.id, userName: user.name, operation: "LOGIN", entity: "Session", entityId: user.id, details: `IP ${ctx.ip}` });
    const token = await signToken({ sub: user.id, role: user.role });
    return { ...user, token };
  },

  me: (_p: unknown, _a: unknown, ctx: Ctx) => ctx.caller,

  users: (_p: unknown, args: { role?: string; isActive?: boolean }, ctx: Ctx) => {
    requireRole(ctx, STAFF_ROLES);
    let users = [...ctx.state.users];
    if (args.role) users = users.filter((u) => u.role === args.role);
    if (args.isActive !== undefined && args.isActive !== null) {
      users = users.filter((u) => u.isActive === args.isActive);
    }
    return users;
  },

  user: (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    if (!isStaff(caller) && args.id !== caller.id) throw forbidden();
    return ctx.state.users.find((u) => u.id === args.id) ?? null;
  },

  products: (
    _p: unknown,
    args: { status?: string; locationId?: string; availableForLoan?: boolean },
    ctx: Ctx,
  ) => {
    requireAuth(ctx);
    let products = ctx.state.products.filter((p) => p.deletedAt === null);
    if (args.status) products = products.filter((p) => p.status === args.status);
    if (args.availableForLoan) {
      products = products.filter((p) => p.status === "available" && !hasOpenLoan(ctx.state, p.id));
    }
    if (args.locationId) products = products.filter((p) => p.locationId === args.locationId);
    return products;
  },

  product: (_p: unknown, args: { id: string }, ctx: Ctx) => {
    requireAuth(ctx);
    return ctx.state.products.find((p) => p.id === args.id) ?? null;
  },

  productByMachineId: (_p: unknown, args: { machineId: string }, ctx: Ctx) => {
    requireAuth(ctx);
    return (
      ctx.state.products.find((p) => p.machineId === args.machineId && p.deletedAt === null) ?? null
    );
  },

  components: (_p: unknown, args: { productId?: string; isWorking?: boolean }, ctx: Ctx) => {
    requireAuth(ctx);
    let components = ctx.state.components.filter((c) => c.deletedAt === null);
    if (args.productId !== undefined) {
      components = components.filter((c) => c.productId === args.productId);
    }
    if (args.isWorking !== undefined && args.isWorking !== null) {
      components = components.filter((c) => c.isWorking === args.isWorking);
    }
    return components;
  },

  component: (_p: unknown, args: { id: string }, ctx: Ctx) => {
    requireAuth(ctx);
    return ctx.state.components.find((c) => c.id === args.id) ?? null;
  },

  tickets: (
    _p: unknown,
    args: { status?: string; assignedToId?: string; submittedById?: string; equipmentId?: string },
    ctx: Ctx,
  ) => {
    const caller = requireAuth(ctx);
    const scopedSubmittedById = isStaff(caller) ? args.submittedById : caller.id;
    let tickets = [...ctx.state.tickets];
    if (args.status) tickets = tickets.filter((t) => t.status === args.status);
    if (args.assignedToId) tickets = tickets.filter((t) => t.assignedTo?.id === args.assignedToId);
    if (scopedSubmittedById) {
      tickets = tickets.filter((t) => t.submittedBy.id === scopedSubmittedById);
    }
    if (args.equipmentId) tickets = tickets.filter((t) => t.equipmentId === args.equipmentId);
    return tickets;
  },

  ticket: (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    const ticket = ctx.state.tickets.find((t) => t.id === args.id) ?? null;
    if (ticket && !isStaff(caller) && ticket.submittedBy.id !== caller.id) {
      throw forbidden();
    }
    return ticket;
  },

  oolTickets: (_p: unknown, _a: unknown, ctx: Ctx) => {
    requireRole(ctx, STAFF_ROLES);
    return ctx.state.tickets.filter((t) => t.status === "pending" && t.assignedTo === null);
  },

  loans: (
    _p: unknown,
    args: { status?: string; userId?: string; equipmentId?: string },
    ctx: Ctx,
  ) => {
    const caller = requireAuth(ctx);
    return syncOverdueLoans(ctx.state).then(() => {
      const scopedUserId = isStaff(caller) ? args.userId : caller.id;
      let loans = [...ctx.state.loans];
      if (args.status) loans = filterByStatus<Loan>(loans, args.status);
      if (scopedUserId) loans = loans.filter((l) => l.user.id === scopedUserId);
      if (args.equipmentId) loans = loans.filter((l) => l.equipment.id === args.equipmentId);
      return loans;
    });
  },

  loan: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    await syncOverdueLoans(ctx.state);
    const loan = ctx.state.loans.find((l) => l.id === args.id) ?? null;
    if (loan && !isStaff(caller) && loan.user.id !== caller.id) throw forbidden();
    return loan;
  },

  serviceRequests: (
    _p: unknown,
    args: { status?: string; requestedById?: string },
    ctx: Ctx,
  ) => {
    const caller = requireAuth(ctx);
    const scopedRequestedById = isStaff(caller) ? args.requestedById : caller.id;
    let services = [...ctx.state.services];
    if (args.status) services = filterByStatus<ServiceRequest>(services, args.status);
    if (scopedRequestedById) {
      services = services.filter((s) => s.requestedBy.id === scopedRequestedById);
    }
    return services;
  },

  serviceRequest: (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    const service = ctx.state.services.find((s) => s.id === args.id) ?? null;
    if (service && !isStaff(caller) && service.requestedBy.id !== caller.id) {
      throw forbidden();
    }
    return service;
  },

  dashboardStats: async (_p: unknown, args: { period?: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    await syncOverdueLoans(ctx.state);
    const { state } = ctx;
    const { days, bucketDays } =
      PERIOD_BUCKETS[args.period as DashboardPeriod] ?? PERIOD_BUCKETS["7d"];

    const staff = isStaff(caller);
    const tickets = staff
      ? state.tickets
      : state.tickets.filter((t) => t.submittedBy.id === caller.id);
    const loans = staff ? state.loans : state.loans.filter((l) => l.user.id === caller.id);
    const services = staff
      ? state.services
      : state.services.filter((s) => s.requestedBy.id === caller.id);
    const equipment = state.products.filter(
      (p) => p.deletedAt === null && (staff || (p.status === "available" && !hasOpenLoan(state, p.id))),
    );

    const ticketStatuses: TicketStatus[] = ["pending", "in_progress", "in_resolution", "resolved"];
    const ticketsByStatus = ticketStatuses.map((status) => ({
      status,
      count: tickets.filter((t) => t.status === status).length,
    }));

    const todayEnd = new Date();
    todayEnd.setUTCHours(24, 0, 0, 0);
    const bucketCount = Math.ceil(days / bucketDays);
    const servicesByPeriod = Array.from({ length: bucketCount }, (_, i) => {
      const end = new Date(todayEnd);
      end.setUTCDate(end.getUTCDate() - (bucketCount - 1 - i) * bucketDays);
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - bucketDays);
      const count = services.filter((s) => {
        const created = new Date(s.createdAt);
        return created >= start && created < end;
      }).length;
      return { date: start.toISOString().slice(0, 10), count };
    });

    const stats: DashboardStats = {
      totalEquipment: equipment.length,
      openTickets: tickets.filter((t) => t.status !== "resolved").length,
      activeLoans: loans.filter((l) => OPEN_LOAN_STATUSES.has(l.status)).length,
      pendingServices: services.filter((s) => s.status === "pending").length,
      ticketsByStatus,
      servicesByPeriod,
      workQueue: staff
        ? {
            unassignedTickets: state.tickets.filter((t) => t.status === "pending" && !t.assignedTo)
              .length,
            ticketsInProgress: state.tickets.filter(
              (t) => t.status === "in_progress" || t.status === "in_resolution",
            ).length,
            pendingServices: state.services.filter((s) => s.status === "pending").length,
            overdueLoans: state.loans.filter((l) => l.status === "overdue").length,
            equipmentInRepair: state.products.filter(
              (p) => p.deletedAt === null && p.status === "in_repair",
            ).length,
          }
        : null,
    };
    return stats;
  },

  reports: async (_p: unknown, _a: unknown, ctx: Ctx) => {
    requireRole(ctx, ELEVATED_ROLES);
    const { state } = ctx;
    await syncOverdueLoans(state);
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const overdueLoans = state.loans
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
    const resolution = {
      resolvedCount: state.tickets.filter((t) => t.status === "resolved" && t.resolvedAt).length,
      averageHours: averageResolutionHours(state.tickets),
      byCategory: categories.map((category) => {
        const tickets = state.tickets.filter((t) => t.category === category);
        return {
          category,
          resolvedCount: tickets.filter((t) => t.status === "resolved" && t.resolvedAt).length,
          averageHours: averageResolutionHours(tickets),
        };
      }),
    };

    const topIncidentEquipment = state.products
      .map((p) => {
        const tickets = state.tickets.filter((t) => t.equipmentId === p.id);
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
    return reports;
  },

  // Lee directo de la tabla (parametrizado, mas nuevos primero, tope de filas):
  // el log crece con cada mutacion y no entra en la foto que se carga por request.
  activityLogs: async (
    _p: unknown,
    args: { userId?: string; operation?: string; startDate?: string; endDate?: string },
    ctx: Ctx,
  ) => {
    requireRole(ctx, ELEVATED_ROLES);
    const filters = [
      args.userId ? eq(t.activityLogs.userId, args.userId) : undefined,
      args.operation ? eq(t.activityLogs.operation, args.operation) : undefined,
      args.startDate ? gte(t.activityLogs.timestamp, args.startDate) : undefined,
      args.endDate ? lte(t.activityLogs.timestamp, args.endDate) : undefined,
    ].filter((f) => f !== undefined);
    return db
      .select()
      .from(t.activityLogs)
      .where(and(...filters))
      .orderBy(desc(t.activityLogs.timestamp))
      .limit(ACTIVITY_LOG_LIMIT);
  },

  location: (_p: unknown, args: { id: string }, ctx: Ctx) => {
    requireAuth(ctx);
    const location = activeLocation(ctx.state, args.id);
    return location ? withProductCount(ctx.state, location) : null;
  },

  intervention: (_p: unknown, args: { id: string }, ctx: Ctx) => {
    requireRole(ctx, STAFF_ROLES);
    return ctx.state.interventions.find((i) => i.id === args.id) ?? null;
  },

  comment: (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    const comment = ctx.state.comments.find((c) => c.id === args.id) ?? null;
    if (comment) assertCommentAccess(ctx.state, caller, comment.entityType, comment.entityId);
    return comment;
  },

  locations: (_p: unknown, _a: unknown, ctx: Ctx) => {
    requireAuth(ctx);
    return ctx.state.locations
      .filter((l) => l.deletedAt === null)
      .map((l) => withProductCount(ctx.state, l));
  },

  interventions: (_p: unknown, args: { equipmentId: string }, ctx: Ctx) => {
    requireRole(ctx, STAFF_ROLES);
    return ctx.state.interventions
      .filter((i) => i.equipmentId === args.equipmentId)
      .toSorted((a, b) => b.performedAt.localeCompare(a.performedAt));
  },

  comments: (_p: unknown, args: { entityType: string; entityId: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    const entityType = args.entityType as CommentEntity;
    assertCommentAccess(ctx.state, caller, entityType, args.entityId);
    return ctx.state.comments
      .filter((c) => c.entityType === entityType && c.entityId === args.entityId)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  reservations: async (_p: unknown, args: { status?: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    await syncReservations(ctx.state);
    let reservations = isStaff(caller)
      ? [...ctx.state.reservations]
      : ctx.state.reservations.filter((r) => r.user.id === caller.id);
    if (args.status) reservations = reservations.filter((r) => r.status === args.status);
    reservations.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    return reservations;
  },

  reservation: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    await syncReservations(ctx.state);
    const reservation = ctx.state.reservations.find((r) => r.id === args.id) ?? null;
    if (reservation && !isStaff(caller) && reservation.user.id !== caller.id) {
      throw forbidden();
    }
    return reservation;
  },

  notices: async (_p: unknown, _a: unknown, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    await syncOverdueLoans(ctx.state);
    return ctx.state.notices
      .filter((n) => n.userId === caller.id)
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  pendingNews: async (_p: unknown, _a: unknown, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    if (!isStaff(caller)) return [];
    await syncReservations(ctx.state);
    return PENDING_SECTIONS.filter((section) => hasNewPending(ctx.state, caller, section));
  },
};

// ── Mutations ────────────────────────────────────────────────────────────────

const Mutation = {
  createUser: async (
    _p: unknown,
    args: {
      input: {
        name: string;
        dni: string;
        email: string;
        password?: string;
        role: string;
        isActive?: boolean;
      };
    },
    ctx: Ctx,
  ) => {
    requireRole(ctx, ELEVATED_ROLES);
    const { input } = args;
    if (!ASSIGNABLE_ROLES.includes(input.role as UserRole)) {
      throw forbidden("No se puede asignar el rol Super Admin");
    }
    if (ctx.state.users.some((u) => u.dni === input.dni)) {
      throw conflict("Ya existe un usuario con ese documento");
    }
    const user: User = {
      id: nextId(ctx.state, USER_ID_PREFIX[input.role as UserRole] ?? "u-", ctx.state.users),
      name: input.name,
      dni: input.dni,
      email: input.email,
      role: input.role as UserRole,
      isActive: input.isActive ?? true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const passwordHash = await Bun.password.hash(input.password || crypto.randomUUID(), {
      algorithm: "argon2id",
    });
    await db.insert(t.users).values({ ...user, passwordHash });
    ctx.state.users.push(user);
    ctx.state.usersById.set(user.id, user);
    return user;
  },

  updateUser: async (
    _p: unknown,
    args: { id: string; input: Partial<Record<string, unknown>> & { password?: string } },
    ctx: Ctx,
  ) => {
    const caller = requireRole(ctx, ELEVATED_ROLES);
    const user = ctx.state.users.find((u) => u.id === args.id);
    if (!user) throw notFound("Usuario no encontrado");
    if (!canEditUser(caller, user)) throw forbidden();
    const { password, ...rest } = args.input;
    const role = typeof rest.role === "string" ? rest.role : user.role;
    const togglesActive = typeof rest.isActive === "boolean" && rest.isActive !== user.isActive;
    const error = roleChangeError(caller, user, role) ?? (togglesActive ? activationError(caller, user) : null);
    if (error) throw forbidden(error);
    if (typeof rest.dni === "string" && ctx.state.users.some((u) => u.dni === rest.dni && u.id !== user.id)) {
      throw conflict("Ya existe un usuario con ese documento");
    }
    const next = { ...rest, updatedAt: nowIso() } as Partial<typeof t.users.$inferInsert>;
    const passwordHash = password
      ? await Bun.password.hash(String(password), { algorithm: "argon2id" })
      : undefined;
    await db
      .update(t.users)
      .set({ ...next, ...(passwordHash ? { passwordHash } : {}) })
      .where(eq(t.users.id, user.id));
    Object.assign(user, rest, { updatedAt: next.updatedAt });
    return user;
  },

  deleteUser: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    requireRole(ctx, ELEVATED_ROLES);
    const user = ctx.state.users.find((u) => u.id === args.id);
    if (!user) throw notFound("Usuario no encontrado");
    if (user.role === "root_admin") throw forbidden("No se puede eliminar este usuario");
    // Mismas reglas que updateUser(isActive: false): nadie se da de baja a si mismo
    const blocked = activationError(ctx.caller!, user);
    if (blocked) throw forbidden(blocked);
    user.isActive = false;
    user.updatedAt = nowIso();
    await db
      .update(t.users)
      .set({ isActive: false, updatedAt: user.updatedAt })
      .where(eq(t.users.id, user.id));
    return true;
  },

  createProduct: async (
    _p: unknown,
    args: {
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
    },
    ctx: Ctx,
  ) => {
    requireRole(ctx, STAFF_ROLES);
    const { input } = args;
    const location = activeLocation(ctx.state, input.locationId);
    const fields = {
      machineId: input.machineId.trim().toUpperCase(),
      kind: input.kind,
      location,
      brand: input.brand.trim(),
      model: input.model.trim(),
      serialNumber: input.serialNumber.trim().toUpperCase(),
      partNumber: input.partNumber.trim().toUpperCase(),
    };
    assertOneOf(input.status, EQUIPMENT_STATUSES, "Estado de equipo inválido");
    assertRules(firstError(validateProduct(fields)), () => duplicateProductError(ctx.state, fields));
    if (!location) throw invalid("Ubicación inválida");
    const product: Product = {
      id: nextId(ctx.state, "prod-", ctx.state.products),
      type: "product",
      machineId: fields.machineId,
      kind: fields.kind,
      brand: fields.brand,
      model: fields.model,
      serialNumber: fields.serialNumber,
      partNumber: fields.partNumber,
      status: input.status as Product["status"],
      issues: input.issues?.trim() || null,
      locationId: location.id,
      location: location.name,
      components: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
    };
    await db.insert(t.products).values({
      id: product.id,
      machineId: product.machineId,
      kind: product.kind,
      brand: product.brand,
      model: product.model,
      serialNumber: product.serialNumber,
      partNumber: product.partNumber,
      status: product.status,
      issues: product.issues,
      locationId: product.locationId,
      location: product.location,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      deletedAt: null,
    });
    ctx.state.products.push(product);
    ctx.state.productsById.set(product.id, product);
    return product;
  },

  updateProduct: async (
    _p: unknown,
    args: { id: string; input: Partial<Record<string, unknown>> },
    ctx: Ctx,
  ) => {
    requireRole(ctx, STAFF_ROLES);
    const product = ctx.state.products.find((p) => p.id === args.id && p.deletedAt === null);
    if (!product) throw notFound("Producto no encontrado");
    const input = args.input as Partial<{
      machineId: string;
      kind: string;
      brand: string;
      model: string;
      serialNumber: string;
      partNumber: string;
      locationId: string;
      issues: string | null;
    }>;
    const location = activeLocation(ctx.state, input.locationId ?? product.locationId);
    const next = {
      machineId: (input.machineId ?? product.machineId).trim().toUpperCase(),
      kind: input.kind ?? product.kind,
      location,
      brand: (input.brand ?? product.brand).trim(),
      model: (input.model ?? product.model).trim(),
      serialNumber: (input.serialNumber ?? product.serialNumber).trim().toUpperCase(),
      partNumber: (input.partNumber ?? product.partNumber).trim().toUpperCase(),
    };
    assertRules(firstError(validateProduct(next)), () =>
      duplicateProductError(ctx.state, next, product.id),
    );
    if (!location) throw invalid("Ubicación inválida");
    Object.assign(product, {
      machineId: next.machineId,
      kind: next.kind,
      brand: next.brand,
      model: next.model,
      serialNumber: next.serialNumber,
      partNumber: next.partNumber,
      locationId: location.id,
      location: location.name,
      updatedAt: nowIso(),
    });
    if (input.issues !== undefined) product.issues = input.issues?.trim() || null;
    await db
      .update(t.products)
      .set({
        machineId: product.machineId,
        kind: product.kind,
        brand: product.brand,
        model: product.model,
        serialNumber: product.serialNumber,
        partNumber: product.partNumber,
        locationId: product.locationId,
        location: product.location,
        issues: product.issues,
        updatedAt: product.updatedAt,
      })
      .where(eq(t.products.id, product.id));
    return product;
  },

  softDeleteProduct: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    requireRole(ctx, STAFF_ROLES);
    const { state } = ctx;
    const product = state.products.find((p) => p.id === args.id && p.deletedAt === null);
    if (!product) throw notFound("Producto no encontrado");
    await syncOverdueLoans(state);
    if (state.loans.some((l) => l.equipment.id === args.id && IN_COURSE_LOAN_STATUSES.has(l.status))) {
      throw conflict("No se puede dar de baja: el equipo tiene préstamos en curso");
    }
    if (state.tickets.some((t) => t.equipmentId === args.id && t.status !== "resolved")) {
      throw conflict("No se puede dar de baja: el equipo tiene tickets abiertos");
    }
    await syncReservations(state);
    if (
      state.reservations.some(
        (r) => r.equipment?.id === args.id && OPEN_RESERVATION_STATUSES.has(r.status),
      )
    ) {
      throw conflict("No se puede dar de baja: el equipo tiene reservas vigentes");
    }
    const now = nowIso();
    product.status = "retired";
    product.deletedAt = now;
    product.updatedAt = now;
    await db
      .update(t.products)
      .set({ status: "retired", deletedAt: now, updatedAt: now })
      .where(eq(t.products.id, product.id));
    return true;
  },

  createComponent: async (
    _p: unknown,
    args: {
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
    },
    ctx: Ctx,
  ) => {
    requireRole(ctx, STAFF_ROLES);
    const { input } = args;
    const fields = {
      ...input,
      name: input.name.trim(),
      model: input.model.trim(),
      manufacturer: input.manufacturer.trim(),
      serialNumber: input.serialNumber.trim().toUpperCase(),
      partNumber: input.partNumber.trim().toUpperCase(),
    };
    const error = firstError(validateComponent(fields));
    if (error) throw invalid(error);
    assertProductExists(ctx.state, fields.productId, "El equipo al que pertenece el componente no existe");
    const component = {
      id: nextId(ctx.state, "comp-", ctx.state.components),
      type: "component" as const,
      name: fields.name,
      model: fields.model,
      manufacturer: fields.manufacturer,
      serialNumber: fields.serialNumber,
      partNumber: fields.partNumber,
      isFactory: fields.isFactory,
      isWorking: fields.isWorking,
      productId: fields.productId || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
    };
    await db.insert(t.components).values(component);
    ctx.state.components.push(component);
    ctx.state.componentsById.set(component.id, component);
    const parent = component.productId ? ctx.state.productsById.get(component.productId) : undefined;
    if (parent) parent.components = [...parent.components, component];
    return component;
  },

  updateComponent: async (
    _p: unknown,
    args: { id: string; input: Partial<Record<string, unknown>> },
    ctx: Ctx,
  ) => {
    requireRole(ctx, STAFF_ROLES);
    const component = ctx.state.components.find((c) => c.id === args.id && c.deletedAt === null);
    if (!component) throw notFound("Componente no encontrado");
    const input = args.input as Partial<{
      name: string;
      model: string;
      manufacturer: string;
      serialNumber: string;
      partNumber: string;
      isFactory: boolean;
      isWorking: boolean;
    }>;
    const next = {
      name: (input.name ?? component.name).trim(),
      model: (input.model ?? component.model).trim(),
      manufacturer: (input.manufacturer ?? component.manufacturer).trim(),
      serialNumber: (input.serialNumber ?? component.serialNumber).trim().toUpperCase(),
      partNumber: (input.partNumber ?? component.partNumber).trim().toUpperCase(),
    };
    const error = firstError(validateComponent(next));
    if (error) throw invalid(error);
    Object.assign(component, next, { updatedAt: nowIso() });
    if (input.isFactory !== undefined) component.isFactory = input.isFactory;
    if (input.isWorking !== undefined) component.isWorking = input.isWorking;
    await db
      .update(t.components)
      .set({
        name: component.name,
        model: component.model,
        manufacturer: component.manufacturer,
        serialNumber: component.serialNumber,
        partNumber: component.partNumber,
        isFactory: component.isFactory,
        isWorking: component.isWorking,
        updatedAt: component.updatedAt,
      })
      .where(eq(t.components.id, component.id));
    return component;
  },

  softDeleteComponent: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    requireRole(ctx, STAFF_ROLES);
    const { state } = ctx;
    const component = state.components.find((c) => c.id === args.id && c.deletedAt === null);
    if (!component) throw notFound("Componente no encontrado");
    await syncOverdueLoans(state);
    const inOpenLoan = state.loans.some(
      (l) => IN_COURSE_LOAN_STATUSES.has(l.status) && l.components.some((c) => c.id === args.id),
    );
    if (inOpenLoan) {
      throw conflict("No se puede dar de baja: el componente está en un préstamo en curso");
    }
    const now = nowIso();
    component.deletedAt = now;
    component.updatedAt = now;
    for (const product of state.products) {
      product.components = product.components.filter((c) => c.id !== args.id);
    }
    await db
      .update(t.components)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(t.components.id, component.id));
    return true;
  },

  createTicket: async (
    _p: unknown,
    args: {
      input: { title: string; description: string; category: string; equipmentId?: string };
    },
    ctx: Ctx,
  ) => {
    const caller = requireAuth(ctx);
    const { input } = args;
    assertOneOf(input.category, TICKET_CATEGORIES, "Categoría de incidencia inválida");
    assertProductExists(ctx.state, input.equipmentId, "El equipo no existe");
    const equipment = input.equipmentId
      ? (ctx.state.products.find((p) => p.id === input.equipmentId) ?? null)
      : null;
    const ticket: Ticket = {
      id: nextId(ctx.state, "tkt-", ctx.state.tickets, 3),
      title: input.title,
      description: input.description,
      category: input.category as Ticket["category"],
      status: "pending",
      submittedBy: caller,
      assignedTo: null,
      equipmentId: input.equipmentId || null,
      equipment,
      diagnosis: null,
      corrected: null,
      actionsTaken: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      resolvedAt: null,
    };
    await db.insert(t.tickets).values({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      category: ticket.category,
      status: ticket.status,
      submittedById: ticket.submittedBy.id,
      assignedToId: null,
      equipmentId: ticket.equipmentId,
      diagnosis: null,
      corrected: null,
      actionsTaken: null,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      resolvedAt: null,
    });
    ctx.state.tickets.push(ticket);
    ctx.state.ticketsById.set(ticket.id, ticket);
    return ticket;
  },

  updateTicket: async (
    _p: unknown,
    args: { id: string; input: Partial<Record<string, unknown>> },
    ctx: Ctx,
  ) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const ticket = ctx.state.tickets.find((t) => t.id === args.id);
    if (!ticket) throw notFound("Ticket no encontrado");
    assertCanWorkOn(caller, ticket.assignedTo, "El ticket");
    const input = args.input as Partial<{
      title: string;
      description: string;
      category: string;
      equipmentId: string;
    }>;
    if (input.category !== undefined) {
      assertOneOf(input.category, TICKET_CATEGORIES, "Categoría de incidencia inválida");
    }
    if (input.equipmentId) assertProductExists(ctx.state, input.equipmentId, "El equipo no existe");
    if (input.title !== undefined) ticket.title = input.title;
    if (input.description !== undefined) ticket.description = input.description;
    if (input.category !== undefined) ticket.category = input.category as Ticket["category"];
    if (input.equipmentId !== undefined) {
      ticket.equipmentId = input.equipmentId || null;
      ticket.equipment = ctx.state.products.find((p) => p.id === input.equipmentId) ?? null;
    }
    ticket.updatedAt = nowIso();
    await db
      .update(t.tickets)
      .set({
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        equipmentId: ticket.equipmentId,
        updatedAt: ticket.updatedAt,
      })
      .where(eq(t.tickets.id, ticket.id));
    return ticket;
  },

  changeTicketStatus: async (
    _p: unknown,
    args: { id: string; status: TicketStatus },
    ctx: Ctx,
  ) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const ticket = ctx.state.tickets.find((t) => t.id === args.id);
    if (!ticket) throw notFound("Ticket no encontrado");
    assertCanWorkOn(caller, ticket.assignedTo, "El ticket");
    const { status } = args;
    if (!(status in TICKET_STATUS_CONFIG)) throw invalid("Estado inválido");
    if (status === "resolved") {
      throw invalid("Para resolver un ticket completá el diagnóstico");
    }
    if (ticket.status === "pending" || !canTransitionTicket(ticket, status)) {
      throw conflict(invalidTicketTransition(ticket, status));
    }
    if (status === "pending") {
      await handOver(ctx.state, "ticket", ticket.id, ticket.submittedBy, ticket.assignedTo, null, caller);
      ticket.assignedTo = null;
    }
    if (ticket.status === "resolved") ticket.resolvedAt = null;
    ticket.status = status;
    ticket.updatedAt = nowIso();
    if (status === "in_resolution") {
      await notify(ctx.state, ticket.submittedBy, "ticket", ticket.id, "in_resolution", caller);
    }
    await db
      .update(t.tickets)
      .set({
        status: ticket.status,
        assignedToId: ticket.assignedTo?.id ?? null,
        resolvedAt: ticket.resolvedAt,
        updatedAt: ticket.updatedAt,
      })
      .where(eq(t.tickets.id, ticket.id));
    return ticket;
  },

  completeTicket: async (
    _p: unknown,
    args: { id: string; input: { diagnosis: string; corrected: boolean; actionsTaken: string } },
    ctx: Ctx,
  ) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const ticket = ctx.state.tickets.find((t) => t.id === args.id);
    if (!ticket) throw notFound("Ticket no encontrado");
    assertCanWorkOn(caller, ticket.assignedTo, "El ticket");
    if (!canTransitionTicket(ticket, "resolved")) {
      throw conflict(invalidTicketTransition(ticket, "resolved"));
    }
    const { input } = args;
    if (!input.diagnosis?.trim() || typeof input.corrected !== "boolean") {
      throw invalid("Completá el diagnóstico y si se corrigió el problema");
    }
    ticket.status = "resolved";
    ticket.diagnosis = input.diagnosis;
    ticket.corrected = input.corrected;
    ticket.actionsTaken = input.actionsTaken;
    ticket.resolvedAt = nowIso();
    ticket.updatedAt = nowIso();
    await notify(ctx.state, ticket.submittedBy, "ticket", ticket.id, "resolved", caller);
    await db
      .update(t.tickets)
      .set({
        status: "resolved",
        diagnosis: ticket.diagnosis,
        corrected: ticket.corrected,
        actionsTaken: ticket.actionsTaken,
        resolvedAt: ticket.resolvedAt,
        updatedAt: ticket.updatedAt,
      })
      .where(eq(t.tickets.id, ticket.id));
    return ticket;
  },

  claimTicket: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const ticket = ctx.state.tickets.find((t) => t.id === args.id);
    if (!ticket) throw notFound("Ticket no encontrado");
    if (ticket.status !== "pending") throw conflict(invalidTicketTransition(ticket, "in_progress"));
    await handOver(ctx.state, "ticket", ticket.id, ticket.submittedBy, ticket.assignedTo, caller, caller);
    ticket.assignedTo = caller;
    ticket.status = "in_progress";
    ticket.updatedAt = nowIso();
    await db
      .update(t.tickets)
      .set({ assignedToId: caller.id, status: "in_progress", updatedAt: ticket.updatedAt })
      .where(eq(t.tickets.id, ticket.id));
    return ticket;
  },

  assignTicket: async (_p: unknown, args: { id: string; technicianId: string }, ctx: Ctx) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const ticket = ctx.state.tickets.find((t) => t.id === args.id);
    const tech = ctx.state.users.find((u) => u.id === args.technicianId && u.isActive);
    if (!ticket || !tech) throw notFound("No encontrado");
    assertCanWorkOn(caller, ticket.assignedTo, "El ticket");
    if (!isStaff(tech)) throw invalid("Solo se puede asignar a personal técnico");
    if (ticket.status === "resolved") throw conflict("No se puede reasignar un ticket resuelto");
    await handOver(ctx.state, "ticket", ticket.id, ticket.submittedBy, ticket.assignedTo, tech, caller);
    ticket.assignedTo = tech;
    if (ticket.status === "pending") ticket.status = "in_progress";
    ticket.updatedAt = nowIso();
    await db
      .update(t.tickets)
      .set({ assignedToId: tech.id, status: ticket.status, updatedAt: ticket.updatedAt })
      .where(eq(t.tickets.id, ticket.id));
    return ticket;
  },

  createLoan: async (
    _p: unknown,
    args: {
      input: {
        equipmentId: string;
        userId?: string;
        issueDate: string;
        returnDate: string;
        componentIds?: string[];
      };
    },
    ctx: Ctx,
  ) => {
    const caller = requireAuth(ctx);
    const { input } = args;
    const loanUserId = isStaff(caller) ? (input.userId ?? caller.id) : caller.id;
    const equipment = ctx.state.products.find((p) => p.id === input.equipmentId && p.deletedAt === null);
    const loanUser = ctx.state.users.find((u) => u.id === loanUserId && u.isActive);
    if (!equipment || !loanUser) throw notFound("Equipo o usuario no encontrado");
    if (equipment.status !== "available" || hasOpenLoan(ctx.state, equipment.id)) {
      throw conflict("El equipo no está disponible para préstamo");
    }
    if (!(new Date(input.returnDate) > new Date(input.issueDate))) {
      throw invalid("La fecha de devolución debe ser posterior a la de entrega");
    }
    const components = input.componentIds
      ? ctx.state.components.filter((c) => input.componentIds!.includes(c.id))
      : [];
    const loan: Loan = {
      id: nextId(ctx.state, "loan-", ctx.state.loans, 3),
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
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.insert(t.loans).values({
      id: loan.id,
      equipmentId: equipment.id,
      userId: loanUser.id,
      status: loan.status,
      approvedById: null,
      deliveredById: null,
      deliveredAt: null,
      issueDate: loan.issueDate,
      returnDate: loan.returnDate,
      actualReturnDate: null,
      rejectionReason: null,
      createdAt: loan.createdAt,
      updatedAt: loan.updatedAt,
    });
    if (components.length > 0) {
      await db
        .insert(t.loanComponents)
        .values(components.map((c) => ({ loanId: loan.id, componentId: c.id })));
    }
    ctx.state.loans.push(loan);
    ctx.state.loansById.set(loan.id, loan);
    return loan;
  },

  approveLoan: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const loan = ctx.state.loans.find((l) => l.id === args.id);
    if (!loan) throw notFound("Préstamo no encontrado");
    if (loan.status !== "pending") throw conflict(invalidLoanTransition(loan, "aprobar"));
    if (hasOpenLoan(ctx.state, loan.equipment.id, loan.id)) {
      throw conflict("El equipo ya está comprometido en otro préstamo");
    }
    loan.status = "approved";
    loan.approvedBy = caller;
    loan.updatedAt = nowIso();
    await notify(ctx.state, loan.user, "loan", loan.id, "approved", caller);
    await db
      .update(t.loans)
      .set({ status: "approved", approvedById: caller.id, updatedAt: loan.updatedAt })
      .where(eq(t.loans.id, loan.id));
    return loan;
  },

  rejectLoan: async (_p: unknown, args: { id: string; reason: string }, ctx: Ctx) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const loan = ctx.state.loans.find((l) => l.id === args.id);
    if (!loan) throw notFound("Préstamo no encontrado");
    if (loan.status !== "pending") throw conflict(invalidLoanTransition(loan, "rechazar"));
    if (!args.reason?.trim()) throw invalid("Indicá el motivo del rechazo");
    loan.status = "rejected";
    loan.rejectionReason = args.reason.trim();
    loan.updatedAt = nowIso();
    await notify(ctx.state, loan.user, "loan", loan.id, "rejected", caller);
    await db
      .update(t.loans)
      .set({ status: "rejected", rejectionReason: loan.rejectionReason, updatedAt: loan.updatedAt })
      .where(eq(t.loans.id, loan.id));
    return loan;
  },

  deliverLoan: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const loan = ctx.state.loans.find((l) => l.id === args.id);
    if (!loan) throw notFound("Préstamo no encontrado");
    if (loan.status !== "approved") throw conflict(invalidLoanTransition(loan, "entregar"));
    if (loan.equipment.status !== "available") {
      throw conflict("El equipo no está disponible para entregar");
    }
    const now = nowIso();
    loan.status = "active";
    loan.deliveredBy = caller;
    loan.deliveredAt = now;
    loan.updatedAt = now;
    loan.equipment.status = "in_use";
    loan.equipment.updatedAt = now;
    await notify(ctx.state, loan.user, "loan", loan.id, "delivered", caller);
    await db
      .update(t.loans)
      .set({ status: "active", deliveredById: caller.id, deliveredAt: now, updatedAt: now })
      .where(eq(t.loans.id, loan.id));
    await db
      .update(t.products)
      .set({ status: "in_use", updatedAt: now })
      .where(eq(t.products.id, loan.equipment.id));
    return loan;
  },

  returnLoan: async (
    _p: unknown,
    args: { id: string; damaged?: boolean; issues?: string },
    ctx: Ctx,
  ) => {
    requireRole(ctx, STAFF_ROLES);
    const loan = ctx.state.loans.find((l) => l.id === args.id);
    if (!loan) throw notFound("Préstamo no encontrado");
    if (loan.status !== "active" && loan.status !== "overdue") {
      throw conflict(invalidLoanTransition(loan, "devolver"));
    }
    const now = nowIso();
    loan.status = "returned";
    loan.actualReturnDate = now;
    loan.updatedAt = now;
    loan.equipment.status = args.damaged ? "in_repair" : "available";
    if (args.damaged && args.issues?.trim()) loan.equipment.issues = args.issues.trim();
    loan.equipment.updatedAt = now;
    await dropNotices(ctx.state, "loan", loan.id, "overdue");
    await db
      .update(t.loans)
      .set({ status: "returned", actualReturnDate: now, updatedAt: now })
      .where(eq(t.loans.id, loan.id));
    await db
      .update(t.products)
      .set({ status: loan.equipment.status, issues: loan.equipment.issues, updatedAt: now })
      .where(eq(t.products.id, loan.equipment.id));
    return loan;
  },

  createServiceRequest: async (
    _p: unknown,
    args: {
      input: {
        type: string;
        description: string;
        labNumber?: string;
        softwareName?: string;
        equipmentId?: string;
      };
    },
    ctx: Ctx,
  ) => {
    const caller = requireAuth(ctx);
    const { input } = args;
    assertOneOf(input.type, SERVICE_TYPES, "Tipo de solicitud inválido");
    assertProductExists(ctx.state, input.equipmentId, "El equipo no existe");
    const service: ServiceRequest = {
      id: nextId(ctx.state, "svc-", ctx.state.services, 3),
      type: input.type as ServiceRequest["type"],
      status: "pending",
      requestedBy: caller,
      assignedTo: null,
      description: input.description,
      labNumber: input.labNumber ?? null,
      softwareName: input.softwareName ?? null,
      equipmentId: input.equipmentId || null,
      resolutionText: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.insert(t.serviceRequests).values({
      id: service.id,
      type: service.type,
      status: service.status,
      requestedById: caller.id,
      assignedToId: null,
      description: service.description,
      labNumber: service.labNumber,
      softwareName: service.softwareName,
      equipmentId: service.equipmentId,
      resolutionText: null,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    });
    ctx.state.services.push(service);
    ctx.state.servicesById.set(service.id, service);
    return service;
  },

  updateServiceRequest: async (
    _p: unknown,
    args: { id: string; input: { status?: string; resolutionText?: string } },
    ctx: Ctx,
  ) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const service = ctx.state.services.find((s) => s.id === args.id);
    if (!service) throw notFound("Solicitud no encontrada");
    assertCanWorkOn(caller, service.assignedTo, "La solicitud");
    const { input } = args;
    const previousStatus = service.status;
    if (input.status) assertOneOf(input.status, SERVICE_STATUSES, "Estado de solicitud inválido");
    if (input.status) service.status = input.status as ServiceRequest["status"];
    if (!service.assignedTo && (input.status === "in_progress" || input.status === "completed")) {
      await handOver(ctx.state, "service_request", service.id, service.requestedBy, null, caller, caller);
      service.assignedTo = caller;
    }
    if (input.resolutionText !== undefined) service.resolutionText = input.resolutionText;
    service.updatedAt = nowIso();
    if (service.status !== previousStatus && Object.hasOwn(SERVICE_RESPONSE_NOTICES, service.status)) {
      const kind = SERVICE_RESPONSE_NOTICES[service.status as keyof typeof SERVICE_RESPONSE_NOTICES];
      await notify(ctx.state, service.requestedBy, "service_request", service.id, kind, caller);
    }
    await db
      .update(t.serviceRequests)
      .set({
        status: service.status,
        assignedToId: service.assignedTo?.id ?? null,
        resolutionText: service.resolutionText,
        updatedAt: service.updatedAt,
      })
      .where(eq(t.serviceRequests.id, service.id));
    return service;
  },

  claimServiceRequest: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const service = ctx.state.services.find((s) => s.id === args.id);
    if (!service) throw notFound("Solicitud no encontrada");
    if (CLOSED_SERVICE_STATUSES.has(service.status)) throw conflict("La solicitud ya está cerrada");
    if (service.assignedTo) throw conflict(`La solicitud ya la tomó ${service.assignedTo.name}`);
    await handOver(ctx.state, "service_request", service.id, service.requestedBy, null, caller, caller);
    service.assignedTo = caller;
    service.updatedAt = nowIso();
    await db
      .update(t.serviceRequests)
      .set({ assignedToId: caller.id, updatedAt: service.updatedAt })
      .where(eq(t.serviceRequests.id, service.id));
    return service;
  },

  assignServiceRequest: async (
    _p: unknown,
    args: { id: string; technicianId: string },
    ctx: Ctx,
  ) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const service = ctx.state.services.find((s) => s.id === args.id);
    const tech = ctx.state.users.find((u) => u.id === args.technicianId && u.isActive);
    if (!service || !tech) throw notFound("No encontrado");
    assertCanWorkOn(caller, service.assignedTo, "La solicitud");
    if (!isStaff(tech)) throw invalid("Solo se puede asignar a personal técnico");
    if (CLOSED_SERVICE_STATUSES.has(service.status)) throw conflict("La solicitud ya está cerrada");
    await handOver(ctx.state, "service_request", service.id, service.requestedBy, service.assignedTo, tech, caller);
    service.assignedTo = tech;
    service.updatedAt = nowIso();
    await db
      .update(t.serviceRequests)
      .set({ assignedToId: tech.id, updatedAt: service.updatedAt })
      .where(eq(t.serviceRequests.id, service.id));
    return service;
  },

  softDeleteTicket: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    const { state } = ctx;
    const ticket = state.tickets.find((t) => t.id === args.id);
    if (!ticket) throw notFound("Ticket no encontrado");
    const unclaimed = ticket.status === "pending" && !ticket.assignedTo;
    if (!canRetire(caller, ticket.submittedBy.id, unclaimed)) throw forbidden();
    const now = nowIso();
    await db
      .update(t.tickets)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(t.tickets.id, ticket.id));
    await dropNoticesOf(state, "ticket", ticket.id);
    state.tickets = removeFrom(state.tickets, state.ticketsById, ticket.id);
    state.deletedIds.add(ticket.id);
    return true;
  },

  softDeleteLoan: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    const { state } = ctx;
    await syncOverdueLoans(state);
    const loan = state.loans.find((l) => l.id === args.id);
    if (!loan) throw notFound("Préstamo no encontrado");
    if (!canRetire(caller, loan.user.id, loan.status === "pending")) throw forbidden();
    if (loan.status === "active" || loan.status === "overdue") {
      throw conflict("No se puede dar de baja un préstamo en curso: registrá la devolución primero");
    }
    const now = nowIso();
    await db
      .update(t.loans)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(t.loans.id, loan.id));
    await dropNoticesOf(state, "loan", loan.id);
    state.loans = removeFrom(state.loans, state.loansById, loan.id);
    state.deletedIds.add(loan.id);
    return true;
  },

  softDeleteServiceRequest: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    const { state } = ctx;
    const service = state.services.find((s) => s.id === args.id);
    if (!service) throw notFound("Solicitud no encontrada");
    const unclaimed = service.status === "pending" && !service.assignedTo;
    if (!canRetire(caller, service.requestedBy.id, unclaimed)) throw forbidden();
    if (service.status === "in_progress") {
      throw conflict("No se puede dar de baja una solicitud en curso");
    }
    const now = nowIso();
    await db
      .update(t.serviceRequests)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(t.serviceRequests.id, service.id));
    await dropNoticesOf(state, "service_request", service.id);
    state.services = removeFrom(state.services, state.servicesById, service.id);
    state.deletedIds.add(service.id);
    return true;
  },

  softDeleteIntervention: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const { state } = ctx;
    const intervention = state.interventions.find((i) => i.id === args.id);
    if (!intervention) throw notFound("Intervención no encontrada");
    if (!canRetire(caller, intervention.technician.id, true)) throw forbidden();
    const now = nowIso();
    await db
      .update(t.interventions)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(t.interventions.id, intervention.id));
    state.interventions = removeFrom(state.interventions, state.interventionsById, intervention.id);
    state.deletedIds.add(intervention.id);
    return true;
  },

  softDeleteComment: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    const { state } = ctx;
    const comment = state.comments.find((c) => c.id === args.id);
    if (!comment) throw notFound("Comentario no encontrado");
    assertCommentAccess(state, caller, comment.entityType, comment.entityId);
    if (!canRetire(caller, comment.author.id, true)) throw forbidden();
    await db
      .update(t.comments)
      .set({ deletedAt: nowIso() })
      .where(eq(t.comments.id, comment.id));
    state.comments = removeFrom(state.comments, state.commentsById, comment.id);
    state.deletedIds.add(comment.id);
    return true;
  },

  logout: async (_p: unknown, _a: unknown, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    if (ctx.token) await revokeToken(ctx.token, caller.id);
    return true;
  },

  changePassword: async (
    _p: unknown,
    args: { currentPassword: string; newPassword: string },
    ctx: Ctx,
  ) => {
    const caller = requireAuth(ctx);
    const [row] = await db.select().from(t.users).where(eq(t.users.id, caller.id)).limit(1);
    if (!row) throw notFound("Usuario no encontrado");
    const ok = await Bun.password.verify(args.currentPassword, row.passwordHash);
    if (!ok) throw invalid("La contraseña actual no es correcta");
    const passwordHash = await Bun.password.hash(args.newPassword, { algorithm: "argon2id" });
    await db
      .update(t.users)
      .set({ passwordHash, updatedAt: nowIso() })
      .where(eq(t.users.id, caller.id));
    return true;
  },

  createLocation: async (_p: unknown, args: { input: LocationFields }, ctx: Ctx) => {
    requireRole(ctx, STAFF_ROLES);
    const fields = {
      kind: args.input.kind,
      number: Number(args.input.number),
      name: args.input.name.trim(),
    };
    const code = locationCode(fields.kind, fields.number);
    assertRules(firstError(validateLocation(fields)));
    if (!code) throw invalid("Ubicación inválida");
    assertRules(null, () => duplicateLocationError(ctx.state, { ...fields, code }));
    const now = nowIso();
    const location: Location = {
      id: nextId(ctx.state, "loc-", ctx.state.locations),
      kind: fields.kind as Location["kind"],
      number: fields.number,
      name: fields.name,
      code,
      productCount: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await db.insert(t.locations).values({
      id: location.id,
      kind: location.kind,
      number: location.number,
      name: location.name,
      code: location.code,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    ctx.state.locations.push(location);
    ctx.state.locationsById.set(location.id, location);
    return location;
  },

  updateLocation: async (
    _p: unknown,
    args: { id: string; input: Partial<LocationFields> },
    ctx: Ctx,
  ) => {
    requireRole(ctx, STAFF_ROLES);
    const location = activeLocation(ctx.state, args.id);
    if (!location) throw notFound("Ubicación no encontrada");
    const input = args.input;
    const fields = {
      kind: input.kind ?? location.kind,
      number: input.number !== undefined ? Number(input.number) : location.number,
      name: (input.name ?? location.name).trim(),
    };
    const code = locationCode(fields.kind, fields.number);
    assertRules(firstError(validateLocation(fields)));
    if (!code) throw invalid("Ubicación inválida");
    assertRules(null, () => duplicateLocationError(ctx.state, { ...fields, code }, args.id));
    const products = productsIn(ctx.state, args.id);
    if (code !== location.code && products.length > 0) {
      throw conflict(
        `No se puede cambiar el tipo ni el número: ${products.length} equipo(s) usan ${location.code} en su ID de máquina`,
      );
    }
    Object.assign(location, {
      kind: fields.kind as Location["kind"],
      number: fields.number,
      name: fields.name,
      code,
      updatedAt: nowIso(),
    });
    for (const p of products) p.location = location.name;
    await db
      .update(t.locations)
      .set({
        kind: location.kind,
        number: location.number,
        name: location.name,
        code: location.code,
        updatedAt: location.updatedAt,
      })
      .where(eq(t.locations.id, location.id));
    if (products.length > 0) {
      await db
        .update(t.products)
        .set({ location: location.name })
        .where(eq(t.products.locationId, location.id));
    }
    return withProductCount(ctx.state, location);
  },

  softDeleteLocation: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    requireRole(ctx, STAFF_ROLES);
    const location = activeLocation(ctx.state, args.id);
    if (!location) throw notFound("Ubicación no encontrada");
    await syncReservations(ctx.state);
    if (
      ctx.state.reservations.some(
        (r) => r.location?.id === args.id && OPEN_RESERVATION_STATUSES.has(r.status),
      )
    ) {
      throw conflict("No se puede eliminar: la ubicación tiene reservas vigentes");
    }
    const count = productsIn(ctx.state, args.id).length;
    if (count > 0) {
      throw conflict(`No se puede eliminar: tiene ${count} equipo(s). Movelos a otra ubicación primero`);
    }
    location.deletedAt = nowIso();
    await db
      .update(t.locations)
      .set({ deletedAt: location.deletedAt })
      .where(eq(t.locations.id, location.id));
    return true;
  },

  createIntervention: async (
    _p: unknown,
    args: {
      input: Partial<InterventionFields> & { equipmentId: string; ticketId?: string | null };
    },
    ctx: Ctx,
  ) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const { input } = args;
    const product = ctx.state.products.find((p) => p.id === input.equipmentId);
    if (!product) throw notFound("Equipo no encontrado");
    if (product.deletedAt) {
      throw conflict("No se registran intervenciones en un equipo dado de baja");
    }
    const now = nowIso();
    const fields: InterventionFields = {
      type: input.type ?? "",
      description: (input.description ?? "").trim(),
      partsReplaced: input.partsReplaced?.trim() || null,
      performedAt: input.performedAt ?? now,
    };
    const ticketId = input.ticketId || null;
    const error =
      firstError(validateIntervention(fields)) ??
      interventionTicketError(ctx.state, ticketId, product.id);
    if (error) throw invalid(error);
    const intervention = {
      id: nextId(ctx.state, "int-", ctx.state.interventions, 3),
      equipmentId: product.id,
      technician: caller,
      type: fields.type as (typeof ctx.state.interventions)[number]["type"],
      description: fields.description,
      partsReplaced: fields.partsReplaced,
      performedAt: new Date(fields.performedAt).toISOString(),
      ticketId,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(t.interventions).values({
      id: intervention.id,
      equipmentId: intervention.equipmentId,
      technicianId: caller.id,
      type: intervention.type,
      description: intervention.description,
      partsReplaced: intervention.partsReplaced,
      ticketId: intervention.ticketId,
      performedAt: intervention.performedAt,
      createdAt: now,
      updatedAt: now,
    });
    ctx.state.interventions.push(intervention);
    ctx.state.interventionsById.set(intervention.id, intervention);
    return intervention;
  },

  updateIntervention: async (
    _p: unknown,
    args: { id: string; input: Partial<InterventionFields> & { ticketId?: string | null } },
    ctx: Ctx,
  ) => {
    requireRole(ctx, STAFF_ROLES);
    const intervention = ctx.state.interventions.find((i) => i.id === args.id);
    if (!intervention) throw notFound("Intervención no encontrada");
    const input = args.input;
    const fields: InterventionFields = {
      type: input.type ?? intervention.type,
      description: (input.description ?? intervention.description).trim(),
      partsReplaced:
        input.partsReplaced !== undefined
          ? input.partsReplaced?.trim() || null
          : intervention.partsReplaced,
      performedAt: input.performedAt ?? intervention.performedAt,
    };
    const ticketId =
      input.ticketId !== undefined ? input.ticketId || null : intervention.ticketId;
    const error =
      firstError(validateIntervention(fields)) ??
      interventionTicketError(ctx.state, ticketId, intervention.equipmentId);
    if (error) throw invalid(error);
    Object.assign(intervention, {
      type: fields.type as (typeof intervention)["type"],
      description: fields.description,
      partsReplaced: fields.partsReplaced,
      performedAt: new Date(fields.performedAt).toISOString(),
      ticketId,
      updatedAt: nowIso(),
    });
    await db
      .update(t.interventions)
      .set({
        type: intervention.type,
        description: intervention.description,
        partsReplaced: intervention.partsReplaced,
        performedAt: intervention.performedAt,
        ticketId: intervention.ticketId,
        updatedAt: intervention.updatedAt,
      })
      .where(eq(t.interventions.id, intervention.id));
    return intervention;
  },

  createComment: async (
    _p: unknown,
    args: { input: { entityType: string; entityId: string; body: string } },
    ctx: Ctx,
  ) => {
    const caller = requireAuth(ctx);
    const { input } = args;
    const entityType = input.entityType as CommentEntity;
    assertCommentAccess(ctx.state, caller, entityType, input.entityId);
    const error = validateComment(input.body);
    if (error) throw invalid(error);
    const comment: Comment = {
      id: nextId(ctx.state, "cmt-", ctx.state.comments, 3),
      entityType,
      entityId: input.entityId,
      author: caller,
      body: input.body.trim(),
      createdAt: nowIso(),
    };
    await db.insert(t.comments).values({
      id: comment.id,
      entityType: comment.entityType,
      entityId: comment.entityId,
      authorId: caller.id,
      body: comment.body,
      createdAt: comment.createdAt,
    });
    ctx.state.comments.push(comment);
    ctx.state.commentsById.set(comment.id, comment);
    for (const participant of threadParticipants(ctx.state, entityType, input.entityId)) {
      await notify(ctx.state, participant, entityType, input.entityId, "comment", caller);
    }
    return comment;
  },

  createReservation: async (
    _p: unknown,
    args: {
      input: {
        resourceType: ReservationResource;
        equipmentId?: string;
        locationId?: string;
        startsAt: string;
        endsAt: string;
        purpose: string;
      };
    },
    ctx: Ctx,
  ) => {
    const caller = requireAuth(ctx);
    await syncReservations(ctx.state);
    const { input } = args;
    let equipment: Product | null = null;
    let location: Location | null = null;
    if (input.resourceType === "equipment") {
      equipment = ctx.state.products.find((p) => p.id === input.equipmentId && !p.deletedAt) ?? null;
      if (!equipment) throw notFound("Equipo no encontrado");
      if (equipment.status === "in_repair") throw conflict("El equipo está en reparación: no se puede reservar");
      if (equipment.status === "retired") throw conflict("El equipo está dado de baja: no se puede reservar");
    } else if (input.resourceType === "location") {
      location = activeLocation(ctx.state, input.locationId) ?? null;
      if (!location) throw notFound("Ubicación no encontrada");
    } else {
      throw invalid("Elegí un equipo o un espacio");
    }
    const fields = { startsAt: input.startsAt, endsAt: input.endsAt, purpose: input.purpose };
    const resourceId = (equipment ?? location)!.id;
    assertRules(firstError(validateReservation(fields)), () =>
      reservationOverlapError(ctx.state, input.resourceType, resourceId, fields.startsAt, fields.endsAt),
    );
    const now = nowIso();
    const reservation: Reservation = {
      id: nextId(ctx.state, "rsv-", ctx.state.reservations, 3),
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
    await db.insert(t.reservations).values({
      id: reservation.id,
      resourceType: reservation.resourceType,
      equipmentId: equipment?.id ?? null,
      locationId: location?.id ?? null,
      userId: caller.id,
      purpose: reservation.purpose,
      startsAt: reservation.startsAt,
      endsAt: reservation.endsAt,
      status: reservation.status,
      reviewedById: null,
      rejectionReason: null,
      cancelledById: null,
      createdAt: now,
      updatedAt: now,
    });
    ctx.state.reservations.push(reservation);
    ctx.state.reservationsById.set(reservation.id, reservation);
    return reservation;
  },

  approveReservation: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    await syncReservations(ctx.state);
    const reservation = ctx.state.reservations.find((r) => r.id === args.id);
    if (!reservation) throw notFound("Reserva no encontrada");
    if (reservation.status !== "pending") {
      throw conflict(invalidReservationTransition(reservation, "aprobar"));
    }
    if (Date.parse(reservation.endsAt) <= Date.now()) {
      throw conflict("La reserva ya terminó: no se puede aprobar");
    }
    const overlap = reservationOverlapError(
      ctx.state,
      reservation.resourceType,
      reservationResourceId(reservation)!,
      reservation.startsAt,
      reservation.endsAt,
      reservation.id,
    );
    if (overlap) throw conflict(overlap);
    reservation.status = "approved";
    reservation.reviewedBy = caller;
    reservation.updatedAt = nowIso();
    await syncReservations(ctx.state);
    await notify(ctx.state, reservation.user, "reservation", reservation.id, "approved", caller);
    await db
      .update(t.reservations)
      .set({ status: reservation.status, reviewedById: caller.id, updatedAt: reservation.updatedAt })
      .where(eq(t.reservations.id, reservation.id));
    return reservation;
  },

  rejectReservation: async (
    _p: unknown,
    args: { id: string; reason: string },
    ctx: Ctx,
  ) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    await syncReservations(ctx.state);
    const reservation = ctx.state.reservations.find((r) => r.id === args.id);
    if (!reservation) throw notFound("Reserva no encontrada");
    if (reservation.status !== "pending") {
      throw conflict(invalidReservationTransition(reservation, "rechazar"));
    }
    if ((args.reason ?? "").trim().length < 5) {
      throw invalid("Indicá el motivo del rechazo (mínimo 5 caracteres)");
    }
    reservation.status = "rejected";
    reservation.reviewedBy = caller;
    reservation.rejectionReason = args.reason.trim();
    reservation.updatedAt = nowIso();
    await notify(ctx.state, reservation.user, "reservation", reservation.id, "rejected", caller);
    await db
      .update(t.reservations)
      .set({
        status: reservation.status,
        reviewedById: caller.id,
        rejectionReason: reservation.rejectionReason,
        updatedAt: reservation.updatedAt,
      })
      .where(eq(t.reservations.id, reservation.id));
    return reservation;
  },

  updateReservation: async (
    _p: unknown,
    args: { id: string; input: Partial<{ startsAt: string; endsAt: string; purpose: string }> },
    ctx: Ctx,
  ) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    await syncReservations(ctx.state);
    const reservation = ctx.state.reservations.find((r) => r.id === args.id);
    if (!reservation) throw notFound("Reserva no encontrada");
    if (reservation.status !== "pending" && reservation.status !== "approved") {
      throw conflict(invalidReservationTransition(reservation, "modificar"));
    }
    const input = args.input;
    const fields = {
      startsAt: input.startsAt ?? reservation.startsAt,
      endsAt: input.endsAt ?? reservation.endsAt,
      purpose: input.purpose ?? reservation.purpose,
    };
    assertRules(firstError(validateReservation(fields)), () =>
      reservationOverlapError(
        ctx.state,
        reservation.resourceType,
        reservationResourceId(reservation)!,
        fields.startsAt,
        fields.endsAt,
        reservation.id,
      ),
    );
    Object.assign(reservation, {
      startsAt: new Date(fields.startsAt).toISOString(),
      endsAt: new Date(fields.endsAt).toISOString(),
      purpose: fields.purpose.trim(),
      updatedAt: nowIso(),
    });
    await syncReservations(ctx.state);
    await notify(ctx.state, reservation.user, "reservation", reservation.id, "modified", caller);
    await db
      .update(t.reservations)
      .set({
        startsAt: reservation.startsAt,
        endsAt: reservation.endsAt,
        purpose: reservation.purpose,
        updatedAt: reservation.updatedAt,
      })
      .where(eq(t.reservations.id, reservation.id));
    return reservation;
  },

  cancelReservation: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    await syncReservations(ctx.state);
    const reservation = ctx.state.reservations.find((r) => r.id === args.id);
    if (!reservation) throw notFound("Reserva no encontrada");
    if (reservation.user.id !== caller.id) throw forbidden();
    if (reservation.status !== "pending" && reservation.status !== "approved") {
      throw conflict(invalidReservationTransition(reservation, "cancelar"));
    }
    reservation.status = "cancelled";
    reservation.cancelledBy = caller;
    reservation.updatedAt = nowIso();
    await notify(ctx.state, reservation.reviewedBy, "reservation", reservation.id, "cancelled", caller);
    await db
      .update(t.reservations)
      .set({ status: "cancelled", cancelledById: caller.id, updatedAt: reservation.updatedAt })
      .where(eq(t.reservations.id, reservation.id));
    return reservation;
  },

  acknowledgeNotice: async (_p: unknown, args: { id: string }, ctx: Ctx) => {
    const caller = requireAuth(ctx);
    const notice = ctx.state.notices.find((n) => n.id === args.id);
    if (!notice) throw notFound("Aviso no encontrado");
    if (notice.userId !== caller.id) throw forbidden();
    await db.delete(t.notices).where(eq(t.notices.id, notice.id));
    ctx.state.notices = ctx.state.notices.filter((n) => n.id !== notice.id);
    ctx.state.noticesById.delete(notice.id);
    return true;
  },

  markPendingSeen: async (_p: unknown, args: { section: NoticeEntity }, ctx: Ctx) => {
    const caller = requireRole(ctx, STAFF_ROLES);
    const { section } = args;
    if (!PENDING_SECTIONS.includes(section)) throw invalid("Sección inválida");
    const seenAt = nowIso();
    const seen = ctx.state.pendingSeen.find((s) => s.userId === caller.id && s.section === section);
    if (seen) {
      seen.seenAt = seenAt;
      await db
        .update(t.pendingSeen)
        .set({ seenAt })
        .where(and(eq(t.pendingSeen.userId, caller.id), eq(t.pendingSeen.section, section)));
    } else {
      ctx.state.pendingSeen.push({ userId: caller.id, section, seenAt });
      await db.insert(t.pendingSeen).values({ userId: caller.id, section, seenAt });
    }
    return true;
  },
};

// Que entidad y que dato deja cada mutacion en `activity_logs`. Al estar tipado
// por `keyof typeof Mutation`, agregar una mutacion sin su fila de auditoria no
// compila.
const reason = (args: { reason?: string }) => (args.reason ? `Motivo: ${args.reason.trim()}` : null);

const AUDIT: Record<keyof typeof Mutation, AuditSpec> = {
  createUser: { entity: "User" },
  updateUser: { entity: "User" },
  deleteUser: { entity: "User", details: () => "Baja lógica (is_active = false)" },
  createProduct: { entity: "Product" },
  updateProduct: { entity: "Product" },
  softDeleteProduct: { entity: "Product", details: () => "Baja lógica (deleted_at)" },
  createComponent: { entity: "Component" },
  updateComponent: { entity: "Component" },
  softDeleteComponent: { entity: "Component", details: () => "Baja lógica (deleted_at)" },
  createTicket: { entity: "Ticket" },
  updateTicket: { entity: "Ticket" },
  assignTicket: { entity: "Ticket", details: (a) => `Asignado a ${a.technicianId}` },
  claimTicket: { entity: "Ticket" },
  completeTicket: { entity: "Ticket", details: (a) => `Corregido: ${a.input.corrected ? "sí" : "no"}` },
  changeTicketStatus: { entity: "Ticket", details: (a) => `Estado: ${a.status}` },
  createLoan: { entity: "Loan", details: (a) => `Equipo ${a.input.equipmentId}` },
  approveLoan: { entity: "Loan" },
  rejectLoan: { entity: "Loan", details: reason },
  deliverLoan: { entity: "Loan" },
  returnLoan: { entity: "Loan", details: (a) => (a.damaged ? "Devuelto con daños" : "Devuelto sin daños") },
  createServiceRequest: { entity: "ServiceRequest" },
  updateServiceRequest: { entity: "ServiceRequest" },
  claimServiceRequest: { entity: "ServiceRequest" },
  assignServiceRequest: { entity: "ServiceRequest", details: (a) => `Asignado a ${a.technicianId}` },
  softDeleteTicket: { entity: "Ticket", details: () => "Baja lógica (deleted_at)" },
  softDeleteLoan: { entity: "Loan", details: () => "Baja lógica (deleted_at)" },
  softDeleteServiceRequest: { entity: "ServiceRequest", details: () => "Baja lógica (deleted_at)" },
  softDeleteIntervention: { entity: "Intervention", details: () => "Baja lógica (deleted_at)" },
  softDeleteComment: { entity: "Comment", details: () => "Baja lógica (deleted_at)" },
  logout: { entity: "Session", id: (_a, _r, ctx) => ctx.caller?.id ?? "-", details: () => null },
  changePassword: { entity: "User", id: (_a, _r, ctx) => ctx.caller?.id ?? "-", details: () => null },
  createLocation: { entity: "Location" },
  updateLocation: { entity: "Location" },
  softDeleteLocation: { entity: "Location", details: () => "Baja lógica (deleted_at)" },
  createIntervention: { entity: "Intervention" },
  updateIntervention: { entity: "Intervention" },
  createComment: { entity: "Comment", details: (a) => `En ${a.input.entityType} ${a.input.entityId}` },
  createReservation: { entity: "Reservation" },
  approveReservation: { entity: "Reservation" },
  rejectReservation: { entity: "Reservation", details: reason },
  updateReservation: { entity: "Reservation" },
  cancelReservation: { entity: "Reservation" },
  acknowledgeNotice: { entity: "Notice" },
  markPendingSeen: { entity: "PendingSeen", id: (a) => a.section, details: () => null },
};

// `login` y `me` no necesitan la foto de la base; `activityLogs` consulta la
// tabla directo. Las demas queries cargan el estado una vez por request.
const STATELESS_QUERIES = new Set<keyof typeof Query>(["login", "me", "activityLogs"]);

function entries<T extends object>(source: T): Array<[keyof T & string, Resolver]> {
  return Object.entries(source) as Array<[keyof T & string, Resolver]>;
}

export const resolvers = {
  User: userFieldResolvers,
  Query: Object.fromEntries(
    entries(Query).map(([name, fn]) => [
      name,
      STATELESS_QUERIES.has(name) ? fn : withState(fn),
    ]),
  ),
  Mutation: Object.fromEntries(
    entries(Mutation).map(([name, fn]) => [name, withTransaction(name, fn, AUDIT[name])]),
  ),
};
