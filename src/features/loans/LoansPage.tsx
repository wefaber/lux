import { useState } from "react";
import { Plus, RotateCcw, CheckCircle, XCircle, PackageCheck } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { gql, formatDate, cn } from "@/lib/utils";
import { LOAN_STATUS_CONFIG } from "@/lib/constants";
import type { Loan, LoanStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { MetricCardSkeleton } from "@/components/skeletons/CardSkeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoanForm } from "./LoanForm";
import { RejectLoanDialog, ReturnLoanDialog } from "./LoanActionDialogs";

const LOANS_QUERY = `
 query GetLoans($status: String, $userId: ID) {
 loans(status: $status, userId: $userId) {
 id status issueDate returnDate actualReturnDate rejectionReason deliveredAt
 equipment { id brand model serialNumber location }
 user { id name }
 approvedBy { id name }
 deliveredBy { id name }
 components { id name }
 createdAt updatedAt
 }
 }
`;

const APPROVE_MUTATION = `
 mutation ApproveLoan($id: ID!) { approveLoan(id: $id) { id status } }
`;
const DELIVER_MUTATION = `
 mutation DeliverLoan($id: ID!) { deliverLoan(id: $id) { id status } }
`;

const LOAN_STATUSES = Object.keys(LOAN_STATUS_CONFIG) as LoanStatus[];

export function LoansPage() {
  const [statusFilter, setStatusFilter] = useState<LoanStatus | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [rejecting, setRejecting] = useState<Loan | null>(null);
  const [returning, setReturning] = useState<Loan | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const { user, hasRole } = useAuth();

  // El solicitante solo pide y consulta; aprobar, rechazar, entregar y devolver es del staff
  const isStaff = hasRole("root_admin", "admin", "tecnico");

  const { data, isLoading, refetch } = useAsync<{ loans: Loan[] }>(
    () =>
      gql(LOANS_QUERY, {
        status: statusFilter || undefined,
        userId: isStaff ? undefined : user?.id,
      }),
    [statusFilter, isStaff, user?.id],
  );

  const loans = data?.loans ?? [];
  const activeCount = loans.filter((l) => l.status === "active").length;
  const overdueCount = loans.filter((l) => l.status === "overdue").length;
  const returned = loans.filter((l) => l.status === "returned");
  const onTimeRate =
    returned.length > 0
      ? Math.round(
          (returned.filter((l) => l.actualReturnDate && l.actualReturnDate <= l.returnDate).length /
            returned.length) *
            100,
        )
      : 0;

  const runAction = async (id: string, mutation: string) => {
    setBusyId(id);
    setActionError("");
    try {
      await gql(mutation, { id });
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error al actualizar el préstamo");
    } finally {
      setBusyId(null);
    }
  };

  const handleDialogDone = () => {
    setRejecting(null);
    setReturning(null);
    setActionError("");
    refetch();
  };

  // Skeletons are shown ONLY on first mount (when we don't have data yet)
  const showSkeleton = isLoading && !data;

  return (
    <div className="space-y-8 max-w-full">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Préstamos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isStaff ? "Gestión de préstamos de equipos" : "Tus solicitudes de préstamo"}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {isStaff ? "Registrar préstamo" : "Solicitar préstamo"}
        </Button>
      </div>

      {showSkeleton ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <MetricCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 sm:grid-cols-3 gap-4 transition-all duration-300 ease-out",
            isLoading && "opacity-75 blur-xs pointer-events-none",
          )}
        >
          {[
            { label: "Activos", value: activeCount, color: "rgb(0,122,255)" },
            { label: "Vencidos", value: overdueCount, color: "rgb(255,69,58)" },
            {
              label: "Tasa de devolución a tiempo",
              value: `${onTimeRate}%`,
              color: "rgb(52,199,89)",
            },
          ].map((m) => (
            <div
              key={m.label}
              className="rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-6 transition-all duration-300 hover:border-primary/20 hover:bg-card/75 hover:shadow-md"
            >
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-1">
                {m.label}
              </p>
              <p className="text-3xl font-bold tracking-tight" style={{ color: m.color }}>
                {m.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as LoanStatus | "")}
          className="h-10 rounded-xl border border-input bg-card/50 px-3 text-sm text-foreground focus:outline-none focus:border-ring cursor-pointer"
        >
          <option value="">Todos los estados</option>
          {LOAN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LOAN_STATUS_CONFIG[s].label}
            </option>
          ))}
        </select>
      </div>

      {actionError && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {showSkeleton ? (
        <TableSkeleton rows={8} cols={6} />
      ) : loans.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm font-medium">
          No hay préstamos
        </div>
      ) : (
        <div
          className={cn(
            "rounded-2xl border border-border/70 overflow-x-auto bg-card/20 backdrop-blur-sm transition-all duration-300 ease-out",
            isLoading && "opacity-75 blur-xs pointer-events-none",
          )}
        >
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {[
                  "Equipo",
                  ...(isStaff ? ["Usuario"] : []),
                  "Estado",
                  "Aprobado por",
                  "Vencimiento",
                  "Alta",
                  ...(isStaff ? ["Acciones"] : []),
                ].map((h) => (
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
              {loans.map((l) => {
                const statusConf = LOAN_STATUS_CONFIG[l.status];
                const busy = busyId === l.id;
                return (
                  <tr
                    key={l.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">
                        {l.equipment.brand} {l.equipment.model}
                      </p>
                      <p className="text-xs text-muted-foreground font-medium">
                        {l.equipment.location}
                      </p>
                    </td>
                    {isStaff && (
                      <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                        {l.user.name}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Badge color={statusConf.color} withDot>
                        {statusConf.label}
                      </Badge>
                      {l.status === "rejected" && l.rejectionReason && (
                        <p className="text-xs text-muted-foreground mt-1 max-w-56">
                          {l.rejectionReason}
                        </p>
                      )}
                      {l.deliveredBy && l.deliveredAt && l.status !== "returned" && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Entregado por {l.deliveredBy.name} el {formatDate(l.deliveredAt)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                      {l.approvedBy?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(l.returnDate)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(l.issueDate)}
                    </td>
                    {isStaff && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {l.status === "pending" && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => runAction(l.id, APPROVE_MUTATION)}
                              >
                                <CheckCircle className="h-3.5 w-3.5" />
                                Aprobar
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={busy}
                                onClick={() => setRejecting(l)}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                Rechazar
                              </Button>
                            </>
                          )}
                          {l.status === "approved" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => runAction(l.id, DELIVER_MUTATION)}
                            >
                              <PackageCheck className="h-3.5 w-3.5" />
                              Registrar entrega
                            </Button>
                          )}
                          {(l.status === "active" || l.status === "overdue") && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => setReturning(l)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Devolver
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isStaff ? "Registrar préstamo" : "Solicitar préstamo"}</DialogTitle>
          </DialogHeader>
          <LoanForm
            onSuccess={() => {
              setCreateOpen(false);
              refetch();
            }}
          />
        </DialogContent>
      </Dialog>

      <RejectLoanDialog
        loan={rejecting}
        onClose={() => setRejecting(null)}
        onDone={handleDialogDone}
      />
      <ReturnLoanDialog
        loan={returning}
        onClose={() => setReturning(null)}
        onDone={handleDialogDone}
      />
    </div>
  );
}
