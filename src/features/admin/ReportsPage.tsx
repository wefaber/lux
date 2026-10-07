import { motion } from "motion/react";
import { Download, AlarmClock, Timer, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { useAsync } from "@/hooks/useSkeleton";
import { gql, formatDate } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import { ROUTES, SPRING_TRANSITION, TICKET_CATEGORY_LABELS } from "@/lib/constants";
import type { Reports } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";

const REPORTS_QUERY = `
 query GetReports {
 reports {
 overdueLoans { loanId machineId equipment user returnDate daysOverdue }
 resolution {
 resolvedCount averageHours
 byCategory { category resolvedCount averageHours }
 }
 topIncidentEquipment { equipmentId machineId equipment ticketCount openCount }
 }
 }
`;

function formatHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 48) return `${hours.toLocaleString("es-UY")} h`;
  return `${(Math.round((hours / 24) * 10) / 10).toLocaleString("es-UY")} días`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const TH =
  "px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground";
const TD = "px-4 py-3 text-sm text-muted-foreground";

function ReportCard({
  icon: Icon,
  title,
  subtitle,
  onExport,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  onExport: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Icon className="h-4 w-4 mt-1 text-primary" />
            <div>
              <CardTitle>{title}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={onExport}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ReportsPage() {
  const { data, isLoading, error } = useAsync<{ reports: Reports }>(() => gql(REPORTS_QUERY), []);
  const reports = data?.reports;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Reportes</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Datos para decidir sobre préstamos, soporte y reposición de equipos
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          Error al cargar reportes: {error}
        </div>
      )}

      {isLoading && !reports ? (
        <TableSkeleton rows={6} cols={4} />
      ) : (
        reports && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING_TRANSITION}
            className="space-y-6"
          >
            <ReportCard
              icon={AlarmClock}
              title={`Préstamos vencidos (${reports.overdueLoans.length})`}
              subtitle="Equipos entregados que no volvieron en fecha, del más atrasado al menos"
              onExport={() =>
                downloadCsv(`lux-prestamos-vencidos-${today()}.csv`, [
                  [
                    "Préstamo",
                    "ID de máquina",
                    "Equipo",
                    "Usuario",
                    "Vencimiento",
                    "Días de atraso",
                  ],
                  ...reports.overdueLoans.map((l) => [
                    l.loanId,
                    l.machineId,
                    l.equipment,
                    l.user,
                    formatDate(l.returnDate),
                    l.daysOverdue,
                  ]),
                ])
              }
            >
              {reports.overdueLoans.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay préstamos vencidos.</p>
              ) : (
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        {["Equipo", "Usuario", "Vencimiento", "Atraso"].map((h) => (
                          <th key={h} className={TH}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reports.overdueLoans.map((l) => (
                        <tr key={l.loanId} className="border-b border-border last:border-0">
                          <td className="px-4 py-3">
                            <p className="text-sm font-semibold text-foreground">{l.equipment}</p>
                            <p className="text-xs font-mono text-muted-foreground">{l.machineId}</p>
                          </td>
                          <td className={TD}>{l.user}</td>
                          <td className={TD}>{formatDate(l.returnDate)}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-destructive">
                            {l.daysOverdue} días
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ReportCard>

            <ReportCard
              icon={Timer}
              title="Tiempo promedio de resolución"
              subtitle={`${reports.resolution.resolvedCount} tickets resueltos · promedio general ${formatHours(reports.resolution.averageHours)}`}
              onExport={() =>
                downloadCsv(`lux-tiempo-resolucion-${today()}.csv`, [
                  ["Categoría", "Tickets resueltos", "Promedio (horas)"],
                  ...reports.resolution.byCategory.map((c) => [
                    TICKET_CATEGORY_LABELS[c.category],
                    c.resolvedCount,
                    c.averageHours?.toLocaleString("es-UY") ?? "",
                  ]),
                  [
                    "Total",
                    reports.resolution.resolvedCount,
                    reports.resolution.averageHours?.toLocaleString("es-UY") ?? "",
                  ],
                ])
              }
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {reports.resolution.byCategory.map((c) => (
                  <div key={c.category} className="rounded-xl border border-border/70 p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                      {TICKET_CATEGORY_LABELS[c.category]}
                    </p>
                    <p className="text-2xl font-bold tracking-tight text-foreground mt-1">
                      {formatHours(c.averageHours)}
                    </p>
                    <p className="text-xs text-muted-foreground">{c.resolvedCount} resueltos</p>
                  </div>
                ))}
              </div>
            </ReportCard>

            <ReportCard
              icon={Wrench}
              title="Equipos con más incidentes"
              subtitle="Candidatos a revisión preventiva o reposición"
              onExport={() =>
                downloadCsv(`lux-equipos-incidentes-${today()}.csv`, [
                  ["ID de máquina", "Equipo", "Tickets", "Abiertos"],
                  ...reports.topIncidentEquipment.map((e) => [
                    e.machineId,
                    e.equipment,
                    e.ticketCount,
                    e.openCount,
                  ]),
                ])
              }
            >
              {reports.topIncidentEquipment.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ningún equipo tiene tickets.</p>
              ) : (
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        {["Equipo", "Tickets", "Abiertos"].map((h) => (
                          <th key={h} className={TH}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reports.topIncidentEquipment.map((e) => (
                        <tr key={e.equipmentId} className="border-b border-border last:border-0">
                          <td className="px-4 py-3">
                            <Link
                              to={`${ROUTES.INVENTORY}/${e.equipmentId}`}
                              className="text-sm font-semibold text-foreground hover:underline"
                            >
                              {e.equipment}
                            </Link>
                            <p className="text-xs font-mono text-muted-foreground">{e.machineId}</p>
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-foreground">
                            {e.ticketCount}
                          </td>
                          <td className={TD}>{e.openCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ReportCard>
          </motion.div>
        )
      )}
    </div>
  );
}
