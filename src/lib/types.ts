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
export type Location = "Laboratorios" | "Salones" | "Administración" | "Otros"; // Ubicacion del equipamiento

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
  location: Location;
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
  description: string;
  labNumber: string | null;
  softwareName: string | null;
  equipmentId: string | null;
  resolutionText: string | null;
  createdAt: string;
  updatedAt: string;
} // Interfaz de servicio

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
} // Interfaz de datos del dashboard

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
