import { useRef } from "react";
import { Outlet, NavLink, Link, useNavigate } from "react-router-dom";
import { Users, Shield, ActivitySquare, ArrowLeft, Zap, BarChart3 } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import { useI18n } from "@/hooks/useI18n";
import { LanguageSwitcher } from "@/components/accessibility/LanguageSwitcher";
import type { MessageKey } from "@/i18n";
import { ThemeSwitcher } from "@/components/accessibility/ThemeSwitcher";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useResponsiveTables } from "@/hooks/useResponsiveTables";

const adminNav: Array<{ icon: typeof Users; labelKey: MessageKey; to: string }> = [
  { icon: Users, labelKey: "admin.nav.users", to: ROUTES.ADMIN_USERS },
  { icon: Shield, labelKey: "admin.nav.roles", to: ROUTES.ADMIN_ROLES },
  { icon: ActivitySquare, labelKey: "admin.nav.logs", to: ROUTES.ADMIN_LOGS },
  { icon: BarChart3, labelKey: "admin.nav.reports", to: ROUTES.ADMIN_REPORTS },
];

export function AdminLayout() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  useResponsiveTables(mainRef); // tablas que no entran -> tarjetas

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* El menu lateral solo desde md: en el telefono le dejaba ~150px al contenido */}
      <aside className="hidden md:flex w-56 flex-col glass-sidebar">
        <div className="flex items-center gap-2 p-4 h-14">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive">
            <Zap className="h-4 w-4 text-destructive-foreground" />
          </div>
          <div>
            <span className="text-xs font-semibold text-sidebar-foreground block leading-none">
              {t("admin.brand")}
            </span>
            <span className="text-[10px] text-muted-foreground leading-none">
              {t("admin.panel")}
            </span>
          </div>
        </div>

        <button
          onClick={() => navigate(ROUTES.DASHBOARD)}
          className="mx-2 mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("admin.backToDashboard")}
        </button>

        <nav className="flex-1 px-2 space-y-0.5">
          {adminNav.map(({ icon: Icon, labelKey, to }) => (
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
              <span className="truncate">{t(labelKey)}</span>
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
        <header className="h-14 flex items-center justify-between gap-2 px-4 md:px-6 glass-topbar">
          <div className="flex items-center gap-1 min-w-0">
            <Button variant="ghost" size="icon" className="md:hidden shrink-0" asChild>
              <Link to={ROUTES.DASHBOARD} aria-label={t("admin.backToDashboard")}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-sm font-semibold text-foreground truncate">{t("admin.panel")}</h1>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </header>
        {/* En el telefono las secciones van en una fila que se desplaza de costado */}
        <nav
          aria-label={t("admin.sections")}
          className="md:hidden flex gap-1 overflow-x-auto px-4 py-2 border-b border-border"
        >
          {adminNav.map(({ icon: Icon, labelKey, to }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-sidebar-accent",
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(labelKey)}
            </NavLink>
          ))}
        </nav>
        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
