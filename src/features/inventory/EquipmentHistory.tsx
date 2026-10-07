import { Link } from "react-router-dom";
import { Ticket as TicketIcon, BookOpen } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { gql, formatDate } from "@/lib/utils";
import {
  LOAN_STATUS_CONFIG,
  ROUTES,
  TICKET_CATEGORY_LABELS,
  TICKET_STATUS_CONFIG,
} from "@/lib/constants";
import type { Loan, Ticket } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Filtra en el servidor por equipo en vez de traer todos los tickets y prestamos.
// Son dos operaciones: MSW resuelve cada handler por nombre de operacion.
const TICKETS_QUERY = `
 query GetTickets($equipmentId: ID) {
 tickets(equipmentId: $equipmentId) {
 id title category status diagnosis createdAt resolvedAt
 assignedTo { id name }
 }
 }
`;
const LOANS_QUERY = `
 query GetLoans($equipmentId: ID) {
 loans(equipmentId: $equipmentId) {
 id status issueDate returnDate actualReturnDate rejectionReason createdAt
 user { id name }
 }
 }
`;

type HistoryEntry =
  | { kind: "ticket"; date: string; ticket: Ticket }
  | { kind: "loan"; date: string; loan: Loan };

interface EquipmentHistoryProps {
  equipmentId: string;
  // Desde el wizard de un ticket, ese mismo ticket no es "historial"
  excludeTicketId?: string;
  embedded?: boolean;
}

export function EquipmentHistory({
  equipmentId,
  excludeTicketId,
  embedded,
}: EquipmentHistoryProps) {
  const { data, isLoading, error } = useAsync<{ tickets: Ticket[]; loans: Loan[] }>(async () => {
    const [{ tickets }, { loans }] = await Promise.all([
      gql<{ tickets: Ticket[] }>(TICKETS_QUERY, { equipmentId }),
      gql<{ loans: Loan[] }>(LOANS_QUERY, { equipmentId }),
    ]);
    return { tickets, loans };
  }, [equipmentId]);

  const entries: HistoryEntry[] = [
    ...(data?.tickets ?? [])
      .filter((t) => t.id !== excludeTicketId)
      .map((ticket) => ({ kind: "ticket" as const, date: ticket.createdAt, ticket })),
    ...(data?.loans ?? []).map((loan) => ({ kind: "loan" as const, date: loan.createdAt, loan })),
  ].toSorted((a, b) => b.date.localeCompare(a.date));

  const body =
    isLoading && !data ? (
      <div className="space-y-2">
        {["a", "b", "c"].map((k) => (
          <div key={k} className="h-12 rounded-xl bg-muted/50 animate-pulse" />
        ))}
      </div>
    ) : error ? (
      <p className="text-sm text-destructive">Error al cargar el historial: {error}</p>
    ) : entries.length === 0 ? (
      <p className="text-sm text-muted-foreground">Sin tickets ni préstamos registrados.</p>
    ) : (
      <ol className="space-y-2">
        {entries.map((entry) =>
          entry.kind === "ticket" ? (
            <li
              key={`t-${entry.ticket.id}`}
              className="flex items-start gap-3 rounded-xl border border-border/70 p-3"
            >
              <TicketIcon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    to={`${ROUTES.TICKETS}/${entry.ticket.id}`}
                    className="text-sm font-semibold text-foreground hover:underline truncate"
                  >
                    {entry.ticket.title}
                  </Link>
                  <Badge color={TICKET_STATUS_CONFIG[entry.ticket.status].color}>
                    {TICKET_STATUS_CONFIG[entry.ticket.status].label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Ticket · {TICKET_CATEGORY_LABELS[entry.ticket.category]} ·{" "}
                  {entry.ticket.assignedTo?.name ?? "Sin asignar"}
                  {entry.ticket.diagnosis && ` · ${entry.ticket.diagnosis}`}
                </p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatDate(entry.date)}
              </span>
            </li>
          ) : (
            <li
              key={`l-${entry.loan.id}`}
              className="flex items-start gap-3 rounded-xl border border-border/70 p-3"
            >
              <BookOpen className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">
                    Préstamo a {entry.loan.user.name}
                  </span>
                  <Badge color={LOAN_STATUS_CONFIG[entry.loan.status].color}>
                    {LOAN_STATUS_CONFIG[entry.loan.status].label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(entry.loan.issueDate)} al{" "}
                  {formatDate(entry.loan.actualReturnDate ?? entry.loan.returnDate)}
                  {entry.loan.rejectionReason && ` · ${entry.loan.rejectionReason}`}
                </p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatDate(entry.date)}
              </span>
            </li>
          ),
        )}
      </ol>
    );

  if (embedded) return body;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
