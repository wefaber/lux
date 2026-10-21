import { db } from "./db/client";
import * as t from "./db/schema";

// Registro de auditoria: una fila en `activity_logs` por cada mutacion
// (RF-TRZ-001). Las filas solo se insertan; ninguna operacion de la API las
// modifica ni las borra.

export interface AuditEntry {
  userId: string;
  userName: string;
  operation: string;
  entity: string;
  entityId: string;
  details?: string | null;
}

const MAX_DETAILS = 300;

/** `softDeleteTicket` -> `SOFT_DELETE_TICKET` (misma convencion que el dataset de ejemplo). */
export function operationName(mutation: string): string {
  return mutation.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

// Id unico sin consultar la tabla: la auditoria tambien se escribe fuera de las
// mutaciones (login) y no puede depender de la foto del estado.
function auditId(): string {
  return `log-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const details = entry.details?.trim();
  await db.insert(t.activityLogs).values({
    id: auditId(),
    userId: entry.userId,
    userName: entry.userName,
    operation: entry.operation,
    entity: entry.entity,
    entityId: entry.entityId,
    timestamp: new Date().toISOString(),
    details: details ? details.slice(0, MAX_DETAILS) : null,
  });
}
