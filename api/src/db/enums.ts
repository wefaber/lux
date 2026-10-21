import type {
  CommentEntity,
  EquipmentStatus,
  ErrorReportStatus,
  InterventionType,
  LoanStatus,
  LocationKind,
  NoticeEntity,
  NoticeKind,
  ReservationResource,
  ReservationStatus,
  ServiceStatus,
  ServiceType,
  TicketCategory,
  TicketStatus,
  UserRole,
} from "@/lib/types";

// Valores permitidos de cada columna de estado, rol o tipo. De aca salen los CHECK
// de la base (schema.ts). `exhaustive` hace que no compile si los tipos del
// dominio ganan o pierden un valor y esta lista no se actualiza.
function exhaustive<T extends string>() {
  return <const L extends readonly T[]>(
    values: L & ([T] extends [L[number]] ? unknown : never),
  ): L => values;
}

export const USER_ROLES = exhaustive<UserRole>()(["root_admin", "admin", "tecnico", "solicitante"]);
export const LOCATION_KINDS = exhaustive<LocationKind>()(["laboratory", "classroom", "administration", "other"]);
export const EQUIPMENT_STATUSES = exhaustive<EquipmentStatus>()(["available", "in_use", "in_repair", "retired"]);
export const TICKET_STATUSES = exhaustive<TicketStatus>()(["pending", "in_progress", "in_resolution", "resolved"]);
export const TICKET_CATEGORIES = exhaustive<TicketCategory>()(["hardware", "software", "network", "other"]);
export const LOAN_STATUSES = exhaustive<LoanStatus>()(["pending", "approved", "rejected", "active", "overdue", "returned"]);
export const SERVICE_TYPES = exhaustive<ServiceType>()(["lab_preparation", "software_installation", "equipment_setup", "other"]);
export const SERVICE_STATUSES = exhaustive<ServiceStatus>()(["pending", "approved", "in_progress", "completed", "rejected"]);
export const INTERVENTION_TYPES = exhaustive<InterventionType>()([
  "preventive_maintenance",
  "corrective_repair",
  "component_replacement",
  "cleaning",
  "software_update",
  "other",
]);
export const RESERVATION_RESOURCES = exhaustive<ReservationResource>()(["equipment", "location"]);
export const RESERVATION_STATUSES = exhaustive<ReservationStatus>()(["pending", "approved", "rejected", "active", "completed", "cancelled"]);
export const COMMENT_ENTITIES = exhaustive<CommentEntity>()(["ticket", "service_request"]);
export const NOTICE_ENTITIES = exhaustive<NoticeEntity>()(["ticket", "service_request", "loan", "reservation"]);
export const ERROR_REPORT_STATUSES = exhaustive<ErrorReportStatus>()(["new", "triaged", "resolved"]);
export const NOTICE_KINDS = exhaustive<NoticeKind>()([
  "assigned",
  "unassigned",
  "taken",
  "approved",
  "rejected",
  "in_resolution",
  "resolved",
  "completed",
  "modified",
  "cancelled",
  "delivered",
  "comment",
  "overdue",
]);
