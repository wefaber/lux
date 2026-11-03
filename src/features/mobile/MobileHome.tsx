import { Link } from "react-router-dom";
import { BookOpen, Lock, PackageSearch, QrCode, Siren, Ticket } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import { STAFF_ROLES } from "@/lib/roles";
import type { MessageKey } from "@/i18n";
import { LanguageSwitcher } from "@/components/accessibility/LanguageSwitcher";
import { ThemeSwitcher } from "@/components/accessibility/ThemeSwitcher";

interface Shortcut {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  staffOnly: boolean;
}

const SHORTCUTS: Shortcut[] = [
  {
    to: `${ROUTES.MOBILE_SCAN}?context=inventory`,
    icon: PackageSearch,
    titleKey: "mobile.home.scanInventory",
    descriptionKey: "mobile.home.scanInventoryHelp",
    staffOnly: true,
  },
  {
    to: `${ROUTES.MOBILE_SCAN}?context=incident`,
    icon: QrCode,
    titleKey: "mobile.home.scanIncident",
    descriptionKey: "mobile.home.scanIncidentHelp",
    staffOnly: true,
  },
  {
    to: ROUTES.MOBILE_INCIDENT,
    icon: Siren,
    titleKey: "mobile.home.quickIncident",
    descriptionKey: "mobile.home.quickIncidentHelp",
    staffOnly: true,
  },
  {
    to: ROUTES.MOBILE_TICKETS,
    icon: Ticket,
    titleKey: "mobile.home.tickets",
    descriptionKey: "mobile.home.ticketsHelp",
    staffOnly: false,
  },
  {
    to: `${ROUTES.MOBILE_SCAN}?context=loan`,
    icon: BookOpen,
    titleKey: "mobile.home.scanLoan",
    descriptionKey: "mobile.home.scanLoanHelp",
    staffOnly: false,
  },
];

// Inicio de la vista telefono: accesos segun el rol. Lo que el rol no puede usar
// se ve, bloqueado y con el motivo, en vez de desaparecer.
export function MobileHome() {
  const { t } = useI18n();
  const { user, hasRole } = useAuth();
  const staff = hasRole(...STAFF_ROLES);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("mobile.home.greeting", { name: user?.name.split(" ")[0] ?? "" })}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("mobile.home.subtitle")}</p>
      </div>

      <ul className="space-y-2">
        {SHORTCUTS.map(({ to, icon: Icon, titleKey, descriptionKey, staffOnly }) => {
          const blocked = staffOnly && !staff;
          const body = (
            <>
              <span
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                  blocked ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                )}
              >
                {blocked ? <Lock className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{t(titleKey)}</span>
                <span className="block text-xs text-muted-foreground">
                  {blocked ? t("mobile.locked") : t(descriptionKey)}
                </span>
              </span>
            </>
          );
          return (
            <li key={titleKey}>
              {blocked ? (
                <div
                  aria-disabled="true"
                  className="flex min-h-16 items-center gap-3 rounded-2xl border border-border/50 bg-muted/30 p-3 opacity-70"
                >
                  {body}
                </div>
              ) : (
                <Link
                  to={to}
                  className="flex min-h-16 items-center gap-3 rounded-2xl border border-border/70 bg-card/60 p-3 active:bg-muted/60"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between pt-2">
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
    </div>
  );
}
