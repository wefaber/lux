import type { IncidentTemplate } from "@/lib/types";
import { mockUsers } from "./users";

const [, admin1, admin2, tec1, tec2] = mockUsers;

export const mockIncidentTemplates: IncidentTemplate[] = [
  {
    id: "tpl-001",
    name: "Equipo no enciende",
    category: "hardware",
    priority: "high",
    title: "Equipo no enciende",
    description:
      "El equipo no responde al botón de encendido. Verificar cable de alimentación, toma de corriente y LED de la fuente antes de derivar.",
    status: "approved",
    author: admin1,
    approvedBy: admin2,
    approvedAt: "2026-04-02T10:00:00Z",
    createdAt: "2026-03-28T09:00:00Z",
    updatedAt: "2026-04-02T10:00:00Z",
  },
  {
    id: "tpl-002",
    name: "Sin conexión a red",
    category: "network",
    priority: "medium",
    title: "Sin conexión a red",
    description:
      "El equipo no accede a internet ni a recursos internos. Indicar si afecta a todo el laboratorio o solo a una máquina.",
    status: "approved",
    author: admin1,
    approvedBy: admin1,
    approvedAt: "2026-04-05T12:30:00Z",
    createdAt: "2026-03-30T15:00:00Z",
    updatedAt: "2026-04-05T12:30:00Z",
  },
  {
    id: "tpl-003",
    name: "Software no abre",
    category: "software",
    priority: "low",
    title: "Software no abre",
    description:
      "La aplicación se cierra o muestra error al iniciar. Anotar el mensaje exacto y la versión instalada.",
    status: "testing",
    author: tec1,
    approvedBy: null,
    approvedAt: null,
    createdAt: "2026-05-12T08:45:00Z",
    updatedAt: "2026-05-12T08:45:00Z",
  },
  {
    id: "tpl-004",
    name: "Impresora sin respuesta",
    category: "other",
    priority: "critical",
    title: "Impresora sin respuesta",
    description:
      "La impresora de la oficina no imprime ni aparece en la lista de dispositivos. Revisar papel, tóner y cable de red.",
    status: "draft",
    author: tec2,
    approvedBy: null,
    approvedAt: null,
    createdAt: "2026-06-01T11:20:00Z",
    updatedAt: "2026-06-01T11:20:00Z",
  },
];
