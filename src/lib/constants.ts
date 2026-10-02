import type {
  TicketStatus,
  EquipmentStatus,
  LoanStatus,
  ServiceStatus,
  ServiceType,
  TicketCategory,
  UserRole,
  Location,
} from "./types";

export const AUTH_STORAGE_KEY = "lux_auth"; // Clave de localStorage compartida entre useAuth y gql()

export const ROUTES = {
  SPLASH: "/",
  LOGIN: "/login",
  WAIT: "/wait",
  DASHBOARD: "/dashboard",
  INVENTORY: "/dashboard/inventory",
  EQUIPMENT_STATUS: "/dashboard/equipment-status",
  TICKETS: "/dashboard/tickets",
  LOANS: "/dashboard/loans",
  SERVICES: "/dashboard/service-requests",
  PROFILE: "/dashboard/profile",
  ADMIN: "/admin",
  ADMIN_USERS: "/admin/users",
  ADMIN_ROLES: "/admin/roles",
  ADMIN_LOGS: "/admin/logs",
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

export const ROLE_LABELS: Record<UserRole, string> = {
  root_admin: "Super Admin",
  admin: "Administrador",
  tecnico: "Técnico",
  solicitante: "Solicitante",
}; // Labels de roles

export const LOCATIONS: Location[] = ["Laboratorios", "Salones", "Administración", "Otros"];

export const LOCATION_CODES: Record<Location, string> = {
  Laboratorios: "L",
  Salones: "S",
  Administración: "A",
  Otros: "O",
};

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
