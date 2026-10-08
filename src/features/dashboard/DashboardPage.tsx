import { useState } from "react";
import { Package, Ticket, BookOpen, Wrench, TrendingUp, Download } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAsync } from "@/hooks/useSkeleton";
import { gql, cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import {
  DASHBOARD_PERIODS,
  DASHBOARD_PERIOD_LABELS,
  TICKET_STATUS_CONFIG,
  type DashboardPeriod,
} from "@/lib/constants";
import type { DashboardStats, TicketStatus } from "@/lib/types";
import { LuxPieChart } from "@/components/charts/PieChart";
import { LuxBarChart } from "@/components/charts/BarChart";
import { CardSkeleton, ChartSkeleton } from "@/components/skeletons/CardSkeleton";
import { Button } from "@/components/ui/button";
import { isStaff } from "@/lib/roles";
import { MetricCard } from "./MetricCard";
import { WorkQueue } from "./WorkQueue";
import { RequesterHome } from "./RequesterHome";

const DASHBOARD_QUERY = `
 query GetDashboardStats($period: String) {
 dashboardStats(period: $period) {
 totalEquipment
 openTickets
 activeLoans
 pendingServices
 ticketsByStatus { status count }
 servicesByPeriod { date count }
 workQueue { unassignedTickets ticketsInProgress pendingServices overdueLoans equipmentInRepair }
 }
 }
`;

const TICKET_COLORS: Record<TicketStatus, string> = {
  pending: "rgb(255,159,10)",
  in_progress: "rgb(0,122,255)",
  in_resolution: "rgb(255,159,10)",
  resolved: "rgb(52,199,89)",
}; // Seteo de colores de tickets

// Vista dividida por rol: el personal del area ve el tablero del sistema y su
// carga de trabajo; el usuario final, su inicio.
export function DashboardPage() {
  const { user } = useAuth();
  return isStaff(user?.role) ? <StaffDashboard /> : <RequesterHome />;
}

function StaffDashboard() {
  const { user, hasRole } = useAuth();
  const [period, setPeriod] = useState<DashboardPeriod>("7d"); // Periodo del grafico de solicitudes
  const { data, isLoading, error } = useAsync<{ dashboardStats: DashboardStats }>(
    () => gql(DASHBOARD_QUERY, { period }),
    [period],
  ); // Obtencion de datos con la API mediante async

  const stats = data?.dashboardStats; // Seteo de variable con informacion de estadisticas del dashboard (si existe)

  const pieData =
    stats?.ticketsByStatus.map((t) => ({
      name: TICKET_STATUS_CONFIG[t.status as TicketStatus].label,
      value: t.count,
      color: TICKET_COLORS[t.status as TicketStatus],
    })) ?? []; // Informacion de la grafica Pie

  const barData =
    stats?.servicesByPeriod.map((s) => ({
      label: s.date.slice(5),
      value: s.count,
    })) ?? []; // Informacion de la grafica de barras

  const handleExport = () => {
    if (!stats) return;
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`lux-dashboard-${period}-${today}.csv`, [
      ["Métrica", "Valor"],
      ["Equipos totales", stats.totalEquipment],
      ["Tickets abiertos", stats.openTickets],
      ["Préstamos activos", stats.activeLoans],
      ["Solicitudes pendientes", stats.pendingServices],
      [],
      ["Tickets por estado", "Cantidad"],
      ...stats.ticketsByStatus.map((t) => [TICKET_STATUS_CONFIG[t.status].label, t.count]),
      [],
      [`Solicitudes de servicio (${DASHBOARD_PERIOD_LABELS[period]})`, "Cantidad"],
      ...stats.servicesByPeriod.map((s) => [s.date, s.count]),
    ]);
  };

  // Show full skeletons ONLY on first load (when we don't have stats yet)
  const isInitialLoading = isLoading && !stats;

  return (
    <div className="space-y-8 max-w-full">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Buenos días, {user?.name.split(" ")[0]}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Resumen del sistema · ITI CETP
          </p>
        </div>
        <div className="flex gap-2">
          <select
            aria-label="Período"
            value={period}
            onChange={(e) => setPeriod(e.target.value as DashboardPeriod)}
            className="h-8 rounded-lg border border-input bg-card/50 px-3 text-xs text-foreground focus:outline-none focus:border-ring cursor-pointer"
          >
            {DASHBOARD_PERIODS.map((p) => (
              <option key={p} value={p}>
                {DASHBOARD_PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
          {hasRole("root_admin", "admin") && (
            <Button variant="secondary" size="sm" onClick={handleExport} disabled={!stats}>
              <Download className="h-3.5 w-3.5" />
              Exportar CSV
            </Button>
          )}
        </div>
      </div>

      {stats?.workQueue && <WorkQueue queue={stats.workQueue} />}

      {isInitialLoading ? (
        <CardSkeleton count={4} />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          Error al cargar estadísticas: {error}
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 transition-all duration-300 ease-out",
            isLoading && "opacity-75 blur-xs pointer-events-none",
          )}
        >
          <MetricCard
            icon={Package}
            label="Equipos totales"
            value={stats?.totalEquipment ?? 0}
            color="rgb(0,122,255)"
          />
          <MetricCard
            icon={Ticket}
            label="Tickets abiertos"
            value={stats?.openTickets ?? 0}
            color="rgb(255,159,10)"
          />
          <MetricCard
            icon={BookOpen}
            label="Préstamos activos"
            value={stats?.activeLoans ?? 0}
            color="rgb(52,199,89)"
          />
          <MetricCard
            icon={Wrench}
            label="Solicitudes pendientes"
            value={stats?.pendingServices ?? 0}
            color="rgb(255,69,58)"
          />
        </div>
      )}

      {isInitialLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : (
        !error &&
        pieData.length > 0 && (
          <div
            className={cn(
              "grid grid-cols-1 lg:grid-cols-2 gap-4 transition-all duration-300 ease-out",
              isLoading && "opacity-75 blur-xs pointer-events-none",
            )}
          >
            <LuxPieChart data={pieData} title="Tickets por estado" />
            <LuxBarChart
              data={barData}
              title={`Solicitudes de servicio · ${DASHBOARD_PERIOD_LABELS[period]}`}
              color="rgb(0,122,255)"
            />
          </div>
        )
      )}

      {!isInitialLoading && !error && stats && (
        <div
          className={cn(
            "rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-6 transition-all duration-300 ease-out",
            isLoading && "opacity-75 blur-xs pointer-events-none",
          )}
        >
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">Estado del sistema</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {pieData.map((item) => (
              <div key={item.name} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{item.name}</span>
                  <span className="text-xs font-semibold text-foreground">{item.value}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min((item.value / Math.max(stats?.openTickets ?? 1, 1)) * 100, 100)}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
