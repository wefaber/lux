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
import { plain, type MessageKey } from "@/i18n";

/** Colores de badge que usan las configuraciones de estados, roles, etc. */
export type StatusColor = "success" | "warning" | "info" | "destructive" | "muted";
export interface StatusConfig {
  /** Texto en el idioma activo (se resuelve al leerlo) */
  readonly label: string;
  /** Clave del diccionario, para generar el texto en un idioma fijo */
  readonly labelKey: MessageKey;
  color: StatusColor;
}

// Los textos de dominio salen del diccionario (src/i18n) y siguen al idioma
// activo: cada `label` (y cada valor de los mapas *_LABELS) es un getter que se
// resuelve al leerlo, asi los consumidores de estas constantes no cambian.
function statusConfig(labelKey: MessageKey, color: StatusColor): StatusConfig {
  return {
    labelKey,
    color,
    get label() {
      return plain(labelKey);
    },
  };
}

function labels<K extends string>(keys: Record<K, MessageKey>): Record<K, string> {
  const map = {} as Record<K, string>;
  for (const value of Object.keys(keys) as K[]) {
    Object.defineProperty(map, value, {
      enumerable: true,
      get: () => plain(keys[value]),
    });
  }
  return map;
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
  pending: statusConfig("status.ticket.pending", "muted"), // distinto de in_resolution: la dona del dashboard los separa por color
  in_progress: statusConfig("status.ticket.in_progress", "info"),
  in_resolution: statusConfig("status.ticket.in_resolution", "warning"),
  resolved: statusConfig("status.ticket.resolved", "success"),
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
  available: statusConfig("status.equipment.available", "success"),
  in_use: statusConfig("status.equipment.in_use", "info"),
  in_repair: statusConfig("status.equipment.in_repair", "warning"),
  retired: statusConfig("status.equipment.retired", "destructive"),
}; // Configuracion de estados de equipos, con etiquetas y colores para UI

// Con que estado se da de alta un equipo: "en uso" lo pone un prestamo y
// "dado de baja" la baja logica
export const INITIAL_EQUIPMENT_STATUSES: EquipmentStatus[] = ["available", "in_repair"];

// Equipos que no se pueden reservar ni elegir para una solicitud nueva
export const UNRESERVABLE_EQUIPMENT_STATUSES: EquipmentStatus[] = ["in_repair", "retired"];

export const LOAN_STATUS_CONFIG: Record<LoanStatus, StatusConfig> = {
  pending: statusConfig("status.loan.pending", "warning"),
  approved: statusConfig("status.loan.approved", "success"),
  rejected: statusConfig("status.loan.rejected", "destructive"),
  active: statusConfig("status.loan.active", "info"),
  overdue: statusConfig("status.loan.overdue", "destructive"),
  returned: statusConfig("status.loan.returned", "muted"),
}; // Configuracion de estados de prestamos

// Entregados y todavia sin devolver: son los que se pueden devolver
export const RETURNABLE_LOAN_STATUSES: LoanStatus[] = ["active", "overdue"];

