import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, Link2, MapPin, QrCode } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { cn, formatDate, formatDateTime, gql, truncate } from "@/lib/utils";
import {
  ROUTES,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_CONFIG,
  TICKET_STATUS_CONFIG,
  equipmentKindLabel,
} from "@/lib/constants";
import { STAFF_ROLES } from "@/lib/roles";
import type { Ticket } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DetailRow } from "@/components/ui/detail-row";
import { ErrorAlert } from "@/components/ui/error-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { MOBILE_TICKETS_QUERY, MOBILE_TICKET_QUERY } from "./queries";

type StaffView = "mine" | "open";

// Lista de tickets del telefono: el solicitante ve los suyos; el staff, los
// asignados a el o los que siguen sin asignar
export function MobileTickets() {
  const { t } = useI18n();
  const { user, hasRole } = useAuth();
  const staff = hasRole(...STAFF_ROLES);
  const [view, setView] = useState<StaffView>("mine");

  const { data, isLoading, error } = useAsync<{ tickets: Ticket[] }>(
    () => gql(MOBILE_TICKETS_QUERY, { submittedById: staff ? undefined : user?.id }),
    [staff, user?.id],
  );

  const all = data?.tickets ?? [];
  const tickets = staff
    ? all.filter((tk) =>
        view === "mine"
          ? tk.assignedTo?.id === user?.id && tk.status !== "resolved"
          : tk.status === "pending" && !tk.assignedTo,
      )
    : all;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("mobile.tickets.title")}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {staff ? t("mobile.tickets.subtitleStaff") : t("mobile.tickets.subtitleRequester")}
        </p>
      </div>

      {staff && (
        <div
          role="group"
          aria-label={t("mobile.tickets.view")}
          className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
        >
          {(["mine", "open"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={cn(
                "min-h-11 rounded-lg text-sm font-medium transition-colors",
                view === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {id === "mine" ? t("mobile.tickets.mine") : t("mobile.tickets.unassigned")}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorAlert>{t("common.error", { error })}</ErrorAlert>}

      {isLoading && !data ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("tickets.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {tickets.map((tk) => {
            const status = TICKET_STATUS_CONFIG[tk.status];
            return (
              <li key={tk.id}>
                <Link
                  to={`${ROUTES.MOBILE_TICKETS}/${tk.id}`}
                  className="flex min-h-11 items-center gap-3 rounded-2xl border border-border/70 bg-card/60 p-3 active:bg-muted/60"
                >
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{tk.id}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(tk.createdAt)}
                      </span>
                    </span>
                    <span className="block text-sm font-semibold text-foreground">
                      {truncate(tk.title, 60)}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge color={status.color} withDot>
                        {status.label}
                      </Badge>
                      <Badge color={TICKET_PRIORITY_CONFIG[tk.priority].color}>
                        {TICKET_PRIORITY_CONFIG[tk.priority].label}
                      </Badge>
                      {tk.equipment && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {tk.equipment.machineId}
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Detalle de estado de un ticket (solo lectura). El staff puede adjuntar el
// equipo con el escaneo si todavia no tiene.
export function MobileTicketDetail() {
  const { t } = useI18n();
  const { hasRole } = useAuth();
  const { id } = useParams<{ id: string }>();
  const staff = hasRole(...STAFF_ROLES);

  const { data, isLoading, error } = useAsync<{ ticket: Ticket | null }>(
    () => gql(MOBILE_TICKET_QUERY, { id }),
    [id],
  );
  const ticket = data?.ticket;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to={ROUTES.MOBILE_TICKETS}>
          <ArrowLeft className="h-4 w-4" />
          {t("mobile.tickets.back")}
        </Link>
      </Button>

      {error && <ErrorAlert>{t("common.error", { error })}</ErrorAlert>}
      {isLoading && !data && <Skeleton className="h-48 w-full rounded-2xl" />}
      {!isLoading && !error && !ticket && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {t("tickets.detail.notFound")}
        </p>
      )}

      {ticket && (
        <>
          <div className="space-y-2">
            <p className="font-mono text-xs text-muted-foreground">{ticket.id}</p>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{ticket.title}</h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge color={TICKET_STATUS_CONFIG[ticket.status].color} withDot>
                {TICKET_STATUS_CONFIG[ticket.status].label}
              </Badge>
              <Badge color={TICKET_PRIORITY_CONFIG[ticket.priority].color}>
                {TICKET_PRIORITY_CONFIG[ticket.priority].label}
              </Badge>
              <Badge color="muted">{TICKET_CATEGORY_LABELS[ticket.category]}</Badge>
            </div>
          </div>

          <Card className="hover:translate-y-0">
            <CardContent className="space-y-4 p-4">
              <DetailRow label={t("label.description")} value={ticket.description} />
              <div className="grid grid-cols-2 gap-3">
                <DetailRow label={t("label.requester")} value={ticket.submittedBy.name} />
                <DetailRow label={t("label.assignedTo")} value={ticket.assignedTo?.name ?? "—"} />
                <DetailRow label={t("label.date")} value={formatDateTime(ticket.createdAt)} />
                <DetailRow
                  label={t("mobile.tickets.updated")}
                  value={formatDateTime(ticket.updatedAt)}
                />
              </div>
              {ticket.location && (
                <p className="flex items-center gap-1.5 text-sm text-foreground">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  {ticket.location.name}
                </p>
              )}
            </CardContent>
          </Card>

          {ticket.equipment ? (
            <Card className="hover:translate-y-0">
              <CardContent className="space-y-0.5 p-3">
                <p className="font-mono text-sm font-semibold text-primary">
                  {ticket.equipment.machineId}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ticket.equipment.brand} {ticket.equipment.model} ·{" "}
                  {equipmentKindLabel(ticket.equipment.kind)}
                </p>
              </CardContent>
            </Card>
          ) : (
            staff &&
            ticket.status !== "resolved" && (
              <Button variant="secondary" className="w-full" asChild>
                <Link to={`${ROUTES.MOBILE_SCAN}?context=incident&ticketId=${ticket.id}`}>
                  <QrCode className="h-4 w-4" />
                  <Link2 className="h-4 w-4" />
                  {t("mobile.tickets.attachEquipment")}
                </Link>
              </Button>
            )
          )}

          {ticket.status === "resolved" && ticket.diagnosis && (
            <Card className="hover:translate-y-0">
              <CardContent className="space-y-3 p-4">
                <DetailRow label={t("tickets.detail.diagnosis")} value={ticket.diagnosis} />
                {ticket.actionsTaken && (
                  <DetailRow label={t("tickets.summary.actions")} value={ticket.actionsTaken} />
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
