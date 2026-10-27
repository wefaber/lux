import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import { useI18n } from "@/hooks/useI18n";
import type { MessageKey } from "@/i18n";
import type { WorkQueue as WorkQueueData } from "@/lib/types";

// Lo que esta esperando a alguien del area, cada tarjeta lleva a donde se resuelve
const QUEUE_ITEMS: Array<{ key: keyof WorkQueueData; labelKey: MessageKey; to: string }> = [
  { key: "unassignedTickets", labelKey: "dashboard.queue.unassigned", to: `${ROUTES.TICKETS}/ool` },
  { key: "ticketsInProgress", labelKey: "dashboard.queue.inProgress", to: ROUTES.TICKETS },
  { key: "pendingServices", labelKey: "dashboard.queue.pendingServices", to: ROUTES.SERVICES },
  { key: "overdueLoans", labelKey: "dashboard.queue.overdueLoans", to: ROUTES.LOANS },
  { key: "equipmentInRepair", labelKey: "dashboard.queue.inRepair", to: ROUTES.EQUIPMENT_STATUS },
];

export function WorkQueue({ queue }: { queue: WorkQueueData }) {
  const { t } = useI18n();
  return (
    <section aria-label={t("dashboard.queue.title")} className="space-y-3">
      <p className="text-sm font-semibold text-foreground">{t("dashboard.queue.title")}</p>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {QUEUE_ITEMS.map(({ key, labelKey, to }) => (
          <Link
            key={key}
            to={to}
            className="flex flex-col gap-1 rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl px-5 py-4 transition-all duration-300 hover:border-primary/20 hover:bg-card/75 hover:shadow-md hover:-translate-y-[2px] max-lg:last:col-span-2"
          >
            <span className="text-2xl font-bold tracking-tight text-foreground">{queue[key]}</span>
            <span className="text-xs text-muted-foreground">{t(labelKey)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
