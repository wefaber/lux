import { useState } from "react";
import { motion } from "motion/react";
import { Search } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { gql, formatDateTime } from "@/lib/utils";
import { SPRING_TRANSITION } from "@/lib/constants";
import type { ActivityLog as ActivityLogType } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";

const LOGS_QUERY = `
 query GetActivityLogs($userId: ID, $operation: String) {
 activityLogs(userId: $userId, operation: $operation) {
 id userId userName operation entity entityId timestamp details
 }
 }
`; // Query de logs

const OP_COLORS: Record<string, "success" | "info" | "warning" | "destructive" | "muted"> = {
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

export function ActivityLog() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useAsync<{ activityLogs: ActivityLogType[] }>(
    () => gql(LOGS_QUERY),
    [],
  );

  const logs = (data?.activityLogs ?? []).filter(
    (l) =>
      !search ||
      l.userName.toLowerCase().includes(search.toLowerCase()) ||
      l.operation.toLowerCase().includes(search.toLowerCase()) ||
      l.entity.toLowerCase().includes(search.toLowerCase()),
  ); // Filtrado de informacion 

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Registro de Actividad
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Historial de acciones en el sistema</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por usuario, operación..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
        <div className="rounded-2xl border border-border overflow-x-auto bg-card/20 backdrop-blur-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Timestamp", "Usuario", "Operación", "Entidad", "ID", "Detalles"].map((h) => (
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
                    <Badge color={OP_COLORS[l.operation] ?? "muted"} className="text-[10px]">
                      {l.operation}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{l.entity}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                    {l.entityId}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground min-w-48 max-w-xs whitespace-normal">
                    {l.details ?? "—"}
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
