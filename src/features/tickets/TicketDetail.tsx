import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, UserCheck, RotateCcw, Undo2, Hourglass, PlayCircle } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { gql, formatDateTime, errorMessage } from "@/lib/utils";
import {
  ROUTES,
  TICKET_CATEGORY_LABELS,
  TICKET_STATUS_CONFIG,
  TICKET_TRANSITIONS,
} from "@/lib/constants";
import type { Ticket, TicketStatus } from "@/lib/types";
import type { MessageKey } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WizardSkeleton } from "@/components/skeletons/WizardSkeleton";
import { TicketWizard } from "./TicketWizard";
import { CommentThread } from "@/components/comments/CommentThread";
import { STAFF_ROLES } from "@/lib/roles";
import { ErrorAlert } from "@/components/ui/error-alert";

const TICKET_QUERY = `
 query GetTicket($id: ID!) {
 ticket(id: $id) {
 id title description category status
 submittedBy { id name email role }
 assignedTo { id name }
 equipmentId
 equipment { id type machineId kind brand model serialNumber partNumber status issues location components { id name model manufacturer serialNumber partNumber isFactory isWorking } updatedAt createdAt deletedAt }
 diagnosis corrected actionsTaken
 createdAt updatedAt resolvedAt
 }
 }
`; // Obtencion de datos del ticket

const CLAIM_TICKET_MUTATION = `
 mutation ClaimTicket($id: ID!) {
 claimTicket(id: $id) { id status assignedTo { id name } }
 }
`; // Mutacion de datos del ticket

const CHANGE_STATUS_MUTATION = `
 mutation ChangeTicketStatus($id: ID!, $status: String!) {
 changeTicketStatus(id: $id, status: $status) { id status }
 }
`;

// Acciones manuales de estado. Tomar (pending -> in_progress) y resolver tienen
// su propio flujo porque asignan responsable o exigen diagnostico.
function statusAction(
  from: TicketStatus,
  to: TicketStatus,
): { labelKey: MessageKey; icon: typeof Undo2 } | null {
  if (to === "pending") return { labelKey: "tickets.detail.release", icon: Undo2 };
  if (to === "in_resolution") return { labelKey: "tickets.detail.toResolution", icon: Hourglass };
  if (to === "in_progress" && from === "resolved") {
    return { labelKey: "tickets.detail.reopen", icon: RotateCcw };
  }
  if (to === "in_progress") return { labelKey: "tickets.detail.backToProgress", icon: PlayCircle };
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">{label}</p>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

// Vista del solicitante: puede seguir su ticket pero no operar sobre él
function TicketReadOnly({ ticket }: { ticket: Ticket }) {
  const { t } = useI18n();
  const statusConf = TICKET_STATUS_CONFIG[ticket.status];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{t("tickets.detail.title")}</CardTitle>
          <Badge color={statusConf.color} withDot>
            {statusConf.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t("label.category")}>{TICKET_CATEGORY_LABELS[ticket.category]}</Field>
          <Field label={t("label.created")}>{formatDateTime(ticket.createdAt)}</Field>
          <Field label={t("tickets.detail.assignedTech")}>
            {ticket.assignedTo?.name ?? t("tickets.detail.notAssignedYet")}
          </Field>
          <Field label={t("label.equipment")}>
            {ticket.equipment
              ? `${ticket.equipment.machineId} · ${ticket.equipment.brand} ${ticket.equipment.model}`
              : "—"}
          </Field>
          {ticket.resolvedAt && (
            <Field label={t("tickets.detail.resolved")}>{formatDateTime(ticket.resolvedAt)}</Field>
          )}
        </div>
        <Field label={t("label.description")}>
          <p className="leading-relaxed">{ticket.description}</p>
        </Field>
        {ticket.diagnosis && (
          <Field label={t("tickets.detail.diagnosis")}>
            <p className="leading-relaxed">{ticket.diagnosis}</p>
          </Field>
        )}
        {ticket.actionsTaken && (
          <Field label={t("tickets.detail.work")}>
            <p className="leading-relaxed">{ticket.actionsTaken}</p>
          </Field>
        )}
      </CardContent>
    </Card>
  );
}

export function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const { t } = useI18n();
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error, refetch } = useAsync<{ ticket: Ticket | null }>(
    () => gql(TICKET_QUERY, { id }),
    [id],
  );

  const ticket = data?.ticket; // Informacion del ticket, con obtencion condicional (?)
  const isStaff = hasRole(...STAFF_ROLES);

  const run = async (mutation: string, variables: Record<string, unknown>) => {
    setBusy(true);
    setActionError("");
    try {
      await gql(mutation, variables);
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, t("tickets.detail.updateFailed")));
    } finally {
      setBusy(false);
    }
  };

  const statusActions = ticket
    ? TICKET_TRANSITIONS[ticket.status].flatMap((to) => {
        const action = ticket.status === "pending" ? null : statusAction(ticket.status, to);
        return action ? [{ to, ...action }] : [];
      })
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" asChild>
          <Link to={ROUTES.TICKETS}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight text-foreground flex-1 truncate">
          {isLoading ? "..." : (ticket?.title ?? t("tickets.detail.notFound"))}
        </h1>
        {ticket && isStaff && (
          <div className="flex gap-2 flex-wrap">
            {ticket.status === "pending" && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => run(CLAIM_TICKET_MUTATION, { id })}
              >
                <UserCheck className="h-3.5 w-3.5" />
                {t("tickets.detail.claim")}
              </Button>
            )}
            {statusActions.map(({ to, labelKey, icon: Icon }) => (
              <Button
                key={to}
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => run(CHANGE_STATUS_MUTATION, { id, status: to })}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(labelKey)}
              </Button>
            ))}
          </div>
        )}
      </div>

      {(error || actionError) && (
        <ErrorAlert>{t("common.error", { error: actionError || error || "" })}</ErrorAlert>
      )}

      {isLoading && !ticket ? (
        <Card>
          <CardContent className="pt-6">
            <WizardSkeleton />
          </CardContent>
        </Card>
      ) : ticket && !isStaff ? (
        <TicketReadOnly ticket={ticket} />
      ) : ticket ? (
        <Card>
          <CardContent className="pt-6">
            <TicketWizard ticket={ticket} onComplete={refetch} canComplete={isStaff} />
          </CardContent>
        </Card>
      ) : (
        !error && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-16 text-muted-foreground">
                {t("tickets.detail.notFound")}
              </div>
            </CardContent>
          </Card>
        )
      )}

      {ticket && <CommentThread entityType="ticket" entityId={ticket.id} />}
    </div>
  );
}
