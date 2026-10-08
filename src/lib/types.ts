export type UserRole = "root_admin" | "admin" | "tecnico" | "solicitante";

export interface User {
  id: string;
  name: string;
  dni: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
} // Interfaces de usuario

export type EquipmentStatus = "available" | "in_use" | "in_repair" | "retired"; // Estado del equipamiento

export interface Location {
  id: string;
  name: string;
  /** 1 a 3 letras: arranca el ID de maquina de sus equipos (L1-PC3) */
  code: string;
  /** Equipos activos en la ubicacion (calculado por el servidor) */
  productCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
} // Ubicacion del equipamiento

export interface Product {
  id: string;
  type: "product";
  machineId: string;
  kind: string;
  brand: string;
  model: string;
  serialNumber: string;
  partNumber: string;
  status: EquipmentStatus;
  issues: string | null;
  locationId: string;
  /** Nombre de la ubicacion, para mostrar; lo mantiene el servidor si se renombra */
  location: string;
  components: Component[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
} // Inteface de producto

export interface Component {
  id: string;
  type: "component";
  name: string;
  model: string;
  manufacturer: string;
  serialNumber: string;
  partNumber: string;
  isFactory: boolean;
  isWorking: boolean;
  productId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
} // Intefaz de componente

export type Equipment = Product | Component; // Tipo de equipamiento (Producto, componente)

export type TicketStatus = "pending" | "in_progress" | "in_resolution" | "resolved"; // Estado del ticket
export type TicketCategory = "hardware" | "software" | "network" | "other"; // Categoria del ticket

export interface Ticket {
  id: string;
  title: string;
  description: string;
  category: TicketCategory;
  status: TicketStatus;
  submittedBy: User;
  assignedTo: User | null;
  equipmentId: string | null;
  equipment: Product | null;
  diagnosis: string | null;
  corrected: boolean | null;
  actionsTaken: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
} // Interfaz de ticket

export type LoanStatus = "pending" | "approved" | "rejected" | "active" | "overdue" | "returned"; // Estado del prestamo

export interface Loan {
  id: string;
  equipment: Product;
  user: User;
  status: LoanStatus;
  approvedBy: User | null;
  deliveredBy: User | null;
  deliveredAt: string | null;
  issueDate: string;
  returnDate: string;
  actualReturnDate: string | null;
  rejectionReason: string | null;
  components: Component[];
  createdAt: string;
  updatedAt: string;
} // Interfaz de prestamo

export type ServiceType = "lab_preparation" | "software_installation" | "equipment_setup" | "other"; // Tipo de servicio
export type ServiceStatus = "pending" | "approved" | "in_progress" | "completed" | "rejected"; // Estadi de servicio

export interface ServiceRequest {
  id: string;
  type: ServiceType;
  status: ServiceStatus;
  requestedBy: User;
  assignedTo: User | null;
  description: string;
  labNumber: string | null;
  softwareName: string | null;
  equipmentId: string | null;
  resolutionText: string | null;
  createdAt: string;
  updatedAt: string;
} // Interfaz de servicio

export type InterventionType =
  | "preventive_maintenance"
  | "corrective_repair"
  | "component_replacement"
  | "cleaning"
  | "software_update"
  | "other"; // Tipo de trabajo hecho sobre un equipo

export interface Intervention {
  id: string;
  equipmentId: string;
  technician: User;
  type: InterventionType;
  description: string;
  partsReplaced: string | null;
  /** Ticket del que surgio, si surgio de uno */
  ticketId: string | null;
  performedAt: string;
  createdAt: string;
  updatedAt: string;
} // Intervencion registrada sobre un equipo, con o sin ticket

export type ReservationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "active"
  | "completed"
  | "cancelled"; // pending -> approved | rejected -> active -> completed | cancelled
export type ReservationResource = "equipment" | "location"; // Un equipo o un espacio

export interface Reservation {
  id: string;
  resourceType: ReservationResource;
  /** El equipo reservado (si resourceType es equipment) */
  equipment: Product | null;
  /** El espacio reservado (si resourceType es location) */
  location: Location | null;
  user: User;
  purpose: string;
  startsAt: string;
  endsAt: string;
  status: ReservationStatus;
  /** Quien la aprobo o rechazo */
  reviewedBy: User | null;
  rejectionReason: string | null;
  cancelledBy: User | null;
  createdAt: string;
  updatedAt: string;
} // Reserva de un equipo o espacio por un rango de fechas

export type CommentEntity = "ticket" | "service_request"; // Que se puede comentar

export interface Comment {
  id: string;
  entityType: CommentEntity;
  entityId: string;
  author: User;
  body: string;
  createdAt: string;
} // Comentario en el hilo de un ticket o solicitud

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  operation: string;
  entity: string;
  entityId: string;
  timestamp: string;
  details: string | null;
} // Interfaz de log de auditoria

export interface DashboardStats {
  totalEquipment: number;
  openTickets: number;
  activeLoans: number;
  pendingServices: number;
  ticketsByStatus: Array<{ status: TicketStatus; count: number }>;
  servicesByPeriod: Array<{ date: string; count: number }>;
  /** Carga de trabajo del area: solo llega para el personal, null para el solicitante */
  workQueue: WorkQueue | null;
} // Interfaz de datos del dashboard

export interface WorkQueue {
  unassignedTickets: number;
  ticketsInProgress: number;
  pendingServices: number;
  overdueLoans: number;
  equipmentInRepair: number;
} // Lo que esta esperando a alguien del area

export interface Reports {
  overdueLoans: Array<{
    loanId: string;
    machineId: string;
    equipment: string;
    user: string;
    returnDate: string;
    daysOverdue: number;
  }>;
  resolution: {
    resolvedCount: number;
    averageHours: number | null;
    byCategory: Array<{
      category: TicketCategory;
      resolvedCount: number;
      averageHours: number | null;
    }>;
  };
  topIncidentEquipment: Array<{
    equipmentId: string;
    machineId: string;
    equipment: string;
    ticketCount: number;
    openCount: number;
  }>;
} // Reportes para el administrador

export interface AuthUser extends User {
  token: string;
} // Interfaz de auth user con token de usuario extendiendo usuario

export type FontSize = "sm" | "md" | "lg" | "xl"; // Tamaños de fuentes
export type Theme = "light" | "dark"; // Tipos de temas

export interface ThemeSettings {
  theme: Theme;
  fontSize: FontSize;
  highContrast: boolean;
  dyslexicFont: boolean;
} // Interfaz de settings de tema

export interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
} // GraphQL Interface con respuest

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
