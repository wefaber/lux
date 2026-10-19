import type { Comment } from "@/lib/types";
import { mockUsers } from "./users";

const [, , , tec1, tec2, , sol1, sol2] = mockUsers;

// Hilos de ejemplo: tkt-001 es de sol1 (atendido por tec1); svc-002 es de sol2
// (atendida por tec2)
export const mockComments: Comment[] = [
  {
    id: "cmt-001",
    entityType: "ticket",
    entityId: "tkt-001",
    author: tec1,
    body: "Hola, ¿la franja aparece siempre o solo al encender? Paso por el laboratorio a revisarlo.",
    createdAt: "2026-05-10T13:00:00Z",
  },
  {
    id: "cmt-002",
    entityType: "ticket",
    entityId: "tkt-001",
    author: sol1,
    body: "Solo los primeros minutos después de encenderlo, después se va.",
    createdAt: "2026-05-10T14:20:00Z",
  },
  {
    id: "cmt-003",
    entityType: "service_request",
    entityId: "svc-002",
    author: tec2,
    body: "La licencia de MATLAB ya está; el toolbox de señales llega esta semana.",
    createdAt: "2026-09-26T11:00:00Z",
  },
  {
    id: "cmt-004",
    entityType: "service_request",
    entityId: "svc-002",
    author: sol2,
    body: "Perfecto, lo necesitamos para la clase del lunes.",
    createdAt: "2026-09-26T12:15:00Z",
  },
];
