import type { ScanEvent } from "@/lib/types";
import { mockUsers } from "./users";

const [, admin1, , tec1, , , sol1] = mockUsers;

// Escaneos de QR ya registrados (semilla chica)
export const mockScanEvents: ScanEvent[] = [
  {
    id: "scan-001",
    user: tec1,
    machineId: "L1-PC2",
    productId: "prod-2",
    context: "inventory",
    userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile",
    createdAt: "2026-05-11T09:55:00Z",
  },
  {
    id: "scan-002",
    user: admin1,
    machineId: "L1-PC3",
    productId: "prod-5",
    context: "incident",
    userAgent: null,
    createdAt: "2026-05-21T08:10:00Z",
  },
  {
    id: "scan-003",
    user: sol1,
    machineId: "XX-000",
    productId: null,
    context: "loan",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    createdAt: "2026-06-02T12:00:00Z",
  },
];
