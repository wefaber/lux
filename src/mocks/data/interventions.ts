import type { Intervention } from "@/lib/types";
import { mockUsers } from "./users";

const [, , , tec1, tec2] = mockUsers;

// Trabajo hecho sobre equipos. La de tkt-006 surgio de un ticket; el resto se
// registro directo sobre el equipo, sin ticket de por medio.
export const mockInterventions: Intervention[] = [
  {
    id: "int-001",
    equipmentId: "prod-1",
    technician: tec1,
    type: "preventive_maintenance",
    description: "Limpieza interna, cambio de pasta térmica y revisión de ventiladores.",
    partsReplaced: null,
    ticketId: null,
    performedAt: "2026-03-14T14:00:00Z",
    createdAt: "2026-03-14T14:30:00Z",
    updatedAt: "2026-03-14T14:30:00Z",
  },
  {
    id: "int-002",
    equipmentId: "prod-1",
    technician: tec2,
    type: "software_update",
    description: "Actualización de Windows y drivers de video antes del inicio del semestre.",
    partsReplaced: null,
    ticketId: null,
    performedAt: "2026-07-28T10:00:00Z",
    createdAt: "2026-07-28T11:00:00Z",
    updatedAt: "2026-07-28T11:00:00Z",
  },
  {
    id: "int-003",
    equipmentId: "prod-4",
    technician: tec2,
    type: "software_update",
    description: "Instalación de Windows 11 y drivers del fabricante, pedida en el ticket.",
    partsReplaced: null,
    ticketId: "tkt-006",
    performedAt: "2026-04-18T16:00:00Z",
    createdAt: "2026-04-18T17:00:00Z",
    updatedAt: "2026-04-18T17:00:00Z",
  },
];
