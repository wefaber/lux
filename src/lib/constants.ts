import type {
  TicketStatus,
  EquipmentStatus,
  LoanStatus,
  ServiceStatus,
  ServiceType,
  TicketCategory,
  UserRole,
  InterventionType,
  LocationKind,
  NoticeEntity,
  NoticeKind,
  ReservationResource,
  ReservationStatus,
} from "./types";

/** Colores de badge que usan las configuraciones de estados, roles, etc. */
export type StatusColor = "success" | "warning" | "info" | "destructive" | "muted";
export interface StatusConfig {
  label: string;
  color: StatusColor;
}

// Color de cada tono como variable CSS del tema (sigue el modo oscuro y el alto
// contraste): para graficos, que no usan las clases de Tailwind
export const STATUS_COLOR_VAR: Record<StatusColor, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  info: "var(--info)",
  destructive: "var(--destructive)",
  muted: "var(--muted-foreground)",
};

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

export const TICKET_STATUS_CONFIG: Record<TicketStatus, StatusConfig> = {
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

export const EQUIPMENT_STATUS_CONFIG: Record<EquipmentStatus, StatusConfig> = {
  available: { label: "Disponible", color: "success" },
  in_use: { label: "En uso", color: "info" },
  in_repair: { label: "En reparación", color: "warning" },
  retired: { label: "Dado de baja", color: "destructive" },
}; // Configuracion de estados de equipos, con etiquetas y colores para UI

// Con que estado se da de alta un equipo: "en uso" lo pone un prestamo y
// "dado de baja" la baja logica
export const INITIAL_EQUIPMENT_STATUSES: EquipmentStatus[] = ["available", "in_repair"];

// Equipos que no se pueden reservar ni elegir para una solicitud nueva
export const UNRESERVABLE_EQUIPMENT_STATUSES: EquipmentStatus[] = ["in_repair", "retired"];

export const LOAN_STATUS_CONFIG: Record<LoanStatus, StatusConfig> = {
  pending: { label: "Pendiente", color: "warning" },
  approved: { label: "Aprobado", color: "success" },
  rejected: { label: "Rechazado", color: "destructive" },
  active: { label: "Activo", color: "info" },
  overdue: { label: "Vencido", color: "destructive" },
  returned: { label: "Devuelto", color: "muted" },
}; // Configuracion de estados de prestamos

// Entregados y todavia sin devolver: son los que se pueden devolver
export const RETURNABLE_LOAN_STATUSES: LoanStatus[] = ["active", "overdue"];

export const SERVICE_STATUS_CONFIG: Record<ServiceStatus, StatusConfig> = {
  pending: { label: "Pendiente", color: "warning" },
  approved: { label: "Aprobado", color: "success" },
  in_progress: { label: "En progreso", color: "info" },
  completed: { label: "Completado", color: "success" },
  rejected: { label: "Rechazado", color: "destructive" },
}; // Configuracion de estado de servicios

// Ciclo de vida de una solicitud: completada y rechazada la cierran
export const SERVICE_TRANSITIONS: Record<ServiceStatus, ServiceStatus[]> = {
  pending: ["approved", "in_progress", "completed", "rejected"],
  approved: ["in_progress", "completed", "rejected"],
  in_progress: ["completed", "rejected"],
  completed: [],
  rejected: [],
};

// Derivado de SERVICE_TRANSITIONS: cerrada es la que ya no pasa a ningun otro estado
export const CLOSED_SERVICE_STATUSES = (Object.keys(SERVICE_TRANSITIONS) as ServiceStatus[]).filter(
  (s) => SERVICE_TRANSITIONS[s].length === 0,
);

// Estados de una solicitud que exigen texto de resolucion (o motivo del rechazo)
export const SERVICE_STATUSES_WITH_RESOLUTION: ServiceStatus[] = ["completed", "rejected"];

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

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  laboratory: "Laboratorio",
  classroom: "Salón",
  administration: "Administración",
  other: "Otro",
}; // Tipos de ubicacion

// Letra de cada tipo: L1 = Laboratorio 1, S2 = Salon 2, A1 = Administracion 1
export const LOCATION_KIND_LETTER: Record<LocationKind, string> = {
  laboratory: "L",
  classroom: "S",
  administration: "A",
  other: "O",
};

export const RESERVATION_STATUS_CONFIG: Record<ReservationStatus, StatusConfig> = {
  pending: { label: "Pendiente", color: "warning" },
  approved: { label: "Aprobada", color: "success" },
  rejected: { label: "Rechazada", color: "destructive" },
  active: { label: "En curso", color: "info" },
  completed: { label: "Finalizada", color: "muted" },
  cancelled: { label: "Cancelada", color: "muted" },
}; // Configuracion de estados de reservas

// Las que todavia no empezaron ni se cerraron: se pueden modificar o cancelar
export const CHANGEABLE_RESERVATION_STATUSES: ReservationStatus[] = ["pending", "approved"];

export const RESERVATION_RESOURCE_LABELS: Record<ReservationResource, string> = {
  equipment: "Equipo",
  location: "Espacio",
}; // Que se reserva

// Texto de un aviso. {o} es la vocal del elemento ("lo resolvió" un ticket, "la
// aprobó" una reserva) y {by} quien lo provocó
export const NOTICE_KIND_LABELS: Record<NoticeKind, string> = {
  assigned: "Te l{o} asignó {by}",
  unassigned: "Te l{o} sacó {by}",
  taken: "Ahora l{o} atiende {by}",
  approved: "L{o} aprobó {by}",
  rejected: "L{o} rechazó {by}",
  in_resolution: "L{o} puso en resolución {by}",
  resolved: "L{o} resolvió {by}",
  completed: "L{o} completó {by}",
  modified: "L{o} modificó {by}",
  cancelled: "L{o} canceló {by}",
  delivered: "Te l{o} entregó {by}",
  comment: "Comentario nuevo de {by}",
  overdue: "Venció la fecha de devolución",
}; // Labels de avisos

export const NOTICE_ENTITY_GENDER: Record<NoticeEntity, "o" | "a"> = {
  ticket: "o",
  service_request: "a",
  loan: "o",
  reservation: "a",
}; // Vocal para concordar el texto del aviso

export const INTERVENTION_TYPE_LABELS: Record<InterventionType, string> = {
  preventive_maintenance: "Mantenimiento preventivo",
  corrective_repair: "Reparación",
  component_replacement: "Cambio de componente",
  cleaning: "Limpieza",
  software_update: "Actualización de software",
  other: "Otra",
}; // Labels de tipos de intervencion

export const ROLE_CONFIG: Record<UserRole, StatusConfig> = {
  root_admin: { label: "Super Admin", color: "destructive" },
  admin: { label: "Administrador", color: "warning" },
  tecnico: { label: "Técnico", color: "info" },
  solicitante: { label: "Solicitante", color: "muted" },
}; // Etiqueta y color de cada rol

export const ROLE_LABELS = Object.fromEntries(
  Object.entries(ROLE_CONFIG).map(([role, { label }]) => [role, label]),
) as Record<UserRole, string>; // Derivado de ROLE_CONFIG: un solo lugar para los nombres

export const USER_STATUS_CONFIG: Record<"active" | "inactive", StatusConfig> = {
  active: { label: "Activo", color: "success" },
  inactive: { label: "Inactivo", color: "destructive" },
}; // Estado de la cuenta de un usuario

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
  transition: SPRING_TRANSITION,
};
