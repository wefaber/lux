import type { User } from "@/lib/types";
import type { Ctx } from "../context";
import type { State } from "../state";

// Datos de contacto (dni, email) de un usuario. Protocolo 8.1: el administrador
// los ve todos; el tecnico solo los de las personas con las que trabaja (quien
// pidio un ticket o una solicitud que tiene asignados, o un prestamo que entrego
// o aprobo); todos ven los propios. El resto de los campos (nombre, rol) es
// visible para quien ya puede leer al usuario. Cuando no corresponde se devuelve
// null, asi la pantalla sigue funcionando y solo pierde ese dato.

const ADMIN_ROLES = new Set(["root_admin", "admin"]);

// Una vez por request y por tecnico: ids de las personas relacionadas con su trabajo
const relatedCache = new WeakMap<State, Map<string, Set<string>>>();

export function relatedUserIds(state: State, technicianId: string): Set<string> {
  let byTech = relatedCache.get(state);
  if (!byTech) {
    byTech = new Map();
    relatedCache.set(state, byTech);
  }
  const cached = byTech.get(technicianId);
  if (cached) return cached;
  const ids = new Set<string>();
  for (const ticket of state.tickets) {
    if (ticket.assignedTo?.id === technicianId) ids.add(ticket.submittedBy.id);
  }
  for (const loan of state.loans) {
    if (loan.deliveredBy?.id === technicianId || loan.approvedBy?.id === technicianId) ids.add(loan.user.id);
  }
  for (const request of state.services) {
    if (request.assignedTo?.id === technicianId) ids.add(request.requestedBy.id);
  }
  byTech.set(technicianId, ids);
  return ids;
}

export function canSeeContact(ctx: Ctx, target: Pick<User, "id">): boolean {
  const caller = ctx.caller;
  if (!caller) return false;
  if (caller.id === target.id) return true;
  if (ADMIN_ROLES.has(caller.role)) return true;
  if (caller.role === "tecnico" && ctx.state) return relatedUserIds(ctx.state, caller.id).has(target.id);
  return false;
}

export const userFieldResolvers = {
  dni: (user: User, _args: unknown, ctx: Ctx) => (canSeeContact(ctx, user) ? user.dni : null),
  email: (user: User, _args: unknown, ctx: Ctx) => (canSeeContact(ctx, user) ? user.email : null),
};
