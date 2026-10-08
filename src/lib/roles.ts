import type { UserRole } from "./types";

// Quien es "personal del area" se decide solo aca.
// Sirve para DIBUJAR la interfaz;
// quien autoriza de verdad es la API, que vuelve a comprobar el rol.

/** Personal del area: ve y opera todo el trabajo del sistema. */
export const STAFF_ROLES: UserRole[] = ["root_admin", "admin", "tecnico"];

export function isStaff(role: UserRole | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}
