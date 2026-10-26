import { useState } from "react";
import { motion } from "motion/react";
import { Search } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useI18n } from "@/hooks/useI18n";
import { gql, formatDateTime } from "@/lib/utils";
import { dictionaryFor, getLang, translate, type MessageKey } from "@/i18n";
import { SPRING_TRANSITION } from "@/lib/constants";
import type { ActivityLog as ActivityLogType } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { useDateRangeParams } from "@/hooks/useDateRangeParams";
import type { StatusColor } from "@/lib/constants";

const LOGS_QUERY = `
 query GetActivityLogs($userId: ID, $operation: String, $startDate: String, $endDate: String) {
 activityLogs(userId: $userId, operation: $operation, startDate: $startDate, endDate: $endDate) {
 id userId userName operation entity entityId timestamp details
 }
 }
`; // Query de logs

const OP_COLORS: Record<string, StatusColor> = {
  CREATE_USER: "success",
  UPDATE_USER: "info",
  DELETE_USER: "destructive",
  CREATE_PRODUCT: "success",
  UPDATE_PRODUCT: "info",
  CREATE_TICKET: "info",
  ASSIGN_TICKET: "warning",
  RESOLVE_TICKET: "success",
  CREATE_LOAN: "info",
  APPROVE_LOAN: "success",
  RETURN_LOAN: "success",
  CREATE_SERVICE: "info",
  UPDATE_SERVICE: "warning",
  LOGIN: "muted",
}; // Colores de logs

// Operaciones y entidades son codigos del sistema: se muestran con su nombre en
// el idioma activo y, si aparece uno nuevo que no esta en el diccionario, tal cual
function codeLabel(prefix: "activity.op." | "activity.entity.", code: string): string {
  const key = `${prefix}${code}`;
  const dictionary = dictionaryFor(getLang());
  if (key in dictionary) return dictionary[key as MessageKey];
  // Un intento rechazado por permisos se registra como `<OPERACION>_DENIED`
  if (prefix === "activity.op." && code.endsWith(DENIED_SUFFIX)) {
    return translate(getLang(), "activity.denied", {
      op: codeLabel(prefix, code.slice(0, -DENIED_SUFFIX.length)),
    });
  }
  return code;
}

const DENIED_SUFFIX = "_DENIED";

// Las operaciones rechazadas y los fallos de acceso se destacan; el resto sigue el mapa
function opColor(operation: string): StatusColor {
  if (operation.endsWith(DENIED_SUFFIX) || operation === "LOGIN_FAILED") return "destructive";
  if (operation === "ACCOUNT_LOCKED") return "warning";
  return OP_COLORS[operation] ?? "muted";
}

// Los detalles generados por el sistema ("Operación X en Y") siguen la misma
// ruta; cualquier otro texto de la API se muestra sin tocar
const GENERIC_DETAILS = /^Operación (\S+) en (\S+)$/;

export function ActivityLog() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  // La API ya acepta startDate/endDate: el rango se manda al servidor y queda
  // en la URL para poder recargar o compartir la consulta
  const { range: dateRange, setRange: setDateRange, active: dateActive, bounds } =
    useDateRangeParams();

  const details = (text: string | null): string => {
    if (!text) return "—";
    const generic = GENERIC_DETAILS.exec(text);
    if (!generic) return text;
    return t("admin.logs.genericDetails", {
      op: codeLabel("activity.op.", generic[1]),
      entity: codeLabel("activity.entity.", generic[2]),
    });
  };

  const { data, isLoading } = useAsync<{ activityLogs: ActivityLogType[] }>(
    () =>
      gql(LOGS_QUERY, {
        startDate: bounds?.startDate,
        endDate: bounds?.endDate,
      }),
    [bounds?.startDate, bounds?.endDate],
  );

  const logs = (data?.activityLogs ?? []).filter(
    (l) =>
      !search ||
      l.userName.toLowerCase().includes(search.toLowerCase()) ||
      l.operation.toLowerCase().includes(search.toLowerCase()) ||
      codeLabel("activity.op.", l.operation).toLowerCase().includes(search.toLowerCase()) ||
      l.entity.toLowerCase().includes(search.toLowerCase()) ||
      codeLabel("activity.entity.", l.entity).toLowerCase().includes(search.toLowerCase()),
  ); // Filtrado de informacion

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("admin.logs.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("admin.logs.subtitle")}</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("admin.logs.search")}
            aria-label={t("admin.logs.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {isLoading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {dateActive ? t("filters.emptyRange") : t("common.noData")}
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-x-auto bg-card/20 backdrop-blur-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {[
                  t("admin.logs.col.timestamp"),
                  t("label.user"),
                  t("admin.logs.col.operation"),
                  t("admin.logs.col.entity"),
                  t("label.id"),
                  t("admin.logs.col.details"),
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <motion.tr
                  key={l.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...SPRING_TRANSITION, delay: i * 0.01 }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTime(l.timestamp)}
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">{l.userName}</td>
                  <td className="px-4 py-3">
                    <Badge color={opColor(l.operation)} className="text-[10px]">
                      {codeLabel("activity.op.", l.operation)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {codeLabel("activity.entity.", l.entity)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                    {l.entityId}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground min-w-48 max-w-xs whitespace-normal">
                    {details(l.details)}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
