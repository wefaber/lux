import type {
  TicketStatus,
  EquipmentStatus,
  LoanStatus,
  ServiceStatus,
  ServiceType,
  TicketCategory,
  UserRole,
  InterventionType,
  ReservationResource,
  ReservationStatus,
} from "./types";

export const AUTH_STORAGE_KEY = "lux_auth"; // Clave de localStorage compartida entre useAuth y gql()

export const ROUTES = {
  SPLASH: "/",
  LOGIN: "/login",
  WAIT: "/wait",
  DASHBOARD: "/dashboard",
  INVENTORY: "/dashboard/inventory",
  EQUIPMENT_STATUS: "/dashboard/equipment-status",
  LOCATIONS: "/dashboard/locations",
  RESERVATIONS: "/dashboard/reservations",
  TICKETS: "/dashboard/tickets",
  LOANS: "/dashboard/loans",
  SERVICES: "/dashboard/service-requests",
  PROFILE: "/dashboard/profile",
  ADMIN: "/admin",
  ADMIN_USERS: "/admin/users",
  ADMIN_ROLES: "/admin/roles",
  ADMIN_LOGS: "/admin/logs",
  ADMIN_REPORTS: "/admin/reports",
  NOT_FOUND: "/404",
  FORBIDDEN: "/403",
  SERVER_ERROR: "/500",
} as const; // Rutas de la aplicacion, constantes y de solo lectura

export const TICKET_STATUS_CONFIG: Record<
  TicketStatus,
  { label: string; color: "success" | "warning" | "info" | "destructive" | "muted" }
> = {
  pending: { label: "Pendiente", color: "warning" },
  in_progress: { label: "En progreso", color: "info" },
  in_resolution: { label: "En resolución", color: "warning" },
  resolved: { label: "Resuelto", color: "success" },
}; // Configuracion de estados de tickets, con etiquetas y colores para UI

// Ciclo de vida del ticket: transiciones validas desde cada estado.
// - pending -> in_progress: solo con claim/assign, porque asigna responsable
// - in_progress -> pending: liberar el ticket (quita el responsable)
// - in_progress <-> in_resolution
// - in_progress | in_resolution -> resolved: solo con completeTicket (exige diagnostico)
// - resolved -> in_progress: reabrir
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  pending: ["in_progress"],
  in_progress: ["pending", "in_resolution", "resolved"],
  in_resolution: ["in_progress", "resolved"],
  resolved: ["in_progress"],
};

export const EQUIPMENT_STATUS_CONFIG: Record<
  EquipmentStatus,
  { label: string; color: "success" | "warning" | "info" | "destructive" | "muted" }
> = {
  available: { label: "Disponible", color: "success" },
  in_use: { label: "En uso", color: "info" },
  in_repair: { label: "En reparación", color: "warning" },
  retired: { label: "Dado de baja", color: "destructive" },
}; // Configuracion de estados de equipos, con etiquetas y colores para UI

export const LOAN_STATUS_CONFIG: Record<
  LoanStatus,
  { label: string; color: "success" | "warning" | "info" | "destructive" | "muted" }
> = {
  pending: { label: "Pendiente", color: "warning" },
  approved: { label: "Aprobado", color: "success" },
  rejected: { label: "Rechazado", color: "destructive" },
  active: { label: "Activo", color: "info" },
  overdue: { label: "Vencido", color: "destructive" },
  returned: { label: "Devuelto", color: "muted" },
}; // Configuracion de estados de prestamos

export const SERVICE_STATUS_CONFIG: Record<
  ServiceStatus,
  { label: string; color: "success" | "warning" | "info" | "destructive" | "muted" }
> = {
  pending: { label: "Pendiente", color: "warning" },
  approved: { label: "Aprobado", color: "success" },
  in_progress: { label: "En progreso", color: "info" },
  completed: { label: "Completado", color: "success" },
  rejected: { label: "Rechazado", color: "destructive" },
}; // Configuracion de estado de servicios

export const DASHBOARD_PERIODS = ["7d", "30d", "90d"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const DASHBOARD_PERIOD_LABELS: Record<DashboardPeriod, string> = {
  "7d": "últimos 7 días",
  "30d": "últimos 30 días",
  "90d": "últimos 90 días",
}; // Periodos del dashboard; 90 dias se agrupa por semana

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  lab_preparation: "Preparación de laboratorio",
  software_installation: "Instalación de software",
  equipment_setup: "Configuración de equipo",
  other: "Otro",
}; // Labels de tipos de servicios

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  hardware: "Hardware",
  software: "Software",
  network: "Red",
  other: "Otro",
}; // Labels de categorias de ticket

export const RESERVATION_STATUS_CONFIG: Record<
  ReservationStatus,
  { label: string; color: "success" | "warning" | "info" | "destructive" | "muted" }
> = {
  pending: { label: "Pendiente", color: "warning" },
  approved: { label: "Aprobada", color: "success" },
  rejected: { label: "Rechazada", color: "destructive" },
  active: { label: "En curso", color: "info" },
  completed: { label: "Finalizada", color: "muted" },
  cancelled: { label: "Cancelada", color: "muted" },
}; // Configuracion de estados de reservas

export const RESERVATION_RESOURCE_LABELS: Record<ReservationResource, string> = {
  equipment: "Equipo",
  location: "Espacio",
}; // Que se reserva

export const INTERVENTION_TYPE_LABELS: Record<InterventionType, string> = {
  preventive_maintenance: "Mantenimiento preventivo",
  corrective_repair: "Reparación",
  component_replacement: "Cambio de componente",
  cleaning: "Limpieza",
  software_update: "Actualización de software",
  other: "Otra",
}; // Labels de tipos de intervencion

export const ROLE_LABELS: Record<UserRole, string> = {
  root_admin: "Super Admin",
  admin: "Administrador",
  tecnico: "Técnico",
  solicitante: "Solicitante",
}; // Labels de roles

export const KIND_MACHINE_CODE: Record<string, string> = {
  AIO: "PC",
  Desktop: "PC",
  Laptop: "PC",
  Servidor: "SRV",
  Monitor: "MON",
  Impresora: "IMP",
  Proyector: "PRY",
  Switch: "SW",
  Router: "RTR",
  UPS: "UPS",
  Teclado: "PER",
  Mouse: "PER",
  Webcam: "PER",
  Auriculares: "PER",
  Otro: "EQP",
};

export const EQUIPMENT_KINDS = [
  "AIO",
  "Desktop",
  "Laptop",
  "Monitor",
  "Servidor",
  "Impresora",
  "Proyector",
  "Switch",
  "Router",
  "UPS",
  "Teclado",
  "Mouse",
  "Webcam",
  "Auriculares",
  "Otro",
] as const; // Tipos de equipamientos

export const SPRING_TRANSITION = {
  type: "spring" as const,
  stiffness: 300,
  damping: 30,
};

export const PAGE_TRANSITION = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { type: "spring" as const, stiffness: 300, damping: 30 },
};
