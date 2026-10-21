import { useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, UserCheck } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useNotices } from "@/hooks/useNotices";
import { useI18n } from "@/hooks/useI18n";
import { gql, formatDate } from "@/lib/utils";
import { TICKET_CATEGORY_LABELS, ROUTES, SPRING_TRANSITION } from "@/lib/constants";
import type { Ticket } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";

const OOL_QUERY = `
 query GetOolTickets {
 oolTickets {
 id title category submittedBy { name } createdAt
 }
 }
`; // Query para obtener tickets sin asignar (OOL) con id, title, category, submittedBy (name), createdAt

const CLAIM_MUTATION = `
 mutation ClaimTicket($id: ID!) {
 claimTicket(id: $id) { id status }
 }
`; // Mutacion de datos cuando esta siendo reclamado por otro miembro

export function OolList() {
  const { t } = useI18n();
  const { data, isLoading, refetch } = useAsync<{ oolTickets: Ticket[] }>(() => gql(OOL_QUERY), []);
  const { markPendingSeen } = useNotices();

  // Entrar a OOL da por vistos los tickets sin asignar: se apaga el punto del boton
  useEffect(() => {
    markPendingSeen("ticket");
  }, [markPendingSeen]);

  const tickets = data?.oolTickets ?? [];

  const handleClaim = async (id: string) => {
    try {
      await gql(CLAIM_MUTATION, { id });
      refetch();
    } catch {
      // TODO: toast
    }
  }; // Gestiona el claiming del ticket

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to={ROUTES.TICKETS}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("tickets.ool.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("tickets.ool.subtitle")}</p>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : tickets.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {t("tickets.ool.empty")}
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-x-auto bg-card/20 backdrop-blur-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {(
                  [
                    "label.id",
                    "label.title",
                    "label.category",
                    "label.requester",
                    "label.date",
                    null,
                  ] as const
                ).map((h) => (
                  <th
                    key={h ?? "actions"}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                  >
                    {h ? t(h) : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((tk, i) => (
                <motion.tr
                  key={tk.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...SPRING_TRANSITION, delay: i * 0.04 }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{tk.id}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`${ROUTES.TICKETS}/${tk.id}`}
                      className="text-sm font-medium text-foreground hover:underline"
                    >
                      {tk.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {TICKET_CATEGORY_LABELS[tk.category]}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{tk.submittedBy.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(tk.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="secondary" onClick={() => handleClaim(tk.id)}>
                      <UserCheck className="h-3.5 w-3.5" />
                      {t("tickets.ool.claim")}
                    </Button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
