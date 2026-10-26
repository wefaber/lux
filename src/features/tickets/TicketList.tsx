import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search, AlertCircle, Camera } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useNotices } from "@/hooks/useNotices";
import { useI18n } from "@/hooks/useI18n";
import { gql, formatDate, truncate, cn, errorMessage } from "@/lib/utils";
import {
  TICKET_STATUS_CONFIG,
  TICKET_CATEGORY_LABELS,
  ROUTES,
  equipmentKindLabel,
} from "@/lib/constants";
import type { Ticket, TicketStatus, Product } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  AnimatePresence,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QrScanner } from "@/components/ui/QrScanner";
import { EquipmentSearchSelect } from "@/components/search-pickers";
import { OptionSelect } from "@/components/ui/option-select";
import { Pagination, clampPage } from "@/components/ui/pagination";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { useDateRangeParams } from "@/hooks/useDateRangeParams";
import { NoticeLine, PinMark, pinRowClass } from "@/components/ui/pin";
import { UnseenDot } from "@/components/ui/unseen-dot";
import { idQuery, pinnedFirst, ticketPin } from "@/lib/pins";
import { STAFF_ROLES } from "@/lib/roles";
import { ErrorAlert } from "@/components/ui/error-alert";
import { firstError, validateTicket } from "@/lib/validation";

const TICKETS_QUERY = `
  query GetTickets($submittedById: ID, $startDate: String, $endDate: String) {
    tickets(submittedById: $submittedById, startDate: $startDate, endDate: $endDate) {
      id title description category status
      submittedBy { id name }
      assignedTo { id name }
      equipmentId createdAt updatedAt
    }
  }
`;

const PRODUCTS_QUERY = `
  query GetProducts {
    products {
      id machineId kind brand model location status
    }
  }
`;

const CREATE_TICKET_MUTATION = `
  mutation CreateTicket($input: TicketInput!) {
    createTicket(input: $input) { id }
  }
`;

// Tickets por pagina
const PAGE_SIZE = 10;

