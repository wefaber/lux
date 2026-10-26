import { Link } from "react-router-dom";
import { Ticket, Wrench, CalendarClock, ChevronRight, Star } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAsync } from "@/hooks/useSkeleton";
import { useI18n } from "@/hooks/useI18n";
import type { MessageKey } from "@/i18n";
import { gql, formatNumber } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import type { DashboardStats } from "@/lib/types";
import { CardSkeleton } from "@/components/skeletons/CardSkeleton";
import { MetricCard } from "./MetricCard";
import { RequesterTickets } from "./RequesterTickets";
import { RequesterEstimates } from "./RequesterEstimates";
import { RequesterAreas } from "./RequesterAreas";

// El servidor ya recorta estas cifras a lo del propio solicitante: su actividad,
// los promedios del area y las areas que usa. Nada del estado global del sistema
const MY_STATS_QUERY = `
  query GetDashboardStats {
    dashboardStats {
      openTickets
      pendingServices
      requesterOverview {
        activeTickets { id title category status updatedAt }
        estimates {
          toAttendHours
          toResolveHours
          sampleSize
          byCategory { category toAttendHours toResolveHours sampleSize }
        }
        satisfaction { average count }
        areas {
          available
          inUse
          inRepair
          retired
          openTickets
          location { id kind name code productCount }
        }
      }
    }
  }
`;

const QUICK_ACTIONS: Array<{
  icon: typeof Ticket;
  title: MessageKey;
  detail: MessageKey;
  to: string;
  color: string;
}> = [
  {
    icon: Ticket,
    title: "home.quick.ticket",
    detail: "home.quick.ticketDetail",
    to: `${ROUTES.TICKETS}?nuevo=1`,
    color: "rgb(255,159,10)",
  },
  {
    icon: Wrench,
    title: "home.quick.service",
    detail: "home.quick.serviceDetail",
    to: `${ROUTES.SERVICES}?nuevo=1`,
    color: "rgb(0,122,255)",
  },
  {
    icon: CalendarClock,
    title: "home.quick.reservation",
    detail: "home.quick.reservationDetail",
    to: `${ROUTES.RESERVATIONS}?nuevo=1`,
    color: "rgb(52,199,89)",
  },
];

// Inicio del usuario final: no es un tablero del sistema sino su punto de
// partida. Arriba lo que va a hacer, despues lo suyo y los lugares que usa.
export function RequesterHome() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { data, isLoading, error } = useAsync<{ dashboardStats: DashboardStats }>(
    () => gql(MY_STATS_QUERY),
    [],
  );
  const stats = data?.dashboardStats;
  const overview = stats?.requesterOverview;
  const satisfaction = overview?.satisfaction;
  const average = satisfaction?.average ?? null;

  return (
    <div className="space-y-8 max-w-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("dashboard.greeting", { name: user?.name.split(" ")[0] ?? "" })}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("home.subtitle")}</p>
      </div>

      <section
        aria-label={t("home.quick")}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {QUICK_ACTIONS.map(({ icon: Icon, title, detail, to, color }) => (
          <Link
            key={title}
            to={to}
            className="group flex items-center gap-4 rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-5 transition-all duration-300 hover:border-primary/20 hover:bg-card/75 hover:shadow-md hover:-translate-y-[2px]"
          >
            <div
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${color}12` }}
            >
              <Icon className="h-5 w-5" style={{ color }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{t(title)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t(detail)}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </section>

      {isLoading && !stats ? (
        <CardSkeleton count={3} />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {t("home.loadError", { error })}
        </div>
      ) : (
        overview && (
          <>
            <section
              aria-label={t("home.activity")}
              className="grid grid-cols-1 sm:grid-cols-3 gap-4"
            >
              <MetricCard
                icon={Ticket}
                label={t("home.myTickets")}
                value={stats?.openTickets ?? 0}
                color="rgb(255,159,10)"
                to={ROUTES.TICKETS}
              />
              <MetricCard
                icon={Wrench}
                label={t("home.myServices")}
                value={stats?.pendingServices ?? 0}
                color="rgb(255,69,58)"
                to={ROUTES.SERVICES}
              />
              <MetricCard
                icon={Star}
                label={t("home.satisfaction")}
                value={
                  average === null
                    ? "—"
                    : formatNumber(average, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })
                }
                hint={
                  satisfaction && satisfaction.count > 0
                    ? t("home.satisfactionHint", { count: satisfaction.count })
                    : t("home.satisfactionEmpty")
                }
                color="rgb(255,159,10)"
              />
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <RequesterTickets tickets={overview.activeTickets} />
              </div>
              <RequesterEstimates estimates={overview.estimates} />
            </div>

            <RequesterAreas areas={overview.areas} />
          </>
        )
      )}
    </div>
  );
}
