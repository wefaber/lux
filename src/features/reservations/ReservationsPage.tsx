import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  CheckCircle,
  XCircle,
  CalendarClock,
  Ban,
  Package,
  MapPin,
  Search,
} from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useNotices } from "@/hooks/useNotices";
import { useI18n } from "@/hooks/useI18n";
import { gql, formatDate, formatDateTime, cn, errorMessage } from "@/lib/utils";
import { getLocale } from "@/i18n";
import { RESERVATION_STATUS_CONFIG, CHANGEABLE_RESERVATION_STATUSES } from "@/lib/constants";
import { isStaff } from "@/lib/roles";
import type { Reservation, ReservationStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AnimatePresence,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReservationForm, resourceName } from "./ReservationForm";
import { StatusFilter } from "@/components/ui/status-filter";
import { Input } from "@/components/ui/input";
import { Pagination, clampPage } from "@/components/ui/pagination";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { useDateRangeParams } from "@/hooks/useDateRangeParams";
import { NoticeLine, PinMark, pinRowClass } from "@/components/ui/pin";
import { idQuery, pinnedFirst, reservationPin } from "@/lib/pins";
import { ErrorAlert } from "@/components/ui/error-alert";

const RESERVATIONS_QUERY = `
  query GetReservations($status: String, $startDate: String, $endDate: String) {
    reservations(status: $status, startDate: $startDate, endDate: $endDate) {
      id resourceType purpose startsAt endsAt status rejectionReason createdAt updatedAt
      equipment { id machineId brand model }
      location { id name code }
      user { id name }
      reviewedBy { id name }
      cancelledBy { id name }
    }
  }
`;
const APPROVE_MUTATION = `mutation ApproveReservation($id: ID!) { approveReservation(id: $id) { id } }`;
const REJECT_MUTATION = `mutation RejectReservation($id: ID!, $reason: String!) { rejectReservation(id: $id, reason: $reason) { id } }`;
const CANCEL_MUTATION = `mutation CancelReservation($id: ID!) { cancelReservation(id: $id) { id } }`;

const STATUSES = Object.keys(RESERVATION_STATUS_CONFIG) as ReservationStatus[];

// Reservas por pagina
const PAGE_SIZE = 10;
// Ya cerradas: el staff no las ve en el dia a dia
const FINISHED_STATUSES = new Set<ReservationStatus>(["completed", "rejected", "cancelled"]);

