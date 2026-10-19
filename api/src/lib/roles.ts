import type { User, UserRole } from "./types";

// Quien es "personal del area" o "administrador" se decide solo aca. Lo usan la
// interfaz (para dibujar) y la API de prueba (para autorizar), asi no divergen.

/** Todos los roles, de mayor a menor jerarquia. */
export const USER_ROLES: UserRole[] = ["root_admin", "admin", "tecnico", "solicitante"];

/** Personal del area: ve y opera todo el trabajo del sistema. */
export const STAFF_ROLES: UserRole[] = ["root_admin", "admin", "tecnico"];

/** Administradores: gestionan usuarios, ven logs y reportes. */
export const ADMIN_ROLES: UserRole[] = ["root_admin", "admin"];

/** Roles que se pueden dar desde la gestion de usuarios: root_admin es unico. */
export const ASSIGNABLE_ROLES: UserRole[] = USER_ROLES.filter((r) => r !== "root_admin");

export function isStaff(role: UserRole | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

export function isAdmin(role: UserRole | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

/** Solo el root_admin edita al root_admin; el resto de los usuarios, cualquier admin. */
export function canEditUser(actor: Pick<User, "role"> | null, target: Pick<User, "role">): boolean {
  if (!actor || !isAdmin(actor.role)) return false;
  return target.role !== "root_admin" || actor.role === "root_admin";
}

/** El root_admin no se desactiva, y nadie se desactiva a si mismo (se quedaria afuera). */
export function canToggleUserActive(
  actor: Pick<User, "id" | "role"> | null,
  target: Pick<User, "id" | "role">,
): boolean {
  return canEditUser(actor, target) && target.role !== "root_admin" && actor!.id !== target.id;
}
