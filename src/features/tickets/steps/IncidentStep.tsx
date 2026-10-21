import type { Ticket } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { TICKET_STATUS_CONFIG, TICKET_CATEGORY_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { DetailRow } from "@/components/ui/detail-row";
import { useI18n } from "@/hooks/useI18n";

interface IncidentStepProps {
  ticket: Ticket;
}

export function IncidentStep({ ticket }: IncidentStepProps) {
  const { t } = useI18n();
  const statusConf = TICKET_STATUS_CONFIG[ticket.status];
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-4">
          {t("tickets.incident.title")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DetailRow
            label={t("label.id")}
            value={<span className="font-mono text-xs">{ticket.id}</span>}
          />
          <DetailRow
            label={t("label.status")}
            value={<Badge color={statusConf.color}>{statusConf.label}</Badge>}
          />
          <DetailRow label={t("label.category")} value={TICKET_CATEGORY_LABELS[ticket.category]} />
          <DetailRow label={t("label.requester")} value={ticket.submittedBy.name} />
          <DetailRow
            label={t("label.assignedTo")}
            value={ticket.assignedTo?.name ?? t("common.unassigned")}
          />
          <DetailRow
            label={t("tickets.incident.opened")}
            value={formatDateTime(ticket.createdAt)}
          />
        </div>
      </div>
      <div>
        <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium block mb-1.5">
          {t("label.title")}
        </span>
        <p className="text-sm font-medium text-foreground">{ticket.title}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium block mb-1.5">
          {t("label.description")}
        </span>
        <p className="text-sm text-foreground leading-relaxed">{ticket.description}</p>
      </div>
    </div>
  );
}

// Export de datos de diagnostico con props
