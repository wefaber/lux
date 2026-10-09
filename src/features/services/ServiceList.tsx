import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
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
import { OptionSelect } from "@/components/ui/option-select";
import { Input } from "@/components/ui/input";
import { Pagination, clampPage } from "@/components/ui/pagination";
import { PinMark, pinRowClass } from "@/components/ui/pin";
import { idQuery, pinnedFirst, servicePin } from "@/lib/pins";

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

// Solicitudes por pagina
const PAGE_SIZE = 10;
// Ya cerradas: el staff no las ve en el dia a dia
const CLOSED_STATUSES = new Set<ServiceStatus>(["completed", "rejected"]);

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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
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

  const term = search.trim().toLowerCase();
  const idTerm = idQuery(term, "svc");
  const matchesId = (s: ServiceRequest) => idTerm !== null && s.id.toLowerCase().includes(idTerm);
  const pin = (s: ServiceRequest) => servicePin(s, user?.id);

  const matching = allServices.filter(
    (s) =>
      (!term ||
        matchesId(s) ||
        s.description.toLowerCase().includes(term) ||
        SERVICE_TYPE_LABELS[s.type].toLowerCase().includes(term) ||
        s.requestedBy.name.toLowerCase().includes(term)) &&
      (!statusFilter || s.status === statusFilter) &&
      (!assigneeFilter ||
        (assigneeFilter === "none" ? !s.assignedTo : s.assignedTo?.id === assigneeFilter)),
  );

  // Como en tickets: al staff las completadas y rechazadas no le aparecen salvo
  // que filtre por estado o las busque por su ID. El solicitante ve todas las
  // suyas. Lo asignado a uno queda fijado arriba
  const hideClosed = !isSolicitante && !statusFilter;
  const services = pinnedFirst(
    hideClosed ? matching.filter((s) => !CLOSED_STATUSES.has(s.status) || matchesId(s)) : matching,
    pin,
  );
  const hiddenClosed = matching.length - services.length;

  const current = clampPage(page, services.length, PAGE_SIZE);
  const visible = services.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

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

      <div className="space-y-2">
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por descripción, tipo o ID (svc-004)..."
              aria-label="Buscar solicitudes por descripción, tipo o ID"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="pl-9"
            />
          </div>
          <OptionSelect
            aria-label="Filtrar por estado"
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as ServiceStatus | "");
              setPage(0);
            }}
            options={[
              { value: "", label: "Todos los estados" },
              ...Object.entries(SERVICE_STATUS_CONFIG).map(([value, conf]) => ({
                value,
                label: conf.label,
              })),
            ]}
          />
          {!isSolicitante && (
            <OptionSelect
              aria-label="Responsable"
              value={assigneeFilter}
              onValueChange={(v) => {
                setAssigneeFilter(v);
                setPage(0);
              }}
              options={[
                { value: "", label: "Todos los responsables" },
                { value: "none", label: "Sin asignar" },
                ...(user ? [{ value: user.id, label: "Asignadas a mí" }] : []),
                ...assignees
                  .filter((a) => a.id !== user?.id)
                  .map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          )}
        </div>

        {hiddenClosed > 0 && (
          <p className="text-xs text-muted-foreground">
            {hiddenClosed === 1
              ? "1 solicitud completada o rechazada no se muestra."
              : `${hiddenClosed} solicitudes completadas o rechazadas no se muestran.`}{" "}
            Para verlas, filtrá por estado o buscalas por su ID.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {showSkeleton ? (
          <TableSkeleton rows={6} cols={7} />
        ) : services.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm font-medium">
            {hiddenClosed > 0 ? "No hay solicitudes abiertas" : "No hay solicitudes de servicio"}
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
                {visible.map((s) => {
                  const statusConf = SERVICE_STATUS_CONFIG[s.status];
                  const pinState = pin(s);
                  return (
                    <tr
                      key={s.id}
                      className={cn(
                        "border-b border-border last:border-0 transition-colors",
                        pinRowClass(pinState),
                      )}
                    >
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        <PinMark state={pinState} />
                        {s.id}
                      </td>
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

        <Pagination page={current} pageSize={PAGE_SIZE} total={services.length} onPageChange={setPage} />
      </div>

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
