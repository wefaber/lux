import { Link } from "react-router-dom";
import { ChevronRight, Ticket as TicketIcon } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/utils";
import { ROUTES, TICKET_CATEGORY_LABELS, TICKET_STATUS_CONFIG } from "@/lib/constants";
import type { Ticket } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

// Sus tickets sin resolver, con estado y ultimo movimiento: el detalle queda a
// un clic, sin tablas ni cifras del sistema
export function RequesterTickets({ tickets }: { tickets: Ticket[] }) {
  const { t } = useI18n();
  return (
    <section
      aria-label={t("home.activeTickets")}
      className="rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("home.activeTickets")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("home.activeTicketsHelp")}</p>
        </div>
        <Link
          to={ROUTES.TICKETS}
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          {t("home.seeAllTickets")}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {tickets.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-1 py-6 text-center">
          <TicketIcon className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">{t("home.activeTicketsEmpty")}</p>
          <p className="text-xs text-muted-foreground">{t("home.activeTicketsEmptyHelp")}</p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border/70">
          {tickets.map((ticket) => {
            const status = TICKET_STATUS_CONFIG[ticket.status];
            return (
              <li key={ticket.id}>
                <Link
                  to={`${ROUTES.TICKETS}/${ticket.id}`}
                  className="group flex items-center gap-3 rounded-xl py-3 transition-colors hover:bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                      {ticket.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {TICKET_CATEGORY_LABELS[ticket.category]} ·{" "}
                      {t("home.lastMove", { time: formatRelativeTime(ticket.updatedAt) })}
                    </p>
                  </div>
                  <Badge color={status.color} withDot>
                    {status.label}
                  </Badge>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
