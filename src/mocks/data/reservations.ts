import type { Reservation } from "@/lib/types";
import { mockUsers } from "./users";
import { mockProducts } from "./equipment";
import { mockLocations } from "./locations";

const [, admin1, , tec1, , , sol1, sol2, sol3] = mockUsers;

// Fechas relativas a cuando arranca la app, redondeadas a la hora: asi siempre
// hay una reserva en curso, una aprobada para manana, una pendiente, etc.
const HOUR = 3_600_000;
const baseHour = Math.floor(Date.now() / HOUR) * HOUR;
const at = (hours: number) => new Date(baseHour + hours * HOUR).toISOString();

const product = (id: string) => mockProducts.find((p) => p.id === id)!;
const location = (id: string) => mockLocations.find((l) => l.id === id)!;

export const mockReservations: Reservation[] = [
  {
    // Aprobada y ya empezada: el servidor la pasa a "En curso" al leerla
    id: "rsv-001",
    resourceType: "location",
    equipment: null,
    location: location("loc-1"),
    user: sol1,
    purpose: "Clase práctica de redes de 3er año",
    startsAt: at(-1),
    endsAt: at(2),
    status: "approved",
    reviewedBy: tec1,
    rejectionReason: null,
    cancelledBy: null,
    createdAt: at(-72),
    updatedAt: at(-48),
  },
  {
    id: "rsv-002",
    resourceType: "equipment",
    equipment: product("prod-6"),
    location: null,
    user: sol2,
    purpose: "Presentación de proyectos finales",
    startsAt: at(24),
    endsAt: at(26),
    status: "approved",
    reviewedBy: admin1,
    rejectionReason: null,
    cancelledBy: null,
    createdAt: at(-30),
    updatedAt: at(-20),
  },
  {
    id: "rsv-003",
    resourceType: "equipment",
    equipment: product("prod-7"),
    location: null,
    user: sol1,
    purpose: "Charla de orientación vocacional",
    startsAt: at(48),
    endsAt: at(50),
    status: "pending",
    reviewedBy: null,
    rejectionReason: null,
    cancelledBy: null,
    createdAt: at(-5),
    updatedAt: at(-5),
  },
  {
    id: "rsv-004",
    resourceType: "location",
    equipment: null,
    location: location("loc-2"),
    user: sol3,
    purpose: "Ensayo del acto de fin de año",
    startsAt: at(7 * 24),
    endsAt: at(7 * 24 + 3),
    status: "rejected",
    reviewedBy: admin1,
    rejectionReason: "Los salones están reservados para exámenes esa semana",
    cancelledBy: null,
    createdAt: at(-26),
    updatedAt: at(-24),
  },
  {
    // Aprobada y ya terminada: el servidor la pasa a "Finalizada" al leerla
    id: "rsv-005",
    resourceType: "equipment",
    equipment: product("prod-5"),
    location: null,
    user: sol2,
    purpose: "Pruebas de software para el taller de programación",
    startsAt: at(-7 * 24),
    endsAt: at(-7 * 24 + 4),
    status: "approved",
    reviewedBy: tec1,
    rejectionReason: null,
    cancelledBy: null,
    createdAt: at(-9 * 24),
    updatedAt: at(-8 * 24),
  },
  {
    id: "rsv-006",
    resourceType: "equipment",
    equipment: product("prod-12"),
    location: null,
    user: sol3,
    purpose: "Evaluación práctica de ofimática",
    startsAt: at(3 * 24),
    endsAt: at(3 * 24 + 2),
    status: "cancelled",
    reviewedBy: tec1,
    rejectionReason: null,
    cancelledBy: sol3,
    // Nicolas la aprobo y la solicitante la cancelo despues: le queda el aviso
    unseenCancellation: true,
    createdAt: at(-50),
    updatedAt: at(-10),
  },
];