export function ReservationsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { noticeFor } = useNotices();
  const staff = isStaff(user?.role);
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  // Rango por el horario reservado (startsAt/endsAt): se ven las reservas que
  // ocupan esos dias, aunque hayan empezado antes
  const { range: dateRange, setRange: setDateRange, active: dateActive, bounds } =
    useDateRangeParams();
  // null = cerrado, "new" = pedir, Reservation = modificar (staff). ?nuevo=1 abre el alta
  const [editing, setEditing] = useState<Reservation | "new" | null>(() =>
    searchParams.get("nuevo") === "1" ? "new" : null,
  );
  const [rejecting, setRejecting] = useState<Reservation | null>(null);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const { data, isLoading, error, refetch } = useAsync<{ reservations: Reservation[] }>(
    () =>
      gql(RESERVATIONS_QUERY, {
        status: statusFilter || undefined,
        startDate: bounds?.startDate,
        endDate: bounds?.endDate,
      }),
    [statusFilter, bounds?.startDate, bounds?.endDate],
  );
  const reservations = data?.reservations ?? [];

  const term = search.trim().toLowerCase();
  const idTerm = idQuery(term, "rsv");
  const matchesId = (r: Reservation) => idTerm !== null && r.id.toLowerCase().includes(idTerm);
  const pin = (r: Reservation) => reservationPin(r, user?.id, !!noticeFor("reservation", r.id));

  const matching = reservations.filter(
    (r) =>
      !term ||
      matchesId(r) ||
      resourceName(r).toLowerCase().includes(term) ||
      r.purpose.toLowerCase().includes(term) ||
      r.user.name.toLowerCase().includes(term),
  );

  // Como en tickets: al staff las terminadas, rechazadas y canceladas no le
  // aparecen salvo que filtre por estado o las busque por su ID. El solicitante
  // ve todas las suyas. Lo que uno aprobo queda fijado arriba hasta que termina
  const hideFinished = staff && !statusFilter;
  const listed = pinnedFirst(
    hideFinished
      ? matching.filter((r) => !FINISHED_STATUSES.has(r.status) || matchesId(r) || pin(r))
      : matching,
    pin,
  );
  const hiddenFinished = matching.length - listed.length;

  const current = clampPage(page, listed.length, PAGE_SIZE);
  const visible = listed.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const approve = async (id: string) => {
    setBusyId(id);
    setActionError("");
    try {
      await gql(APPROVE_MUTATION, { id });
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, t("reservations.approveFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const done = () => {
    setEditing(null);
    setRejecting(null);
    setCancelling(null);
    setActionError("");
    refetch();
  };

  // Mismas reglas que el servidor: el solicitante cancela lo suyo antes de que
  // empiece; el staff gestiona todo y tambien corta una reserva en curso
  const canCancel = (r: Reservation) =>
    r.user.id === user?.id && CHANGEABLE_RESERVATION_STATUSES.includes(r.status);

  // Columnas compactas para que la tabla entre entera en escritorio: el ID va
  // debajo del recurso y desde/hasta comparten una columna de horario
  const columns = [
    t("reservations.col.resource"),
    ...(staff ? [t("label.requester")] : []),
    t("reservations.col.schedule"),
    t("label.reason"),
    t("label.status"),
    "",
  ];

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("reservations.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {staff ? t("reservations.subtitle.staff") : t("reservations.subtitle.own")}
          </p>
        </div>
        <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5" />
          {t("reservations.new")}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("reservations.search")}
              aria-label={t("reservations.searchLabel")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="pl-9"
            />
          </div>
          <StatusFilter
            section="reservation"
            aria-label={t("common.filterStatus")}
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as ReservationStatus | "");
              setPage(0);
            }}
            options={[
              { value: "", label: t("common.allStatuses") },
              ...STATUSES.map((s) => ({ value: s, label: RESERVATION_STATUS_CONFIG[s].label })),
            ]}
          />
          <DateRangeFilter
            value={dateRange}
            onChange={(next) => {
              setDateRange(next);
              setPage(0);
            }}
          />
        </div>

        {hiddenFinished > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("reservations.hiddenFinished", { count: hiddenFinished })}{" "}
            {t("reservations.hiddenFinishedHelp")}
          </p>
        )}
      </div>

      {(error || actionError) && (
        <ErrorAlert>{actionError || t("common.error", { error: error ?? "" })}</ErrorAlert>
      )}

      {isLoading && !data ? (
        <TableSkeleton rows={6} cols={columns.length} />
      ) : listed.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {term
            ? t("reservations.emptySearch")
            : dateActive
              ? t("filters.emptyRange")
              : statusFilter
                ? t("reservations.emptyStatus")
                : hiddenFinished > 0
                  ? t("reservations.emptyOpen")
                  : t("reservations.empty")}
        </div>
      ) : (
        <div
          className={cn(
            "rounded-2xl border border-border/70 overflow-x-auto bg-card/20 backdrop-blur-sm transition-all duration-300",
            isLoading && "opacity-75 pointer-events-none",
          )}
        >
          <TooltipProvider delayDuration={200}>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {columns.map((h) => (
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
                {visible.map((r) => {
                  const statusConf = RESERVATION_STATUS_CONFIG[r.status];
                  const busy = busyId === r.id;
                  const ResourceIcon = r.resourceType === "equipment" ? Package : MapPin;
                  const pinState = pin(r);
                  const notice = noticeFor("reservation", r.id);
                  return (
                    <tr
                      key={r.id}
                      className={cn(
                        "border-b border-border last:border-0 transition-colors",
                        pinRowClass(pinState),
                      )}
                    >
                      <td className="px-4 py-3 min-w-36 max-w-60 whitespace-normal">
                        <span className="flex items-start gap-2 text-sm font-semibold text-foreground">
                          <ResourceIcon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                          {resourceName(r)}
                        </span>
                        <span className="block pl-5.5 font-mono text-xs text-muted-foreground">
                          <PinMark state={pinState} />
                          {r.id}
                        </span>
                      </td>
                      {staff && (
                        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-normal">
                          {r.user.name}
                        </td>
                      )}
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <ReservationSchedule startsAt={r.startsAt} endsAt={r.endsAt} />
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground min-w-36 max-w-64 whitespace-normal">
                        {r.purpose}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={statusConf.color} withDot>
                          {statusConf.label}
                        </Badge>
                        {r.status === "rejected" && r.rejectionReason && (
                          <p className="text-xs text-muted-foreground mt-1 max-w-48 whitespace-normal">
                            {r.rejectionReason}
                          </p>
                        )}
                        {/* El aviso de cancelacion ya dice quien la cancelo */}
                        {r.status === "cancelled" &&
                          r.cancelledBy &&
                          notice?.kind !== "cancelled" && (
                            <p className="text-xs text-muted-foreground mt-1 max-w-48 whitespace-normal">
                              {t("reservations.cancelledBy", { name: r.cancelledBy.name })}
                            </p>
                          )}
                        {notice && <NoticeLine notice={notice} />}
                      </td>
                      <td className="px-4 py-3">
                        {/* Acciones con icono y su nombre en el tooltip: entran en una fila
                          sin ensanchar la tabla */}
                        <div className="flex justify-end gap-1">
                          {staff && r.status === "pending" && (
                            <>
                              <IconAction
                                label={t("reservations.action.approve")}
                                icon={CheckCircle}
                                variant="success"
                                disabled={busy}
                                onClick={() => approve(r.id)}
                              />
                              <IconAction
                                label={t("reservations.action.reject")}
                                icon={XCircle}
                                variant="destructive"
                                disabled={busy}
                                onClick={() => setRejecting(r)}
                              />
                            </>
                          )}
                          {staff && CHANGEABLE_RESERVATION_STATUSES.includes(r.status) && (
                            <IconAction
                              label={t("reservations.action.modify")}
                              icon={CalendarClock}
                              disabled={busy}
                              onClick={() => setEditing(r)}
                            />
                          )}
                          {canCancel(r) && (
                            <IconAction
                              label={t("reservations.action.cancel")}
                              icon={Ban}
                              variant="destructive"
                              disabled={busy}
                              onClick={() => setCancelling(r)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TooltipProvider>
        </div>
      )}

      <Pagination
        page={current}
        pageSize={PAGE_SIZE}
        total={listed.length}
        onPageChange={setPage}
      />

      {/* AnimatePresence propio: el alta se puede abrir al entrar (?nuevo=1) */}
      <AnimatePresence>
        {editing !== null && (
          <Dialog open onOpenChange={(open) => !open && setEditing(null)}>
            <DialogContent>
              <ReservationForm
                key={editing === "new" ? "new" : editing.id}
                reservation={editing === "new" ? null : editing}
                onDone={done}
                onCancel={() => setEditing(null)}
              />
            </DialogContent>
          </Dialog>
        )}
      </AnimatePresence>

      <RejectReservationDialog
        reservation={rejecting}
        onDone={done}
        onCancel={() => setRejecting(null)}
      />
      <CancelReservationDialog
        reservation={cancelling}
        onDone={done}
        onCancel={() => setCancelling(null)}
      />
    </div>
  );
}

interface IconActionProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  variant?: "success" | "destructive" | "ghost";
  disabled?: boolean;
  onClick: () => void;
}

// Boton de accion de una fila: solo el icono, con el nombre en el tooltip y
// para lectores de pantalla
function IconAction({ label, icon: Icon, variant = "ghost", disabled, onClick }: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant={variant}
          className="h-11 w-11 px-0 sm:h-8 sm:w-8"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function day(d: Date): string {
  return formatDate(d);
}

// Horas siempre en 24 h, en cualquiera de los dos idiomas
function time(d: Date): string {
  return d.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });
}

// Mismo dia: la fecha y debajo el rango de horas. Varios dias: inicio y fin.
function ReservationSchedule({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (day(start) === day(end)) {
    return (
      <span className="block leading-relaxed">
        {day(start)}
        <span className="block text-foreground font-medium">
          {time(start)} – {time(end)}
        </span>
      </span>
    );
  }
  return (
    <span className="block leading-relaxed">
      {day(start)} {time(start)}
      <span className="block">
        → {day(end)} {time(end)}
      </span>
    </span>
  );
}

interface ActionDialogProps {
  reservation: Reservation | null;
  onDone: () => void;
  onCancel: () => void;
}

function RejectReservationDialog({ reservation, onDone, onCancel }: ActionDialogProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setReason("");
    setError("");
    onCancel();
  };

  const handleReject = async () => {
    if (!reservation) return;
    setSaving(true);
    setError("");
    try {
      await gql(REJECT_MUTATION, { id: reservation.id, reason });
      setReason("");
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("reservations.reject.failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={reservation !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("reservations.reject.title")}</DialogTitle>
          <DialogDescription>
            {reservation &&
              t("reservations.reject.description", {
                resource: resourceName(reservation),
                user: reservation.user.name,
              })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rsv-reason">{t("reservations.reject.reason")}</Label>
          <Textarea
            id="rsv-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reservations.reject.placeholder")}
            className="h-20"
          />
        </div>
        <ErrorAlert>{error}</ErrorAlert>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {t("common.back")}
          </Button>
          <Button variant="destructive" onClick={handleReject} disabled={saving || !reason.trim()}>
            {saving ? t("reservations.reject.submitting") : t("reservations.reject.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelReservationDialog({ reservation, onDone, onCancel }: ActionDialogProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setError("");
    onCancel();
  };

  const handleCancel = async () => {
    if (!reservation) return;
    setSaving(true);
    setError("");
    try {
      await gql(CANCEL_MUTATION, { id: reservation.id });
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("reservations.cancel.failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={reservation !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("reservations.cancel.title")}</DialogTitle>
          <DialogDescription>
            {reservation &&
              t("reservations.cancel.description", {
                resource: resourceName(reservation),
                // "p. m." ya trae su punto; el texto agrega otro
                date: formatDateTime(reservation.startsAt).replace(/\.$/, ""),
              })}
          </DialogDescription>
        </DialogHeader>
        <ErrorAlert>{error}</ErrorAlert>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {t("common.back")}
          </Button>
          <Button variant="destructive" onClick={handleCancel} disabled={saving}>
            {saving ? t("reservations.cancel.submitting") : t("reservations.cancel.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
