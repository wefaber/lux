import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, CheckCircle, XCircle, CalendarClock, Ban, Package, MapPin } from "lucide-react";
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

const RESERVATIONS_QUERY = `
  query GetReservations($status: String) {
    reservations(status: $status) {
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

export function ReservationsPage() {
  const { user } = useAuth();
  const staff = isStaff(user?.role);
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | "">("");
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
    staff
      ? ["pending", "approved", "active"].includes(r.status)
      : r.user.id === user?.id && ["pending", "approved"].includes(r.status);

  const columns = [
    "ID",
    "Recurso",
    ...(staff ? ["Solicitante"] : []),
    "Desde",
    "Hasta",
    "Motivo",
    "Estado",
    "",
  ];

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

      <select
        aria-label="Filtrar por estado"
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as ReservationStatus | "")}
        className="h-10 rounded-xl border border-input bg-card/50 px-3 text-sm text-foreground focus:outline-none focus:border-ring cursor-pointer"
      >
        <option value="">Todos los estados</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {RESERVATION_STATUS_CONFIG[s].label}
          </option>
        ))}
      </select>

      {(error || actionError) && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {actionError || `Error: ${error}`}
        </div>
      )}

      {isLoading && !data ? (
        <TableSkeleton rows={6} cols={columns.length} />
      ) : reservations.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {statusFilter ? "No hay reservas con ese estado" : "Todavía no hay reservas"}
        </div>
      ) : (
        <div
          className={cn(
            "rounded-2xl border border-border/70 overflow-x-auto bg-card/20 backdrop-blur-sm transition-all duration-300",
            isLoading && "opacity-75 pointer-events-none",
          )}
        >
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {columns.map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => {
                const statusConf = RESERVATION_STATUS_CONFIG[r.status];
                const busy = busyId === r.id;
                const ResourceIcon = r.resourceType === "equipment" ? Package : MapPin;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-6 py-4 text-xs text-muted-foreground font-mono">{r.id}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-foreground">
                      <span className="inline-flex items-center gap-2">
                        <ResourceIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        {resourceName(r)}
                      </span>
                    </td>
                    {staff && (
                      <td className="px-6 py-4 text-sm text-muted-foreground">{r.user.name}</td>
                    )}
                    <td className="px-6 py-4 text-xs text-muted-foreground">
                      {formatDateTime(r.startsAt)}
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground">
                      {formatDateTime(r.endsAt)}
                    </td>
                    <td
                      className="px-6 py-4 text-sm text-foreground max-w-xs truncate"
                      title={r.purpose}
                    >
                      {r.purpose}
                    </td>
                    <td className="px-6 py-4">
                      <Badge color={statusConf.color} withDot>
                        {statusConf.label}
                      </Badge>
                      {r.status === "rejected" && r.rejectionReason && (
                        <p className="text-xs text-muted-foreground mt-1 max-w-56 truncate" title={r.rejectionReason}>
                          {r.rejectionReason}
                        </p>
                      )}
                      {r.status === "cancelled" && r.cancelledBy && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Cancelada por {r.cancelledBy.name}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-1.5">
                        {staff && r.status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => approve(r.id)}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              Aprobar
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busy}
                              onClick={() => setRejecting(r)}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Rechazar
                            </Button>
                          </>
                        )}
                        {staff && (r.status === "pending" || r.status === "approved") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setEditing(r)}
                          >
                            <CalendarClock className="h-3.5 w-3.5" />
                            Modificar
                          </Button>
                        )}
                        {canCancel(r) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setCancelling(r)}
                          >
                            <Ban className="h-3.5 w-3.5" />
                            Cancelar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