export function TicketList() {
  const { t } = useI18n();
  const { user, hasRole } = useAuth();
  const { noticeFor, hasNewPending } = useNotices();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");
  const [page, setPage] = useState(0);
  // Rango por fecha de creacion, en la URL (?desde=&hasta=) para poder compartirlo
  const { range: dateRange, setRange: setDateRange, active: dateActive, bounds } =
    useDateRangeParams();
  // ?nuevo=1 abre el formulario y ?equipo=<id> lo trae elegido (accesos del inicio)
  const [searchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(() => searchParams.get("nuevo") === "1");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [form, setForm] = useState(() => ({
    title: "",
    description: "",
    category: "hardware",
    equipmentId: searchParams.get("equipo") ?? "",
  })); // Settear formulario con variables: title, desc, category, equipmentId
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState("");

  const isSolicitante = !hasRole(...STAFF_ROLES);

  const { data, isLoading, error, refetch } = useAsync<{ tickets: Ticket[] }>(
    () =>
      gql(TICKETS_QUERY, {
        submittedById: isSolicitante ? user?.id : undefined,
        startDate: bounds?.startDate,
        endDate: bounds?.endDate,
      }),
    [isSolicitante, user?.id, bounds?.startDate, bounds?.endDate],
  );

  const { data: productsData } = useAsync<{ products: Product[] }>(() => gql(PRODUCTS_QUERY), []);

  const products = productsData?.products ?? [];

  const selectedProduct = products.find((p) => p.id === form.equipmentId) ?? null;

  const term = search.trim().toLowerCase();
  const idTerm = idQuery(term, "tkt");
  const matchesId = (tk: Ticket) => idTerm !== null && tk.id.toLowerCase().includes(idTerm);
  const pin = (tk: Ticket) => ticketPin(tk, user?.id, !!noticeFor("ticket", tk.id));

  const matching = (data?.tickets ?? []).filter((tk) => {
    const matchSearch = !term || tk.title.toLowerCase().includes(term) || matchesId(tk);
    const matchStatus = !statusFilter || tk.status === statusFilter;
    return matchSearch && matchStatus;
  }); // Comprueba que los tickets mostrados matcheen con los filtros

  // Al staff los resueltos no le aparecen en la lista del dia a dia: se ven
  // filtrando por estado o buscandolos por su ID (o si tienen un aviso sin ver).
  // El solicitante ve todos los suyos
  const hideResolved = !isSolicitante && !statusFilter;
  const tickets = pinnedFirst(
    hideResolved
      ? matching.filter((tk) => tk.status !== "resolved" || matchesId(tk) || pin(tk))
      : matching,
    pin,
  );
  const hiddenResolved = matching.length - tickets.length;

  const current = clampPage(page, tickets.length, PAGE_SIZE);
  const visible = tickets.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const handleCreate = async () => {
    // Mismas reglas que la API: el error se ve antes de enviar
    const invalid = firstError(validateTicket(form));
    setCreateError(invalid ?? "");
    if (invalid) return;
    setSaving(true);
    try {
      await gql(CREATE_TICKET_MUTATION, {
        input: {
          title: form.title,
          description: form.description,
          category: form.category,
          equipmentId: form.equipmentId || undefined,
        },
      });
      setCreateOpen(false);
      setForm({ title: "", description: "", category: "hardware", equipmentId: "" });
      refetch();
    } catch (err) {
      setCreateError(errorMessage(err, t("tickets.create.failed")));
    } finally {
      setSaving(false);
    }
  }; // Funcion que maneja la creacion del ticket

  const handleQrScan = (machineId: string) => {
    const product = products.find((p) => p.machineId === machineId);
    if (product) {
      setForm((f) => ({ ...f, equipmentId: product.id }));
    }
  };

  const showSkeleton = isLoading && !data;

  return (
    <div className="space-y-3 max-w-full">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("tickets.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("tickets.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          {/* Cualquier rol puede reportar un incidente; OOL es una accion extra del staff */}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t("tickets.new")}
          </Button>
          {hasRole(...STAFF_ROLES) && (
            <Button variant="secondary" size="sm" asChild className="relative">
              <Link to={`${ROUTES.TICKETS}/ool`}>
                <AlertCircle className="h-3.5 w-3.5" />
                {t("tickets.ool")}
                {/* Llegaron tickets sin asignar desde la ultima vez que entraste */}
                {hasNewPending("ticket") && <UnseenDot label={t("tickets.oolUnseen")} />}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("tickets.search")}
            aria-label={t("tickets.searchLabel")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
        <OptionSelect
          aria-label={t("overview.filterStatus")}
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as TicketStatus | "");
            setPage(0);
          }}
          options={[
            { value: "", label: t("common.allStatuses") },
            ...Object.entries(TICKET_STATUS_CONFIG).map(([value, conf]) => ({
              value,
              label: conf.label,
            })),
          ]}
        />
        <DateRangeFilter
          value={dateRange}
          onChange={(next) => {
            setDateRange(next);
            setPage(0);
          }}
        />
      </div>

      {hiddenResolved > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("tickets.hiddenResolved", { count: hiddenResolved })} {t("tickets.hiddenResolvedHelp")}
        </p>
      )}

      {error && <ErrorAlert>{t("common.error", { error })}</ErrorAlert>}

      {showSkeleton ? (
        <TableSkeleton rows={8} cols={5} />
      ) : tickets.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {dateActive
            ? t("filters.emptyRange")
            : hiddenResolved > 0
              ? t("tickets.emptyOpen")
              : t("tickets.empty")}
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
                    "label.id",
                    "label.title",
                    "label.status",
                    "label.category",
                    "label.assignedTo",
                    "label.requester",
                    "label.date",
                  ] as const
                ).map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                  >
                    {t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((tk) => {
                const statusConf = TICKET_STATUS_CONFIG[tk.status];
                const pinState = pin(tk);
                const notice = noticeFor("ticket", tk.id);
                return (
                  <tr
                    key={tk.id}
                    className={cn(
                      "border-b border-border last:border-0 transition-colors",
                      pinRowClass(pinState),
                    )}
                  >
                    <td className="px-4 py-2 text-xs text-muted-foreground font-mono">
                      <PinMark state={pinState} />
                      {tk.id}
                    </td>
                    <td className="px-4 py-2 min-w-48 max-w-72 whitespace-normal">
                      <Link
                        to={`${ROUTES.TICKETS}/${tk.id}`}
                        className="text-sm font-semibold text-foreground hover:underline"
                      >
                        {truncate(tk.title, 48)}
                      </Link>
                      {notice && <NoticeLine notice={notice} />}
                    </td>
                    <td className="px-4 py-2">
                      <Badge color={statusConf.color} withDot>
                        {statusConf.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-sm text-muted-foreground font-medium">
                      {TICKET_CATEGORY_LABELS[tk.category]}
                    </td>
                    <td className="px-4 py-2 text-sm text-muted-foreground font-medium whitespace-normal">
                      {tk.assignedTo?.name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-sm text-muted-foreground font-medium whitespace-normal">
                      {tk.submittedBy.name}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDate(tk.createdAt)}
                    </td>
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
        total={tickets.length}
        onPageChange={setPage}
      />

      <AnimatePresence>
        {createOpen && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("tickets.create.title")}</DialogTitle>
                <DialogDescription>{t("tickets.create.description")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>{t("label.title")}</Label>
                  <Input
                    placeholder={t("tickets.create.titlePlaceholder")}
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("label.description")}</Label>
                  <Textarea
                    placeholder={t("tickets.create.descriptionPlaceholder")}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className="h-28"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("label.category")}</Label>
                  <Select
                    value={form.category}
                    onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TICKET_CATEGORY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("tickets.create.equipment")}</Label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <EquipmentSearchSelect
                        items={products}
                        value={form.equipmentId}
                        onChange={(equipmentId) => setForm((f) => ({ ...f, equipmentId }))}
                        direction="up"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      onClick={() => setScannerOpen(true)}
                      title={t("tickets.create.scan")}
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  </div>
                  {selectedProduct && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                      <span className="font-mono text-primary font-semibold">
                        {selectedProduct.machineId}
                      </span>
                      · {selectedProduct.location} · {equipmentKindLabel(selectedProduct.kind)}
                    </p>
                  )}
                </div>
              </div>
              <ErrorAlert>{createError}</ErrorAlert>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setCreateOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={handleCreate} disabled={saving || !form.title.trim()}>
                  {saving ? t("tickets.create.sending") : t("tickets.create.submit")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </AnimatePresence>

      <QrScanner open={scannerOpen} onOpenChange={setScannerOpen} onScan={handleQrScan} />
    </div>
  );
}
