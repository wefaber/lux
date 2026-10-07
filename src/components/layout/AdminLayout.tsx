import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { Users, Shield, ActivitySquare, ArrowLeft, Zap, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import { ThemeSwitcher } from "@/components/accessibility/ThemeSwitcher";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const adminNav = [
  { icon: Users, label: "Usuarios", to: ROUTES.ADMIN_USERS },
  { icon: Shield, label: "Roles y Permisos", to: ROUTES.ADMIN_ROLES },
  { icon: ActivitySquare, label: "Registros de Actividad", to: ROUTES.ADMIN_LOGS },
  { icon: BarChart3, label: "Reportes", to: ROUTES.ADMIN_REPORTS },
];

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
} // Iniciales del nombre

export function AdminLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="w-56 flex flex-col glass-sidebar">
        <div className="flex items-center gap-2 p-4 h-14">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive">
            <Zap className="h-4 w-4 text-destructive-foreground" />
          </div>
          <div>
            <span className="text-xs font-semibold text-sidebar-foreground block leading-none">
              Lux Admin
            </span>
            <span className="text-[10px] text-muted-foreground leading-none">
              Panel de Administración
            </span>
          </div>
        </div>

        <button
          onClick={() => navigate(ROUTES.DASHBOARD)}
          className="mx-2 mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver al Dashboard
        </button>

        <nav className="flex-1 px-2 space-y-0.5">
          {adminNav.map(({ icon: Icon, label, to }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-200 cursor-pointer",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                    : "text-muted-foreground",
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </nav>

        {user && (
          <div className="p-3 border-t border-sidebar-border">
            <div className="flex items-center gap-2">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs">{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-xs font-medium text-sidebar-foreground truncate">
                  {user.name.split(" ")[0]}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          </div>
        )}
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="h-14 flex items-center justify-between px-6 glass-topbar">
          <h1 className="text-sm font-semibold text-foreground">Panel de Administración</h1>
          <ThemeSwitcher />
        </header>
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
