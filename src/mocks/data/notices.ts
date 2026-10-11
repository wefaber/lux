import type { Notice, PendingSeen } from "@/lib/types";
import { mockUsers } from "./users";
import { mockReservations } from "./reservations";

const [, , , tec1, tec2, , , sol2, sol3] = mockUsers;

const cancelled = mockReservations.find((r) => r.id === "rsv-006")!;

// Avisos sin ver de ejemplo: Nicolas (tec1) aprobo rsv-006 y la solicitante la
// cancelo; en svc-002 la solicitante le contesto a tec2 en el hilo
export const mockNotices: Notice[] = [
  {
    id: "ntc-001",
    userId: tec1.id,
    entityType: "reservation",
    entityId: "rsv-006",
    kind: "cancelled",
    by: sol3,
    createdAt: cancelled.updatedAt,
  },
  {
    id: "ntc-002",
    userId: tec2.id,
    entityType: "service_request",
    entityId: "svc-002",
    kind: "comment",
    by: sol2,
    createdAt: "2026-09-26T12:15:00Z",
  },
];

// Nadie del staff vio todavia los pendientes: todos cuentan como nuevos
export const mockPendingSeen: PendingSeen[] = [];
