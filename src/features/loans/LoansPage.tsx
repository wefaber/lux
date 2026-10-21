import { useState } from "react";
import { Plus, RotateCcw, CheckCircle, XCircle, PackageCheck, Search } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useNotices } from "@/hooks/useNotices";
import { useI18n } from "@/hooks/useI18n";
import { gql, formatDate, cn, errorMessage } from "@/lib/utils";
import { LOAN_STATUS_CONFIG, RETURNABLE_LOAN_STATUSES } from "@/lib/constants";
import type { Loan, LoanStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { MetricCardSkeleton } from "@/components/skeletons/CardSkeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoanForm } from "./LoanForm";
import { RejectLoanDialog, ReturnLoanDialog } from "./LoanActionDialogs";
import { StatusFilter } from "@/components/ui/status-filter";
import { Input } from "@/components/ui/input";
import { Pagination, clampPage } from "@/components/ui/pagination";
import { NoticeLine, PinMark, pinRowClass } from "@/components/ui/pin";
import { idQuery, loanPin, pinnedFirst } from "@/lib/pins";
import { STAFF_ROLES } from "@/lib/roles";
import { ErrorAlert } from "@/components/ui/error-alert";

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

// Prestamos por pagina
const PAGE_SIZE = 10;
// Ya cerrados: el staff no los ve en el dia a dia
const FINISHED_STATUSES = new Set<LoanStatus>(["returned", "rejected"]);

export function LoansPage() {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState<LoanStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [rejecting, setRejecting] = useState<Loan | null>(null);
  const [returning, setReturning] = useState<Loan | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const { user, hasRole } = useAuth();
  const { noticeFor } = useNotices();

  // El solicitante solo pide y consulta; aprobar, rechazar, entregar y devolver es del staff
  const isStaff = hasRole(...STAFF_ROLES);

  const { data, isLoading, refetch } = useAsync<{ loans: Loan[] }>(
    () =>
      gql(LOANS_QUERY, {
        status: statusFilter || undefined,
        userId: isStaff ? undefined : user?.id,
      }),
    [statusFilter, isStaff, user?.id],
  );

  const loans = data?.loans ?? [];
  const overdueCount = loans.filter((l) => l.status === "overdue").length;
  // Un préstamo vencido sigue en curso: "Activos" lo incluye y "Vencidos" lo destaca
  const activeCount = loans.filter((l) => l.status === "active").length + overdueCount;
  const returned = loans.filter((l) => l.status === "returned");
  const onTimeRate =
    returned.length > 0
      ? Math.round(
          (returned.filter((l) => l.actualReturnDate && l.actualReturnDate <= l.returnDate).length /
            returned.length) *
            100,
        )
      : null; // sin devoluciones todavía no hay tasa que mostrar

  const term = search.trim().toLowerCase();
  const idTerm = idQuery(term, "loan");
  const matchesId = (l: Loan) => idTerm !== null && l.id.toLowerCase().includes(idTerm);
  const pin = (l: Loan) => loanPin(l, user?.id, !!noticeFor("loan", l.id));

  const matching = loans.filter(
    (l) =>
      !term ||
      matchesId(l) ||
      `${l.equipment.brand} ${l.equipment.model}`.toLowerCase().includes(term) ||
      l.user.name.toLowerCase().includes(term),
  );

  // Como en tickets: al staff los devueltos y rechazados no le aparecen salvo que
  // filtre por estado o los busque por su ID (o tengan un aviso sin ver). El
  // solicitante ve todos los suyos. Lo que uno aprobo queda fijado arriba hasta
  // que se devuelve
  const hideFinished = isStaff && !statusFilter;
  const listed = pinnedFirst(
    hideFinished
      ? matching.filter((l) => !FINISHED_STATUSES.has(l.status) || matchesId(l) || pin(l))
      : matching,
    pin,
  );
  const hiddenFinished = matching.length - listed.length;

  const current = clampPage(page, listed.length, PAGE_SIZE);
  const visible = listed.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const runAction = async (id: string, mutation: string) => {
    setBusyId(id);
    setActionError("");
    try {
      await gql(mutation, { id });
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, t("loans.updateFailed")));
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("loans.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isStaff ? t("loans.subtitle.staff") : t("loans.subtitle.requester")}
          </p>
        </div>
        <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {isStaff ? t("loans.register") : t("loans.request")}
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
            "grid grid-cols-3 gap-2 sm:gap-4 transition-all duration-300 ease-out",
            isLoading && "opacity-75 blur-xs pointer-events-none",
          )}
        >
          {[
            { label: t("loans.metric.active"), value: activeCount, color: "rgb(0,122,255)" },
            { label: t("loans.metric.overdue"), value: overdueCount, color: "rgb(255,69,58)" },
            {
              label: t("loans.metric.onTime"),
              value: onTimeRate === null ? "—" : `${onTimeRate}%`,
              color: "rgb(52,199,89)",
            },
          ].map((m) => (
            <div
              key={m.label}
              className="rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-3 transition-all duration-300 hover:border-primary/20 hover:bg-card/75 hover:shadow-md sm:p-6"
            >
              <p className="mb-1 text-[10px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground sm:text-xs sm:tracking-widest">
                {m.label}
              </p>
              <p
                className="text-xl font-bold tracking-tight sm:text-3xl"
                style={{ color: m.color }}
              >
                {m.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={isStaff ? t("loans.search.staff") : t("loans.search.requester")}
              aria-label={t("loans.searchLabel")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="pl-9"
            />
          </div>
          <StatusFilter
            section="loan"
            aria-label={t("overview.filterStatus")}
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as LoanStatus | "");
              setPage(0);
            }}
            options={[
              { value: "", label: t("common.allStatuses") },
              ...LOAN_STATUSES.map((s) => ({ value: s, label: LOAN_STATUS_CONFIG[s].label })),
            ]}
          />
        </div>

        {hiddenFinished > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("loans.hiddenFinished", { count: hiddenFinished })} {t("loans.hiddenFinishedHelp")}
          </p>
        )}
      </div>

      <ErrorAlert>{actionError}</ErrorAlert>

      <div className="space-y-3">
        {showSkeleton ? (
          <TableSkeleton rows={8} cols={isStaff ? 7 : 5} />
        ) : listed.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm font-medium">
            {hiddenFinished > 0 ? t("loans.emptyOpen") : t("loans.empty")}
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
                  {(
                    [
                      "label.equipment",
                      ...(isStaff ? (["label.user"] as const) : []),
                      "label.status",
                      "loans.col.approvedBy",
                      "loans.col.due",
                      "loans.col.created",
                      ...(isStaff ? (["label.actions"] as const) : []),
                    ] as const
                  ).map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                    >
                      {t(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => {
                  const statusConf = LOAN_STATUS_CONFIG[l.status];
                  const busy = busyId === l.id;
                  const pinState = pin(l);
                  const notice = noticeFor("loan", l.id);
                  return (
                    <tr
                      key={l.id}
                      className={cn(
                        "border-b border-border last:border-0 transition-colors",
                        pinRowClass(pinState),
                      )}
                    >
                      {/* El ID va debajo del equipo y no en una columna propia: asi la
                          tabla sigue entrando a lo ancho con letra grande */}
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-foreground">
                          {l.equipment.brand} {l.equipment.model}
                        </p>
                        <p className="text-xs text-muted-foreground font-medium">
                          <PinMark state={pinState} />
                          <span className="font-mono">{l.id}</span> · {l.equipment.location}
                        </p>
                      </td>
                      {isStaff && (
                        <td className="px-4 py-3 text-sm text-muted-foreground font-medium whitespace-normal">
                          {l.user.name}
                        </td>
                      )}
                      <td className="px-4 py-3 min-w-36 whitespace-normal">
                        <Badge color={statusConf.color} withDot>
                          {statusConf.label}
                        </Badge>
                        {l.status === "rejected" && l.rejectionReason && (
                          <p className="text-xs text-muted-foreground mt-1 max-w-56">
                            {l.rejectionReason}
                          </p>
                        )}
                        {l.deliveredBy && l.deliveredAt && l.status !== "returned" && (
                          <p className="text-xs text-muted-foreground mt-1 max-w-44">
                            {t("loans.deliveredBy", {
                              name: l.deliveredBy.name,
                              date: formatDate(l.deliveredAt),
                            })}
                          </p>
                        )}
                        {notice && <NoticeLine notice={notice} />}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground font-medium whitespace-normal">
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
                                  {t("loans.approve")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={busy}
                                  onClick={() => setRejecting(l)}
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  {t("loans.reject")}
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
                                {t("loans.deliver")}
                              </Button>
                            )}
                            {RETURNABLE_LOAN_STATUSES.includes(l.status) && (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => setReturning(l)}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                {t("loans.return")}
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

        <Pagination
          page={current}
          pageSize={PAGE_SIZE}
          total={listed.length}
          onPageChange={setPage}
        />
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isStaff ? t("loans.register") : t("loans.request")}</DialogTitle>
            <DialogDescription>
              {isStaff ? t("loans.dialog.staff") : t("loans.dialog.requester")}
            </DialogDescription>
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
