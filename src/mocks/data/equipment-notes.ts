import type { User } from "@/lib/types";
import { mockUsers } from "./users";

const [, , , tec1, tec2] = mockUsers;

// Nota privada: solo la ve su autor. deletedAt = baja logica (DeleteEquipmentNote)
export interface MockEquipmentNote {
  id: string;
  productId: string;
  body: string;
  author: User;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const mockEquipmentNotes: MockEquipmentNote[] = [
  {
    id: "note-001",
    productId: "prod-2",
    body: "Monitor con franja oscura: revisar el panel después de la visita del proveedor.",
    author: tec1,
    createdAt: "2026-05-11T10:00:00Z",
    updatedAt: "2026-05-11T10:00:00Z",
    deletedAt: null,
  },
  {
    id: "note-002",
    productId: "prod-2",
    body: "El cable HDMI es el original; probar con otro antes de pedir reemplazo.",
    author: tec1,
    createdAt: "2026-05-14T16:30:00Z",
    updatedAt: "2026-05-15T09:10:00Z",
    deletedAt: null,
  },
  {
    id: "note-003",
    productId: "prod-5",
    body: "Fuente sospechosa: el LED no se enciende con el botón.",
    author: tec2,
    createdAt: "2026-05-21T08:15:00Z",
    updatedAt: "2026-05-21T08:15:00Z",
    deletedAt: null,
  },
];
