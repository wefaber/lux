import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useNotices } from "@/hooks/useNotices";
import { useI18n } from "@/hooks/useI18n";
import { gql, formatDate, truncate, cn } from "@/lib/utils";
import {
  SERVICE_STATUS_CONFIG,
  SERVICE_TYPE_LABELS,
  ROUTES,
  CLOSED_SERVICE_STATUSES,
} from "@/lib/constants";
import type { ServiceRequest, ServiceStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  AnimatePresence,
} from "@/components/ui/dialog";
import { ServiceForm } from "./ServiceForm";
import { OptionSelect } from "@/components/ui/option-select";
import { StatusFilter } from "@/components/ui/status-filter";
import { Input } from "@/components/ui/input";
import { Pagination, clampPage } from "@/components/ui/pagination";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { useDateRangeParams } from "@/hooks/useDateRangeParams";
import { NoticeLine, PinMark, pinRowClass } from "@/components/ui/pin";
import { idQuery, pinnedFirst, servicePin } from "@/lib/pins";
import { STAFF_ROLES } from "@/lib/roles";
import type { MessageKey } from "@/i18n";

const SERVICES_QUERY = `
  query GetServiceRequests($requestedById: ID, $startDate: String, $endDate: String) {
    serviceRequests(requestedById: $requestedById, startDate: $startDate, endDate: $endDate) {
      id type status description labNumber softwareName equipmentId resolutionText
      requestedBy { id name }
      assignedTo { id name }
      createdAt updatedAt
    }
  }
`; // Obtencion de datos de servicio para la lista

// Solicitudes por pagina
const PAGE_SIZE = 10;

const SERVICE_COLUMNS: Array<MessageKey | null> = [
  "label.id",
  "label.type",
  "label.description",
  "label.status",
  "label.requester",
  "label.assignedTo",
  "label.date",
  null,
];

export function ServiceList() {
  const { t } = useI18n();
  const { user, hasRole } = useAuth(); // Verificacion de roles con Auth
  const { noticeFor } = useNotices();
  const [statusFilter, setStatusFilter] = useState<ServiceStatus | "">(""); // Obtencion de status para filtros
  // "" todos, el id propio (asignadas a mi) o "none" sin asignar
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  // Rango por fecha de creacion de la solicitud, reflejado en la URL
  const { range: dateRange, setRange: setDateRange, active: dateActive, bounds } =
    useDateRangeParams();
  // ?nuevo=1 abre el formulario directo (acceso "Pedir un servicio" del inicio)
  const [searchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(() => searchParams.get("nuevo") === "1");

  const isSolicitante = !hasRole(...STAFF_ROLES);

  const { data, isLoading, refetch } = useAsync<{ serviceRequests: ServiceRequest[] }>(
    () =>
      gql(SERVICES_QUERY, {
        requestedById: isSolicitante ? user?.id : undefined,
        startDate: bounds?.startDate,
        endDate: bounds?.endDate,
      }),
    [isSolicitante, user?.id, bounds?.startDate, bounds?.endDate],
  ); // Fetch y refetch de datos

  const allServices = data?.serviceRequests ?? [];
  const term = search.trim().toLowerCase();
  const idTerm = idQuery(term, "svc");
  const matchesId = (s: ServiceRequest) => idTerm !== null && s.id.toLowerCase().includes(idTerm);
  const pin = (s: ServiceRequest) => servicePin(s, user?.id, !!noticeFor("service_request", s.id));

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
  // que filtre por estado o las busque por su ID (o tengan un aviso sin ver). El
  // solicitante ve todas las suyas. Lo asignado a uno queda fijado arriba
  const hideClosed = !isSolicitante && !statusFilter;
  const services = pinnedFirst(
    hideClosed
      ? matching.filter(
          (s) => !CLOSED_SERVICE_STATUSES.includes(s.status) || matchesId(s) || pin(s),
        )
      : matching,
    pin,
  );
  const hiddenClosed = matching.length - services.length;

  const current = clampPage(page, services.length, PAGE_SIZE);
  const visible = services.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const showSkeleton = isLoading && !data; //Skeleton cuando se esta cargando y no hay informacion

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("services.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("services.subtitle")}</p>
        </div>
        <Button
          size="sm"
          className="shrink-0 whitespace-nowrap"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("services.new")}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("services.search")}
              aria-label={t("services.searchLabel")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="pl-9"
            />
          </div>
          <StatusFilter
            section="service_request"
            aria-label={t("overview.filterStatus")}
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as ServiceStatus | "");
              setPage(0);
            }}
            options={[
              { value: "", label: t("common.allStatuses") },
              ...Object.entries(SERVICE_STATUS_CONFIG).map(([value, conf]) => ({
                value,
                label: conf.label,
              })),
            ]}
          />
          {!isSolicitante && (
            <OptionSelect
              aria-label={t("services.assignee")}
              value={assigneeFilter}
              onValueChange={(v) => {
                setAssigneeFilter(v);
                setPage(0);
              }}
              options={[
                { value: "", label: t("services.allAssignees") },
                ...(user ? [{ value: user.id, label: t("services.assignedToMe") }] : []),
                { value: "none", label: t("common.unassigned") },
              ]}
            />
          )}
          <DateRangeFilter
            value={dateRange}
            onChange={(next) => {
              setDateRange(next);
              setPage(0);
            }}
          />
        </div>

        {hiddenClosed > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("services.hiddenClosed", { count: hiddenClosed })} {t("services.hiddenClosedHelp")}
          </p>
        )}
      </div>

      <div className="space-y-3">
        {showSkeleton ? (
          <TableSkeleton rows={6} cols={7} />
        ) : services.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm font-medium">
            {dateActive
              ? t("filters.emptyRange")
              : hiddenClosed > 0
                ? t("services.emptyOpen")
                : t("services.empty")}
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
                      key={h ?? "actions"}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                    >
                      {h ? t(h) : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const statusConf = SERVICE_STATUS_CONFIG[s.status];
                  const pinState = pin(s);
                  const notice = noticeFor("service_request", s.id);
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
                      <td className="px-4 py-3 text-sm text-foreground min-w-48 max-w-xs whitespace-normal">
                        {/* El tooltip con la descripcion completa va solo sobre el texto, no sobre el aviso */}
                        <span title={s.description}>{truncate(s.description, 60)}</span>
                        {notice && <NoticeLine notice={notice} />}
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
                          className="inline-flex min-h-11 items-center text-xs font-semibold text-primary hover:underline sm:min-h-0"
                        >
                          {t("services.viewDetail")}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={current}
          pageSize={PAGE_SIZE}
          total={services.length}
          onPageChange={setPage}
        />
      </div>

      {/* AnimatePresence propio, como en TicketList: sin el, la animacion de salida
          del dialogo queda atada a la de la pagina y, si se abrio al entrar
          (?nuevo=1), al cerrarlo la pagina entera se queda invisible */}
      <AnimatePresence>
        {createOpen && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t("services.dialog.title")}</DialogTitle>
                <DialogDescription>{t("services.dialog.description")}</DialogDescription>
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
