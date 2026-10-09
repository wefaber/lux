import { Link } from "react-router-dom";
import { Ticket, Wrench, CalendarClock, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAsync } from "@/hooks/useSkeleton";
import { gql } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import type { DashboardStats } from "@/lib/types";
import { CardSkeleton } from "@/components/skeletons/CardSkeleton";
import { MetricCard } from "./MetricCard";
import { EquipmentOverview } from "./EquipmentOverview";

// El servidor ya recorta estas cifras a lo del propio solicitante
const MY_STATS_QUERY = `
  query GetDashboardStats {
    dashboardStats { openTickets pendingServices }
  }
`;

const QUICK_ACTIONS = [
  {
    icon: Ticket,
    title: "Reportar un problema",
    detail: "Abrir un ticket a la mesa de ayuda",
    to: `${ROUTES.TICKETS}?nuevo=1`,
    color: "rgb(255,159,10)",
  },
  {
    icon: Wrench,
    title: "Pedir un servicio",
    detail: "Equipos, software o preparación de laboratorio",
    to: `${ROUTES.SERVICES}?nuevo=1`,
    color: "rgb(0,122,255)",
  },
  {
    icon: CalendarClock,
    title: "Reservar un equipo o espacio",
    detail: "Un proyector, una PC o un laboratorio para una fecha",
    to: `${ROUTES.RESERVATIONS}?nuevo=1`,
    color: "rgb(52,199,89)",
  },
];

// Inicio del usuario final: no es un tablero del sistema sino su punto de
// partida. Arriba lo que va a hacer y lo suyo; abajo, el estado de los equipos.
export function RequesterHome() {
  const { user } = useAuth();
  const { data, isLoading, error } = useAsync<{ dashboardStats: DashboardStats }>(
    () => gql(MY_STATS_QUERY),
    [],
  );
  const stats = data?.dashboardStats;

  return (
    <div className="space-y-8 max-w-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Buenos días, {user?.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Tus pedidos y el estado de los equipos · ITI CETP
        </p>
      </div>

      <section aria-label="Accesos rápidos" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </section>

      {isLoading && !stats ? (
        <CardSkeleton count={2} />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          Error al cargar tu actividad: {error}
        </div>
      ) : (
        <section aria-label="Tu actividad" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <MetricCard
            icon={Ticket}
            label="Mis tickets abiertos"
            value={stats?.openTickets ?? 0}
            color="rgb(255,159,10)"
            to={ROUTES.TICKETS}
          />
          <MetricCard
            icon={Wrench}
            label="Mis solicitudes pendientes"
            value={stats?.pendingServices ?? 0}
            color="rgb(255,69,58)"
            to={ROUTES.SERVICES}
          />
        </section>
      )}

      <EquipmentOverview />
    </div>
  );
}
