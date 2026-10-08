import {
  LayoutDashboard,
  Package,
  Monitor,
  MapPin,
  Ticket,
  BookOpen,
  Wrench,
  CalendarClock,
  User,
} from "lucide-react";
import { ROUTES } from "@/lib/constants";
import { isStaff } from "@/lib/roles";
import type { UserRole } from "@/lib/types";

export interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  to: string;
  end?: boolean;
  /** Solo para el personal del area (root, admin, tecnico). */
  staffOnly?: boolean;
  /** Aparece en la barra inferior del telefono (el espacio es limitado). */
  inTabBar?: boolean;
}

// Unica lista de secciones para el menu lateral y la barra del telefono, asi
// los dos muestran siempre lo mismo para cada rol.
const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: "Inicio", to: ROUTES.DASHBOARD, end: true, inTabBar: true },
  { icon: Package, label: "Inventario", to: ROUTES.INVENTORY, staffOnly: true, inTabBar: true },
  { icon: Monitor, label: "Estado de Equipos", to: ROUTES.EQUIPMENT_STATUS, staffOnly: true },
  { icon: MapPin, label: "Ubicaciones", to: ROUTES.LOCATIONS, staffOnly: true },
  { icon: Ticket, label: "Tickets", to: ROUTES.TICKETS, inTabBar: true },
  { icon: BookOpen, label: "Préstamos", to: ROUTES.LOANS, staffOnly: true, inTabBar: true },
  { icon: Wrench, label: "Solicitudes", to: ROUTES.SERVICES, inTabBar: true },
  { icon: CalendarClock, label: "Reservas", to: ROUTES.RESERVATIONS, inTabBar: true },
  { icon: User, label: "Perfil", to: ROUTES.PROFILE, inTabBar: true },
];

/** Secciones que ve un rol: el usuario final no ve las del personal del area. */
export function navItemsFor(role: UserRole | undefined): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => !item.staffOnly || isStaff(role));
}
