import type { IncidentTemplate } from "@/lib/types";
import { mockUsers } from "./users";

const [, admin1, , tec1, tec2] = mockUsers;

// Dos aprobadas (las usa todo el staff), una en prueba de un tecnico y un borrador.
export const mockIncidentTemplates: IncidentTemplate[] = [
  {
    id: "tpl-001",
    name: "PC no enciende",
    category: "hardware",
    priority: "high",
    title: "PC no enciende",
    description:
      "El equipo no responde al presionar el botón de encendido. Verificar cable de alimentación, fuente y regleta antes de abrir el gabinete.",
    status: "approved",
    author: tec1,
    approvedBy: admin1,
    approvedAt: "2026-09-15T14:00:00Z",
    createdAt: "2026-09-10T09:00:00Z",
    updatedAt: "2026-09-15T14:00:00Z",
  },
  {
    id: "tpl-002",
    name: "Sin conexión de red",
    category: "network",
    priority: "medium",
    title: "Equipo sin conexión de red",
    description:
      "El equipo no obtiene dirección IP o no navega. Revisar cable, boca del patch panel y configuración DHCP.",
    status: "approved",
    author: tec2,
    approvedBy: admin1,
    approvedAt: "2026-09-18T11:30:00Z",
    createdAt: "2026-09-12T16:00:00Z",
    updatedAt: "2026-09-18T11:30:00Z",
  },
  {
    id: "tpl-003",
    name: "Proyector sin imagen",
    category: "hardware",
    priority: "medium",
    title: "Proyector sin imagen",
    description:
      "El proyector enciende pero no muestra imagen. Probar otra entrada HDMI/VGA y otro cable antes de reportar la lámpara.",
    status: "testing",
    author: tec1,
    approvedBy: null,
    approvedAt: null,
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-22T08:15:00Z",
  },
  {
    id: "tpl-004",
    name: "Instalar software de laboratorio",
    category: "software",
    priority: "low",
    title: "Instalación de software pendiente",
    description:
      "Falta instalar o actualizar el software requerido por la materia. Indicar nombre y versión en la descripción.",
    status: "draft",
    author: tec2,
    approvedBy: null,
    approvedAt: null,
    createdAt: "2026-10-28T13:00:00Z",
    updatedAt: "2026-10-28T13:00:00Z",
  },
];
