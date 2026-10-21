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
import type { NoticeEntity, UserRole } from "@/lib/types";
import type { MessageKey } from "@/i18n";

export interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  /** Clave del diccionario del texto del menu */
  labelKey: MessageKey;
  to: string;
  end?: boolean;
  /** Solo para el personal del area (root, admin, tecnico). */
  staffOnly?: boolean;
  /** Aparece en la barra inferior del telefono (el espacio es limitado). */
  inTabBar?: boolean;
  /** Avisos que se listan en la seccion: con alguno sin ver se marca con un punto. */
  notices?: NoticeEntity;
}

// Unica lista de secciones para el menu lateral y la barra del telefono, asi
// los dos muestran siempre lo mismo para cada rol.
const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, labelKey: "nav.home", to: ROUTES.DASHBOARD, end: true, inTabBar: true },
  {
    icon: Package,
    labelKey: "nav.inventory",
    to: ROUTES.INVENTORY,
    staffOnly: true,
    inTabBar: true,
  },
  { icon: Monitor, labelKey: "nav.equipmentStatus", to: ROUTES.EQUIPMENT_STATUS, staffOnly: true },
  { icon: MapPin, labelKey: "nav.locations", to: ROUTES.LOCATIONS, staffOnly: true },
  { icon: Ticket, labelKey: "nav.tickets", to: ROUTES.TICKETS, inTabBar: true, notices: "ticket" },
  // El solicitante ve los suyos (pedirlos y seguir su estado); el staff los gestiona
  { icon: BookOpen, labelKey: "nav.loans", to: ROUTES.LOANS, inTabBar: true, notices: "loan" },
  {
    icon: Wrench,
    labelKey: "nav.services",
    to: ROUTES.SERVICES,
    inTabBar: true,
    notices: "service_request",
  },
  {
    icon: CalendarClock,
    labelKey: "nav.reservations",
    to: ROUTES.RESERVATIONS,
    inTabBar: true,
    notices: "reservation",
  },
  { icon: User, labelKey: "nav.profile", to: ROUTES.PROFILE, inTabBar: true },
];

/** Secciones que ve un rol: el usuario final no ve las del personal del area. */
export function navItemsFor(role: UserRole | undefined): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => !item.staffOnly || isStaff(role));
}
