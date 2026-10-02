import { NavLink } from "react-router-dom";
import { LayoutDashboard, Package, Ticket, BookOpen, Wrench, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { useHaptics } from "@/hooks/useHaptics";
import type { UserRole } from "@/lib/types";

type TabItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  to: string;
  end?: boolean;
  roles: ReadonlyArray<UserRole>;
};

const TAB_ITEMS: TabItem[] = [
  {
    icon: LayoutDashboard,
    label: "Inicio",
    to: ROUTES.DASHBOARD,
    end: true,
    roles: ["root_admin", "admin", "tecnico", "solicitante"],
  },
  { icon: Package, label: "Inventario", to: ROUTES.INVENTORY, roles: ["solicitante"] },
  {
    icon: Ticket,
    label: "Tickets",
    to: ROUTES.TICKETS,
    roles: ["root_admin", "admin", "tecnico", "solicitante"],
  },
  {
    icon: BookOpen,
    label: "Préstamos",
    to: ROUTES.LOANS,
    roles: ["root_admin", "admin", "tecnico", "solicitante"],
  },
  {
    icon: Wrench,
    label: "Solicitudes",
    to: ROUTES.SERVICES,
    roles: ["root_admin", "admin", "tecnico", "solicitante"],
  },
  {
    icon: User,
    label: "Perfil",
    to: ROUTES.PROFILE,
    roles: ["root_admin", "admin", "tecnico", "solicitante"],
  },
];

export function TabBar() {
  const { user } = useAuth();
  const { trigger } = useHaptics();

  const visibleItems = TAB_ITEMS.filter(
    (item) => user && (item.roles as ReadonlyArray<string>).includes(user.role),
  );

  return (
    <nav
      className="md:hidden fixed bottom-5 left-3 right-3 glass-topbar border rounded-full border-border z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex h-14">
        {visibleItems.map(({ icon: Icon, label, to, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center justify-center gap-[3px] text-[10px] transition-colors select-none",
                isActive ? "text-primary" : "text-muted-foreground active:opacity-50",
              )
            }
            onClick={() => trigger(30)}
          >
            <Icon className="h-[22px] w-[22px]" />
            <span className="leading-none">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
