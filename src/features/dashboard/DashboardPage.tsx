import { useState } from "react";
import { Package, Ticket, BookOpen, Wrench, TrendingUp, Download } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAsync } from "@/hooks/useSkeleton";
import { useI18n } from "@/hooks/useI18n";
import { gql, cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import {
  DASHBOARD_PERIODS,
  DASHBOARD_PERIOD_LABELS,
  STATUS_COLOR_VAR,
  TICKET_STATUS_CONFIG,
  type DashboardPeriod,
} from "@/lib/constants";
import type { DashboardStats, TicketStatus } from "@/lib/types";
import { LuxPieChart } from "@/components/charts/PieChart";
import { LuxBarChart } from "@/components/charts/BarChart";
import { CardSkeleton, ChartSkeleton } from "@/components/skeletons/CardSkeleton";
import { Button } from "@/components/ui/button";
import { isStaff, ADMIN_ROLES } from "@/lib/roles";
import { MetricCard } from "./MetricCard";
import { WorkQueue } from "./WorkQueue";
import { RequesterHome } from "./RequesterHome";
import { OptionSelect } from "@/components/ui/option-select";

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

// Vista dividida por rol: el personal del area ve el tablero del sistema y su
// carga de trabajo; el usuario final, su inicio.
export function DashboardPage() {
  const { user } = useAuth();
  return isStaff(user?.role) ? <StaffDashboard /> : <RequesterHome />;
}

function StaffDashboard() {
  const { user, hasRole } = useAuth();
  const { t } = useI18n();
  const [period, setPeriod] = useState<DashboardPeriod>("7d"); // Periodo del grafico de solicitudes
  const { data, isLoading, error } = useAsync<{ dashboardStats: DashboardStats }>(
    () => gql(DASHBOARD_QUERY, { period }),
    [period],
  ); // Obtencion de datos con la API mediante async

  const stats = data?.dashboardStats; // Seteo de variable con informacion de estadisticas del dashboard (si existe)

  const pieData =
    stats?.ticketsByStatus.map((ts) => ({
      name: TICKET_STATUS_CONFIG[ts.status as TicketStatus].label,
      value: ts.count,
      color: STATUS_COLOR_VAR[TICKET_STATUS_CONFIG[ts.status as TicketStatus].color],
    })) ?? []; // Informacion de la grafica Pie

  const barData =
    stats?.servicesByPeriod.map((s) => ({
      label: s.date.slice(5),
      value: s.count,
    })) ?? []; // Informacion de la grafica de barras

  const handleExport = () => {
    if (!stats) return;
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`${t("dashboard.csv.file")}-${period}-${today}.csv`, [
      [t("dashboard.csv.metric"), t("dashboard.csv.value")],
      [t("dashboard.metric.equipment"), stats.totalEquipment],
      [t("dashboard.metric.openTickets"), stats.openTickets],
      [t("dashboard.metric.activeLoans"), stats.activeLoans],
      [t("dashboard.metric.pendingServices"), stats.pendingServices],
      [],
      [t("dashboard.csv.ticketsByStatus"), t("dashboard.csv.count")],
      ...stats.ticketsByStatus.map((ts) => [TICKET_STATUS_CONFIG[ts.status].label, ts.count]),
      [],
      [
        t("dashboard.csv.services", { period: DASHBOARD_PERIOD_LABELS[period] }),
        t("dashboard.csv.count"),
      ],
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
            {t("dashboard.greeting", { name: user?.name.split(" ")[0] ?? "" })}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("dashboard.staff.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <OptionSelect
            aria-label={t("dashboard.period")}
            size="sm"
            value={period}
            onValueChange={(v) => setPeriod(v as DashboardPeriod)}
            options={DASHBOARD_PERIODS.map((p) => ({
              value: p,
              label: DASHBOARD_PERIOD_LABELS[p],
            }))}
          />
          {hasRole(...ADMIN_ROLES) && (
            <Button variant="secondary" size="sm" onClick={handleExport} disabled={!stats}>
              <Download className="h-3.5 w-3.5" />
              {t("dashboard.exportCsv")}
            </Button>
          )}
        </div>
      </div>

      {stats?.workQueue && <WorkQueue queue={stats.workQueue} />}

      {isInitialLoading ? (
        <CardSkeleton count={4} />
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {t("dashboard.loadError", { error })}
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
            label={t("dashboard.metric.equipment")}
            value={stats?.totalEquipment ?? 0}
            color="rgb(0,122,255)"
          />
          <MetricCard
            icon={Ticket}
            label={t("dashboard.metric.openTickets")}
            value={stats?.openTickets ?? 0}
            color="rgb(255,159,10)"
          />
          <MetricCard
            icon={BookOpen}
            label={t("dashboard.metric.activeLoans")}
            value={stats?.activeLoans ?? 0}
            color="rgb(52,199,89)"
          />
          <MetricCard
            icon={Wrench}
            label={t("dashboard.metric.pendingServices")}
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
            <LuxPieChart data={pieData} title={t("dashboard.chart.ticketsByStatus")} />
            <LuxBarChart
              data={barData}
              title={t("dashboard.chart.services", { period: DASHBOARD_PERIOD_LABELS[period] })}
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
            <p className="text-sm font-semibold text-foreground">{t("dashboard.systemState")}</p>
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
