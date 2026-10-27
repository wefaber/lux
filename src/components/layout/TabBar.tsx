import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { MoreHorizontal, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useHaptics } from "@/hooks/useHaptics";
import { navItemsFor } from "./navItems";
import { NavIcon } from "./NavIcon";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ADMIN_ROLES } from "@/lib/roles";

// Cuantas secciones entran comodas en la barra inferior. Con mas, el resto va
// a "Mas": siete iconos dejaban las etiquetas pisadas y sin aire.
const MAX_SLOTS = 5;

function isCurrent(pathname: string, to: string, end?: boolean): boolean {
  if (end) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function TabBar() {
  const { user, hasRole } = useAuth();
  const { t } = useI18n();
  const { trigger } = useHaptics();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const items = navItemsFor(user?.role);
  // Las secciones marcadas para la barra van primero; el resto se alcanza desde
  // "Mas". Si todas entran, no hace falta el menu extra.
  const tabItems = items.filter((item) => item.inTabBar);
  const primary =
    items.length <= MAX_SLOTS ? items : tabItems.slice(0, MAX_SLOTS - 1);
  const extra = items.filter((item) => !primary.includes(item));
  const showAdmin = hasRole(...ADMIN_ROLES);
  const moreActive =
    extra.some((item) => isCurrent(pathname, item.to, item.end)) ||
    (showAdmin && pathname.startsWith(ROUTES.ADMIN));

  return (
    <>
      <nav
        aria-label={t("nav.main")}
        className="md:hidden fixed bottom-3 left-3 right-3 glass-topbar bg-background shadow-lg border rounded-full border-border z-50"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex h-14">
          {primary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] px-0.5 text-[10px] transition-colors select-none",
                  isActive ? "text-primary" : "text-muted-foreground active:opacity-50",
                )
              }
              onClick={() => trigger(30)}
            >
              <NavIcon item={item} className="h-[22px] w-[22px]" />
              <span className="max-w-full truncate leading-none">{t(item.labelKey)}</span>
            </NavLink>
          ))}
          {extra.length > 0 && (
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              onClick={() => {
                trigger(30);
                setMoreOpen(true);
              }}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-[3px] text-[10px] transition-colors select-none",
                moreActive ? "text-primary" : "text-muted-foreground active:opacity-50",
              )}
            >
              <MoreHorizontal className="h-[22px] w-[22px]" />
              <span className="leading-none">{t("nav.more")}</span>
            </button>
          )}
        </div>
      </nav>

      {/* El resto de las secciones: en el telefono no hay menu lateral, asi que
          tambien aparecen las que no entran en la barra */}
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("nav.more")}</DialogTitle>
            <DialogDescription>{t("nav.moreDescription")}</DialogDescription>
          </DialogHeader>
          <nav aria-label={t("admin.sections")} className="grid gap-1">
            {extra.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-foreground hover:bg-muted",
                  )
                }
              >
                <NavIcon item={item} className="h-4 w-4" />
                {t(item.labelKey)}
              </NavLink>
            ))}
            {showAdmin && (
              <NavLink
                to={ROUTES.ADMIN}
                onClick={() => setMoreOpen(false)}
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-foreground transition-colors hover:bg-muted"
              >
                <Shield className="h-4 w-4" />
                {t("topbar.admin")}
              </NavLink>
            )}
          </nav>
        </DialogContent>
      </Dialog>
    </>
  );
}
