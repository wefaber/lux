import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search, AlertCircle, Camera } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { gql, formatDate, truncate, cn } from "@/lib/utils";
import { TICKET_STATUS_CONFIG, TICKET_CATEGORY_LABELS, ROUTES } from "@/lib/constants";
import type { Ticket, TicketStatus, Product } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import {
  Dialog,
  DialogContent,
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
import { SearchSelect } from "@/components/ui/search-select";

const TICKETS_QUERY = `
  query GetTickets($submittedById: ID) {
    tickets(submittedById: $submittedById) {
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

export function TicketList() {
  const { user, hasRole } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");
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

  const isSolicitante = !hasRole("root_admin", "admin", "tecnico");

  const { data, isLoading, error, refetch } = useAsync<{ tickets: Ticket[] }>(
    () => gql(TICKETS_QUERY, { submittedById: isSolicitante ? user?.id : undefined }),
    [isSolicitante, user?.id],
  );

  const { data: productsData } = useAsync<{ products: Product[] }>(() => gql(PRODUCTS_QUERY), []);

  const products = productsData?.products ?? [];

  const selectedProduct = products.find((p) => p.id === form.equipmentId) ?? null;


  const tickets = (data?.tickets ?? []).filter((t) => {
    const matchSearch = !search || t.title.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || t.status === statusFilter;
    return matchSearch && matchStatus;
  }); // Comprueba que los tickets mostrados matcheen con los filtros

  const handleCreate = async () => {
    if (!form.title.trim() || !form.description.trim()) return;
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
    <div className="space-y-6 max-w-full">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tickets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Mesa de ayuda</p>
        </div>
        <div className="flex gap-2">
          {/* Cualquier rol puede reportar un incidente; OOL es una accion extra del staff */}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Nuevo ticket
          </Button>
          {hasRole("root_admin", "admin", "tecnico") && (
            <Button variant="secondary" size="sm" asChild>
              <Link to={`${ROUTES.TICKETS}/ool`}>
                <AlertCircle className="h-3.5 w-3.5" />
                OOL
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar tickets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TicketStatus | "")}
          className="h-10 rounded-xl border border-input bg-card/50 px-3 text-sm text-foreground focus:outline-none focus:border-ring cursor-pointer"
        >
          <option value="">Todos los estados</option>
          <option value="pending">Pendiente</option>
          <option value="in_progress">En progreso</option>
          <option value="in_resolution">En resolución</option>
          <option value="resolved">Resuelto</option>
        </select>
      </div>

      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          Error: {error}
        </div>
      )}

      {showSkeleton ? (
        <TableSkeleton rows={8} cols={5} />
      ) : tickets.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No hay tickets</div>
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
                {["ID", "Título", "Estado", "Categoría", "Asignado a", "Solicitante", "Fecha"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const statusConf = TICKET_STATUS_CONFIG[t.status];
                return (
                  <tr
                    key={t.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{t.id}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={`${ROUTES.TICKETS}/${t.id}`}
                        className="text-sm font-semibold text-foreground hover:underline"
                      >
                        {truncate(t.title, 48)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={statusConf.color} withDot>
                        {statusConf.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                      {TICKET_CATEGORY_LABELS[t.category]}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                      {t.assignedTo?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                      {t.submittedBy.name}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(t.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {createOpen && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crear nuevo ticket</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Título</Label>
                  <Input
                    placeholder="Descripción breve del problema"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Descripción</Label>
                  <Textarea
                    placeholder="Describí el problema en detalle..."
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className="h-28"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Categoría</Label>
                  <Select
                    value={form.category}
                    onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hardware">Hardware</SelectItem>
                      <SelectItem value="software">Software</SelectItem>
                      <SelectItem value="network">Red</SelectItem>
                      <SelectItem value="other">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Equipo (opcional)</Label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <SearchSelect
                        items={products}
                        value={form.equipmentId}
                        onChange={(equipmentId) => setForm((f) => ({ ...f, equipmentId }))}
                        getKey={(p) => p.id}
                        getLabel={(p) => `${p.machineId} · ${p.brand} ${p.model}`}
                        placeholder="Buscar por ID o nombre..."
                        direction="up"
                        renderOption={(p) => (
                          <>
                            <span className="font-mono text-xs text-primary font-semibold">
                              {p.machineId}
                            </span>
                            <span className="text-muted-foreground">
                              {p.brand} {p.model}
                            </span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {p.location}
                            </span>
                          </>
                        )}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      onClick={() => setScannerOpen(true)}
                      title="Escanear QR"
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  </div>
                  {selectedProduct && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                      <span className="font-mono text-primary font-semibold">
                        {selectedProduct.machineId}
                      </span>
                      · {selectedProduct.location} · {selectedProduct.kind}
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setCreateOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreate} disabled={saving || !form.title.trim()}>
                  {saving ? "Enviando..." : "Enviar ticket"}
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
