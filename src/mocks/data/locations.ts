import type { Location } from "@/lib/types";

// Las cuatro ubicaciones que antes estaban fijas en el codigo. productCount lo
// calcula el handler en cada lectura, por eso arranca en 0.
export const mockLocations: Location[] = [
  {
    id: "loc-1",
    name: "Laboratorios",
    code: "L",
    productCount: 0,
    createdAt: "2023-01-01T10:00:00Z",
    updatedAt: "2023-01-01T10:00:00Z",
    deletedAt: null,
  },
  {
    id: "loc-2",
    name: "Salones",
    code: "S",
    productCount: 0,
    createdAt: "2023-01-01T10:00:00Z",
    updatedAt: "2023-01-01T10:00:00Z",
    deletedAt: null,
  },
  {
    id: "loc-3",
    name: "Administración",
    code: "A",
    productCount: 0,
    createdAt: "2023-01-01T10:00:00Z",
    updatedAt: "2023-01-01T10:00:00Z",
    deletedAt: null,
  },
  {
    id: "loc-4",
    name: "Otros",
    code: "O",
    productCount: 0,
    createdAt: "2023-01-01T10:00:00Z",
    updatedAt: "2023-01-01T10:00:00Z",
    deletedAt: null,
  },
];
