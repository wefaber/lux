import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import type { WorkQueue as WorkQueueData } from "@/lib/types";

// Lo que esta esperando a alguien del area, cada tarjeta lleva a donde se resuelve
const QUEUE_ITEMS: Array<{ key: keyof WorkQueueData; label: string; to: string }> = [
  { key: "unassignedTickets", label: "Tickets sin tomar", to: `${ROUTES.TICKETS}/ool` },
  { key: "ticketsInProgress", label: "Tickets en curso", to: ROUTES.TICKETS },
  { key: "pendingServices", label: "Solicitudes a responder", to: ROUTES.SERVICES },
  { key: "overdueLoans", label: "Préstamos vencidos", to: ROUTES.LOANS },
  { key: "equipmentInRepair", label: "Equipos en reparación", to: ROUTES.EQUIPMENT_STATUS },
];

export function WorkQueue({ queue }: { queue: WorkQueueData }) {
  return (
    <section aria-label="Trabajo del área" className="space-y-3">
      <p className="text-sm font-semibold text-foreground">Trabajo del área</p>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {QUEUE_ITEMS.map(({ key, label, to }) => (
          <Link
            key={key}
            to={to}
            className="flex flex-col gap-1 rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl px-5 py-4 transition-all duration-300 hover:border-primary/20 hover:bg-card/75 hover:shadow-md hover:-translate-y-[2px]"
          >
            <span className="text-2xl font-bold tracking-tight text-foreground">{queue[key]}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
