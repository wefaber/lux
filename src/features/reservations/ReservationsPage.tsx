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
import { gql, formatDateTime, cn } from "@/lib/utils";
import { RESERVATION_STATUS_CONFIG } from "@/lib/constants";
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
import { OptionSelect } from "@/components/ui/option-select";
import { Input } from "@/components/ui/input";
import { Pagination, clampPage } from "@/components/ui/pagination";
import { ClosureNoticeLine, PinMark, pinRowClass } from "@/components/ui/pin";
import { idQuery, pinnedFirst, reservationPin } from "@/lib/pins";

const RESERVATIONS_QUERY = `
  query GetReservations($status: String) {
    reservations(status: $status) {
      id resourceType purpose startsAt endsAt status rejectionReason createdAt updatedAt
      equipment { id machineId brand model }
      location { id name code }
      user { id name }
      reviewedBy { id name }
      cancelledBy { id name }
      closureNotice { by { id name } at }
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
  const { user } = useAuth();
  const staff = isStaff(user?.role);
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  // null = cerrado, "new" = pedir, Reservation = modificar (staff). ?nuevo=1 abre el alta
  const [editing, setEditing] = useState<Reservation | "new" | null>(() =>
    searchParams.get("nuevo") === "1" ? "new" : null,
  );
  const [rejecting, setRejecting] = useState<Reservation | null>(null);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const { data, isLoading, error, refetch } = useAsync<{ reservations: Reservation[] }>(
    () => gql(RESERVATIONS_QUERY, { status: statusFilter || undefined }),
    [statusFilter],
  );
  const reservations = data?.reservations ?? [];

  const term = search.trim().toLowerCase();
  const idTerm = idQuery(term, "rsv");
  const matchesId = (r: Reservation) => idTerm !== null && r.id.toLowerCase().includes(idTerm);
  const pin = (r: Reservation) => reservationPin(r, user?.id);

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
      setActionError(err instanceof Error ? err.message : "No se pudo aprobar la reserva");
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
    r.user.id === user?.id && ["pending", "approved"].includes(r.status);

  // Columnas compactas para que la tabla entre entera en escritorio: el ID va
  // debajo del recurso y desde/hasta comparten una columna de horario
  const columns = ["Recurso", ...(staff ? ["Solicitante"] : []), "Horario", "Motivo", "Estado", ""];

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reservas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {staff
              ? "Solicitudes de reserva de equipos y espacios"
              : "Tus reservas de equipos y espacios"}
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5" />
          Nueva reserva
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por recurso, motivo o ID (rsv-003)..."
              aria-label="Buscar reservas por recurso, motivo o ID"
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
              setStatusFilter(v as ReservationStatus | "");
              setPage(0);
            }}
            options={[
              { value: "", label: "Todos los estados" },
              ...STATUSES.map((s) => ({ value: s, label: RESERVATION_STATUS_CONFIG[s].label })),
            ]}
          />
        </div>

        {hiddenFinished > 0 && (
          <p className="text-xs text-muted-foreground">
            {hiddenFinished === 1
              ? "1 reserva terminada, rechazada o cancelada no se muestra."
              : `${hiddenFinished} reservas terminadas, rechazadas o canceladas no se muestran.`}{" "}
            Para verlas, filtrá por estado o buscalas por su ID.
          </p>
        )}
      </div>

      {(error || actionError) && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {actionError || `Error: ${error}`}
        </div>
      )}

      {isLoading && !data ? (
        <TableSkeleton rows={6} cols={columns.length} />
      ) : listed.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {term
            ? "Ninguna reserva coincide con la búsqueda"
            : statusFilter
              ? "No hay reservas con ese estado"
              : hiddenFinished > 0
                ? "No hay reservas en curso"
                : "Todavía no hay reservas"}
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
                      {r.status === "cancelled" && r.cancelledBy && pinState !== "notice" && (
                        <p className="text-xs text-muted-foreground mt-1 max-w-48 whitespace-normal">
                          Cancelada por {r.cancelledBy.name}
                        </p>
                      )}
                      {pinState === "notice" && r.closureNotice && (
                        <ClosureNoticeLine
                          notice={r.closureNotice}
                          action="La canceló"
                          entity="reservation"
                          id={r.id}
                          onSeen={refetch}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {/* Acciones con icono y su nombre en el tooltip: entran en una fila
                          sin ensanchar la tabla */}
                      <div className="flex justify-end gap-1">
                        {staff && r.status === "pending" && (
                          <>
                            <IconAction
                              label="Aprobar"
                              icon={CheckCircle}
                              variant="success"
                              disabled={busy}
                              onClick={() => approve(r.id)}
                            />
                            <IconAction
                              label="Rechazar"
                              icon={XCircle}
                              variant="destructive"
                              disabled={busy}
                              onClick={() => setRejecting(r)}
                            />
                          </>
                        )}
                        {staff && (r.status === "pending" || r.status === "approved") && (
                          <IconAction
                            label="Modificar"
                            icon={CalendarClock}
                            disabled={busy}
                            onClick={() => setEditing(r)}
                          />
                        )}
                        {canCancel(r) && (
                          <IconAction
                            label="Cancelar"
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

      <Pagination page={current} pageSize={PAGE_SIZE} total={listed.length} onPageChange={setPage} />

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
          className="h-8 w-8 px-0"
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
  return d.toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function time(d: Date): string {
  return d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false });
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
      <span className="block">→ {day(end)} {time(end)}</span>
    </span>
  );
}

interface ActionDialogProps {
  reservation: Reservation | null;
  onDone: () => void;
  onCancel: () => void;
}

function RejectReservationDialog({ reservation, onDone, onCancel }: ActionDialogProps) {
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
      setError(err instanceof Error ? err.message : "No se pudo rechazar la reserva");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={reservation !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rechazar reserva</DialogTitle>
          <DialogDescription>
            {reservation && `${resourceName(reservation)} para ${reservation.user.name}.`} El
            solicitante verá el motivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rsv-reason">Motivo del rechazo</Label>
          <Textarea
            id="rsv-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: El laboratorio está reservado para exámenes"
            className="h-20"
          />
        </div>
        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Volver
          </Button>
          <Button variant="destructive" onClick={handleReject} disabled={saving || !reason.trim()}>
            {saving ? "Rechazando..." : "Rechazar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelReservationDialog({ reservation, onDone, onCancel }: ActionDialogProps) {
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
      setError(err instanceof Error ? err.message : "No se pudo cancelar la reserva");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={reservation !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar reserva</DialogTitle>
          <DialogDescription>
            {reservation &&
              `${resourceName(reservation)}, ${formatDateTime(reservation.startsAt)}. El horario queda libre para otros.`}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Volver
          </Button>
          <Button variant="destructive" onClick={handleCancel} disabled={saving}>
            {saving ? "Cancelando..." : "Cancelar reserva"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
