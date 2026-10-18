import type { ActivityLog } from "@/lib/types";
import { mockUsers } from "./data/users";

let idCounter = 1000;
export function genId(prefix = "id"): string {
  return `${prefix}-${++idCounter}`;
}

export function genDate(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

const operations = [
  "CREATE_USER",
  "UPDATE_USER",
  "DELETE_USER",
  "CREATE_PRODUCT",
  "UPDATE_PRODUCT",
  "CREATE_TICKET",
  "ASSIGN_TICKET",
  "RESOLVE_TICKET",
  "CREATE_LOAN",
  "APPROVE_LOAN",
  "RETURN_LOAN",
  "CREATE_SERVICE",
  "UPDATE_SERVICE",
  "LOGIN",
];

const entities = ["User", "Product", "Component", "Ticket", "Loan", "ServiceRequest", "Session"];

export const mockActivityLogs: ActivityLog[] = Array.from({ length: 50 }, (_, i) => {
  const user = mockUsers[Math.floor(Math.random() * Math.min(6, mockUsers.length))];
  const op = operations[Math.floor(Math.random() * operations.length)];
  const entity = entities[Math.floor(Math.random() * entities.length)];

  return {
    id: `log-${String(i + 1).padStart(3, "0")}`,
    userId: user.id,
    userName: user.name,
    operation: op,
    entity,
    entityId: genId(entity.toLowerCase()),
    timestamp: genDate(Math.floor(Math.random() * 30)),
    details: Math.random() > 0.5 ? `Operación ${op} en ${entity}` : null,
  };
}).toSorted((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
