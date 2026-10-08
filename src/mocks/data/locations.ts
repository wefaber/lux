import type { Location } from "@/lib/types";

// Cada ubicacion es un lugar concreto: su codigo es la letra del tipo y su
// numero (L1 = Laboratorio 1), y es como arranca el ID de sus equipos (L1-PC3).
// productCount lo calcula el handler en cada lectura, por eso arranca en 0.
const base = {
  productCount: 0,
  createdAt: "2023-01-01T10:00:00Z",
  updatedAt: "2023-01-01T10:00:00Z",
  deletedAt: null,
};

export const mockLocations: Location[] = [
  { id: "loc-1", kind: "laboratory", number: 1, name: "Laboratorio 1", code: "L1", ...base },
  { id: "loc-2", kind: "classroom", number: 1, name: "Salón 1", code: "S1", ...base },
  { id: "loc-3", kind: "administration", number: 1, name: "Administración 1", code: "A1", ...base },
  { id: "loc-4", kind: "other", number: 1, name: "Otro 1", code: "O1", ...base },
  { id: "loc-5", kind: "laboratory", number: 2, name: "Laboratorio 2", code: "L2", ...base },
];
