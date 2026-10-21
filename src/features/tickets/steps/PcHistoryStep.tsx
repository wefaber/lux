import type { Ticket } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { EquipmentHistory } from "@/features/inventory/EquipmentHistory";

interface PcHistoryStepProps {
  ticket: Ticket;
}

export function PcHistoryStep({ ticket }: PcHistoryStepProps) {
  const { t } = useI18n();
  if (!ticket.equipment) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        {t("tickets.history.none")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-1">
          {t("tickets.history.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {ticket.equipment.location} · {ticket.equipment.serialNumber}
        </p>
      </div>
      <EquipmentHistory equipmentId={ticket.equipment.id} excludeTicketId={ticket.id} embedded />
    </div>
  );
}
