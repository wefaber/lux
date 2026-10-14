import type { Ticket } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { TICKET_STATUS_CONFIG, TICKET_CATEGORY_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { DetailRow } from "@/components/ui/detail-row";

interface IncidentStepProps {
  ticket: Ticket;
}

export function IncidentStep({ ticket }: IncidentStepProps) {
  const statusConf = TICKET_STATUS_CONFIG[ticket.status];
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-4">Información del incidente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DetailRow label="ID" value={<span className="font-mono text-xs">{ticket.id}</span>} />
          <DetailRow
            label="Estado"
            value={<Badge color={statusConf.color}>{statusConf.label}</Badge>}
          />
          <DetailRow label="Categoría" value={TICKET_CATEGORY_LABELS[ticket.category]} />
          <DetailRow label="Solicitante" value={ticket.submittedBy.name} />
          <DetailRow label="Asignado a" value={ticket.assignedTo?.name ?? "Sin asignar"} />
          <DetailRow label="Fecha de apertura" value={formatDateTime(ticket.createdAt)} />
        </div>
      </div>
      <div>
        <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium block mb-1.5">
          Título
        </span>
        <p className="text-sm font-medium text-foreground">{ticket.title}</p>
      </div>
      <div>
        <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium block mb-1.5">
          Descripción
        </span>
        <p className="text-sm text-foreground leading-relaxed">{ticket.description}</p>
      </div>
    </div>
  );
}

// Export de datos de diagnostico con props
