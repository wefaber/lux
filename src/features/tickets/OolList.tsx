import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, UserCheck } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
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
  const { data, isLoading, refetch } = useAsync<{ oolTickets: Ticket[] }>(() => gql(OOL_QUERY), []);

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
            Tickets sin asignar (OOL)
          </h1>
          <p className="text-sm text-muted-foreground">Tomá un ticket para comenzar a trabajar</p>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : tickets.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No hay tickets sin asignar en este momento.
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-x-auto bg-card/20 backdrop-blur-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["ID", "Título", "Categoría", "Solicitante", "Fecha", ""].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t, i) => (
                <motion.tr
                  key={t.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...SPRING_TRANSITION, delay: i * 0.04 }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{t.id}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`${ROUTES.TICKETS}/${t.id}`}
                      className="text-sm font-medium text-foreground hover:underline"
                    >
                      {t.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {TICKET_CATEGORY_LABELS[t.category]}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{t.submittedBy.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(t.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="secondary" onClick={() => handleClaim(t.id)}>
                      <UserCheck className="h-3.5 w-3.5" />
                      Tomar
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