export const SERVICE_STATUS_CONFIG: Record<ServiceStatus, StatusConfig> = {
  pending: statusConfig("status.service.pending", "warning"),
  approved: statusConfig("status.service.approved", "success"),
  in_progress: statusConfig("status.service.in_progress", "info"),
  completed: statusConfig("status.service.completed", "success"),
  rejected: statusConfig("status.service.rejected", "destructive"),
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

export const DASHBOARD_PERIOD_LABELS = labels<DashboardPeriod>({
  "7d": "period.7d",
  "30d": "period.30d",
  "90d": "period.90d",
}); // Periodos del dashboard; 90 dias se agrupa por semana

export const SERVICE_TYPE_LABELS = labels<ServiceType>({
  lab_preparation: "serviceType.lab_preparation",
  software_installation: "serviceType.software_installation",
  equipment_setup: "serviceType.equipment_setup",
  other: "serviceType.other",
}); // Labels de tipos de servicios

export const TICKET_CATEGORY_LABELS = labels<TicketCategory>({
  hardware: "ticketCategory.hardware",
  software: "ticketCategory.software",
  network: "ticketCategory.network",
  other: "ticketCategory.other",
}); // Labels de categorias de ticket

export const LOCATION_KIND_LABELS = labels<LocationKind>({
  laboratory: "locationKind.laboratory",
  classroom: "locationKind.classroom",
  administration: "locationKind.administration",
  other: "locationKind.other",
}); // Tipos de ubicacion

// Letra de cada tipo: L1 = Laboratorio 1, S2 = Salon 2, A1 = Administracion 1
export const LOCATION_KIND_LETTER: Record<LocationKind, string> = {
  laboratory: "L",
  classroom: "S",
  administration: "A",
  other: "O",
};

export const RESERVATION_STATUS_CONFIG: Record<ReservationStatus, StatusConfig> = {
  pending: statusConfig("status.reservation.pending", "warning"),
  approved: statusConfig("status.reservation.approved", "success"),
  rejected: statusConfig("status.reservation.rejected", "destructive"),
  active: statusConfig("status.reservation.active", "info"),
  completed: statusConfig("status.reservation.completed", "muted"),
  cancelled: statusConfig("status.reservation.cancelled", "muted"),
}; // Configuracion de estados de reservas

// Las que todavia no empezaron ni se cerraron: se pueden modificar o cancelar
export const CHANGEABLE_RESERVATION_STATUSES: ReservationStatus[] = ["pending", "approved"];

export const RESERVATION_RESOURCE_LABELS = labels<ReservationResource>({
  equipment: "resource.equipment",
  location: "resource.location",
}); // Que se reserva

// Texto de un aviso. {o} es la vocal del elemento ("lo resolvió" un ticket, "la
// aprobó" una reserva) y {by} quien lo provocó
export const NOTICE_KIND_LABELS = labels<NoticeKind>({
  assigned: "notice.assigned",
  unassigned: "notice.unassigned",
  taken: "notice.taken",
  approved: "notice.approved",
  rejected: "notice.rejected",
  in_resolution: "notice.in_resolution",
  resolved: "notice.resolved",
  completed: "notice.completed",
  modified: "notice.modified",
  cancelled: "notice.cancelled",
  delivered: "notice.delivered",
  comment: "notice.comment",
  overdue: "notice.overdue",
}); // Labels de avisos

export const NOTICE_ENTITY_GENDER: Record<NoticeEntity, "o" | "a"> = {
  ticket: "o",
  service_request: "a",
  loan: "o",
  reservation: "a",
}; // Vocal para concordar el texto del aviso

export const INTERVENTION_TYPE_LABELS = labels<InterventionType>({
  preventive_maintenance: "intervention.preventive_maintenance",
  corrective_repair: "intervention.corrective_repair",
  component_replacement: "intervention.component_replacement",
  cleaning: "intervention.cleaning",
  software_update: "intervention.software_update",
  other: "intervention.other",
}); // Labels de tipos de intervencion

export const ROLE_CONFIG: Record<UserRole, StatusConfig> = {
  root_admin: statusConfig("role.root_admin", "destructive"),
  admin: statusConfig("role.admin", "warning"),
  tecnico: statusConfig("role.tecnico", "info"),
  solicitante: statusConfig("role.solicitante", "muted"),
}; // Etiqueta y color de cada rol

export const ROLE_LABELS = labels<UserRole>({
  root_admin: "role.root_admin",
  admin: "role.admin",
  tecnico: "role.tecnico",
  solicitante: "role.solicitante",
}); // Mismas claves que ROLE_CONFIG: un solo lugar para los nombres

export const USER_STATUS_CONFIG: Record<"active" | "inactive", StatusConfig> = {
  active: statusConfig("status.user.active", "success"),
  inactive: statusConfig("status.user.inactive", "destructive"),
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

// El tipo se guarda con su nombre en espanol ("Servidor"): es el dato. Lo que se
// muestra sale de aca; un tipo que no esta en la lista se muestra tal cual.
export const EQUIPMENT_KIND_LABELS = labels<(typeof EQUIPMENT_KINDS)[number]>({
  AIO: "equipmentKind.AIO",
  Desktop: "equipmentKind.Desktop",
  Laptop: "equipmentKind.Laptop",
  Monitor: "equipmentKind.Monitor",
  Servidor: "equipmentKind.Servidor",
  Impresora: "equipmentKind.Impresora",
  Proyector: "equipmentKind.Proyector",
  Switch: "equipmentKind.Switch",
  Router: "equipmentKind.Router",
  UPS: "equipmentKind.UPS",
  Teclado: "equipmentKind.Teclado",
  Mouse: "equipmentKind.Mouse",
  Webcam: "equipmentKind.Webcam",
  Auriculares: "equipmentKind.Auriculares",
  Otro: "equipmentKind.Otro",
});

export function equipmentKindLabel(kind: string): string {
  return kind in EQUIPMENT_KIND_LABELS
    ? EQUIPMENT_KIND_LABELS[kind as keyof typeof EQUIPMENT_KIND_LABELS]
    : kind;
}

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
