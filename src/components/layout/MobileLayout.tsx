import { useEffect } from "react";
import { Link, NavLink, Navigate, useLocation, useNavigate, useOutlet } from "react-router-dom";
import {
  AlertTriangle,
  CloudUpload,
  LogOut,
  QrCode,
  Ticket,
  WifiOff,
  Zap,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES, isMobilePath } from "@/lib/constants";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useOnline } from "@/hooks/useOnline";
import { useOutbox } from "@/hooks/useOutbox";
import { startOutbox } from "@/lib/outbox";
import type { MessageKey } from "@/i18n";
import { Button } from "@/components/ui/button";

interface MobileTab {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: MessageKey;
  /** Rutas que mantienen la pestana marcada (flujos que salen de ella) */
  also?: string[];
}

// Las pestanas son una lista: la barra reparte el ancho entre las que haya.
// Aca entra "Salas" (#99) cuando exista, sin tocar el resto.
const TABS: MobileTab[] = [
  { to: ROUTES.MOBILE_TICKETS, icon: Ticket, labelKey: "mobile.tab.tickets" },
  {
    to: ROUTES.MOBILE_SCAN,
    icon: QrCode,
    labelKey: "mobile.tab.scan",
    also: [ROUTES.MOBILE_INCIDENT, ROUTES.MOBILE_NEW_EQUIPMENT],
  },
  { to: ROUTES.MOBILE_LOAN, icon: BookOpen, labelKey: "mobile.tab.loan" },
];

function inside(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

// Layout propio del telefono (< 768px): barra minima arriba, pestanas abajo. En
// el telefono solo existen tickets, escaneo y prestamos; cualquier otra ruta
// vuelve al inicio movil.
export function MobileLayout() {
  const { logout } = useAuth();
  const { t } = useI18n();
  const { trigger } = useHaptics();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const outlet = useOutlet();
  const online = useOnline();
  const { pending, failed, retry, discardFailed } = useOutbox();

  // Reintenta la cola offline: al montar, al volver la conexion y a la pestana
  useEffect(() => startOutbox(), []);

  if (!isMobilePath(pathname)) return <Navigate to={ROUTES.MOBILE} replace />;

  const handleLogout = () => {
    logout();
    navigate(ROUTES.LOGIN);
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header
        className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 glass-topbar"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <Link
          to={ROUTES.MOBILE}
          className="flex min-h-11 items-center gap-2 rounded-xl pr-2"
          aria-label={t("mobile.home")}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            {t("app.name")}
          </span>
        </Link>
        <div className="flex items-center gap-1">
          {pending > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void retry()}
              aria-label={t("mobile.outbox.pendingLabel", { count: pending })}
              title={t("mobile.outbox.retry")}
            >
              <CloudUpload className="h-4 w-4" />
              {pending}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            aria-label={t("topbar.logout")}
            title={t("topbar.logout")}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {!online && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <WifiOff className="h-4 w-4 shrink-0" />
          {t("mobile.offline")}
        </div>
      )}
      {failed > 0 && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{t("mobile.outbox.failed", { count: failed })}</span>
          <Button variant="ghost" size="sm" onClick={discardFailed}>
            {t("mobile.outbox.discard")}
          </Button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4">{outlet}</main>

      <nav
        aria-label={t("nav.main")}
        className="shrink-0 border-t border-border/60 glass-topbar"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="grid h-16 auto-cols-fr grid-flow-col">
          {TABS.map(({ to, icon: Icon, labelKey, also }) => {
            const active = [to, ...(also ?? [])].some((base) => inside(pathname, base));
            return (
              <NavLink
                key={to}
                to={to}
                onClick={() => trigger(30)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors select-none",
                  active ? "text-primary" : "text-muted-foreground active:opacity-50",
                )}
              >
                <Icon className="h-[22px] w-[22px]" />
                <span className="max-w-full truncate leading-none">{t(labelKey)}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
