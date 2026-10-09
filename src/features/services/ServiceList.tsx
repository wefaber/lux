import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { gql, formatDate, truncate, cn } from "@/lib/utils";
import { SERVICE_STATUS_CONFIG, SERVICE_TYPE_LABELS, ROUTES } from "@/lib/constants";
import type { ServiceRequest, ServiceStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  AnimatePresence,
} from "@/components/ui/dialog";
import { ServiceForm } from "./ServiceForm";

const SERVICES_QUERY = `
  query GetServiceRequests($requestedById: ID) {
    serviceRequests(requestedById: $requestedById) {
      id type status description labNumber softwareName equipmentId resolutionText
      requestedBy { id name }
      assignedTo { id name }
      createdAt updatedAt
    }
  }
`; // Obtencion de datos de servicio para la lista

const SERVICE_COLUMNS = [
  "ID",
  "Tipo",
  "Descripción",
  "Estado",
  "Solicitante",
  "Asignado a",
  "Fecha",
  "",
];

export function ServiceList() {
  const { user, hasRole } = useAuth(); // Verificacion de roles con Auth
  const [statusFilter, setStatusFilter] = useState<ServiceStatus | "">(""); // Obtencion de status para filtros
  // "" todos, "none" sin asignar, o el id del responsable
  const [assigneeFilter, setAssigneeFilter] = useState("");
  // ?nuevo=1 abre el formulario directo (acceso "Pedir un servicio" del inicio)
  const [searchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(() => searchParams.get("nuevo") === "1");

  const isSolicitante = !hasRole("root_admin", "admin", "tecnico");

  const { data, isLoading, refetch } = useAsync<{ serviceRequests: ServiceRequest[] }>(
    () => gql(SERVICES_QUERY, { requestedById: isSolicitante ? user?.id : undefined }),
    [isSolicitante, user?.id],
  ); // Fetch y refetch de datos

  const allServices = data?.serviceRequests ?? [];
  const assignees = [
    ...new Map(
      allServices.flatMap((s) => (s.assignedTo ? [[s.assignedTo.id, s.assignedTo]] : [])),
    ).values(),
  ].toSorted((a, b) => a.name.localeCompare(b.name));

  const services = allServices.filter(
    (s) =>
      (!statusFilter || s.status === statusFilter) &&
      (!assigneeFilter ||
        (assigneeFilter === "none" ? !s.assignedTo : s.assignedTo?.id === assigneeFilter)),
  );

  const showSkeleton = isLoading && !data; //Skeleton cuando se esta cargando y no hay informacion

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Solicitudes de Servicio
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gestión de solicitudes del instituto
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Nueva solicitud
        </Button>
      </div>

      <div className="flex gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ServiceStatus | "")}
          className="h-10 rounded-xl border border-input bg-card/50 px-3 text-sm text-foreground focus:outline-none focus:border-ring cursor-pointer"
        >
          <option value="">Todos los estados</option>
          <option value="pending">Pendiente</option>
          <option value="approved">Aprobado</option>
          <option value="in_progress">En progreso</option>
          <option value="completed">Completado</option>
          <option value="rejected">Rechazado</option>
        </select>
        {!isSolicitante && (
          <select
            aria-label="Responsable"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="h-10 rounded-xl border border-input bg-card/50 px-3 text-sm text-foreground focus:outline-none focus:border-ring cursor-pointer"
          >
            <option value="">Todos los responsables</option>
            <option value="none">Sin asignar</option>
            {user && <option value={user.id}>Asignadas a mí</option>}
            {assignees
              .filter((a) => a.id !== user?.id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        )}
      </div>

      {showSkeleton ? (
        <TableSkeleton rows={6} cols={7} />
      ) : services.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm font-medium">
          No hay solicitudes de servicio
        </div>
      ) : (
        <div
          className={cn(
            "rounded-2xl border border-border/70 overflow-x-auto bg-card/20 backdrop-blur-sm transition-all duration-300 ease-out",
            isLoading && "opacity-75 blur-xs pointer-events-none",
          )}
        >
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {SERVICE_COLUMNS.map((h) => (
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
              {services.map((s) => {
                const statusConf = SERVICE_STATUS_CONFIG[s.status];
                return (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{s.id}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                      {SERVICE_TYPE_LABELS[s.type]}
                    </td>
                    <td
                      className="px-4 py-3 text-sm text-foreground min-w-48 max-w-xs whitespace-normal"
                      title={s.description}
                    >
                      {truncate(s.description, 60)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={statusConf.color} withDot>
                        {statusConf.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                      {s.requestedBy.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                      {s.assignedTo?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(s.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`${ROUTES.SERVICES}/${s.id}`}
                        className="text-xs text-primary hover:underline font-semibold"
                      >
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* AnimatePresence propio, como en TicketList: sin el, la animacion de salida
          del dialogo queda atada a la de la pagina y, si se abrio al entrar
          (?nuevo=1), al cerrarlo la pagina entera se queda invisible */}
      <AnimatePresence>
        {createOpen && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Nueva solicitud de servicio</DialogTitle>
              </DialogHeader>
              <ServiceForm
                onSuccess={() => {
                  setCreateOpen(false);
                  refetch();
                }}
              />
            </DialogContent>
          </Dialog>
        )}
      </AnimatePresence>
    </div>
  );
}
