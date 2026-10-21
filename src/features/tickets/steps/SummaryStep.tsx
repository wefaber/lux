import type { Ticket } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { TICKET_STATUS_CONFIG, EQUIPMENT_STATUS_CONFIG } from "@/lib/constants";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/hooks/useI18n";

interface SummaryStepProps {
  ticket: Ticket;
  diagnosis: string;
  corrected: boolean | null;
  actionsTaken: string;
  onActionsChange: (v: string) => void;
  readOnly?: boolean;
}

export function SummaryStep({
  ticket,
  diagnosis,
  corrected,
  actionsTaken,
  onActionsChange,
  readOnly = false,
}: SummaryStepProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-1">
          {t("tickets.summary.title")}
        </h2>
        {ticket.equipment && (
          <p className="text-xs text-muted-foreground">
            {ticket.equipment.location} · {ticket.equipment.serialNumber}
          </p>
        )}
      </div>

      <div className="rounded-xl bg-black/3 border border-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
            {t("tickets.summary.ticketStatus")}
          </span>
          <Badge color={TICKET_STATUS_CONFIG[ticket.status].color}>
            {TICKET_STATUS_CONFIG[ticket.status].label}
          </Badge>
        </div>
        {ticket.equipment && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
              {t("tickets.summary.equipmentStatus")}
            </span>
            <Badge color={EQUIPMENT_STATUS_CONFIG[ticket.equipment.status].color}>
              {EQUIPMENT_STATUS_CONFIG[ticket.equipment.status].label}
            </Badge>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
            {t("tickets.summary.corrected")}
          </span>
          <Badge
            color={corrected === true ? "success" : corrected === false ? "destructive" : "muted"}
          >
            {corrected === true
              ? t("common.yes")
              : corrected === false
                ? t("common.no")
                : t("tickets.summary.unconfirmed")}
          </Badge>
        </div>
      </div>

      {diagnosis && (
        <div>
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium block mb-1.5">
            {t("tickets.detail.diagnosis")}
          </span>
          <p className="text-sm text-foreground leading-relaxed">{diagnosis}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t("tickets.summary.actions")}</Label>
        <Textarea
          value={actionsTaken}
          onChange={(e) => onActionsChange(e.target.value)}
          placeholder={t("tickets.summary.actionsPlaceholder")}
          className="h-32"
          readOnly={readOnly}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}
