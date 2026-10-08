import { useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useLocations } from "@/hooks/useLocations";
import { gql } from "@/lib/utils";
import { EQUIPMENT_STATUS_CONFIG, ROUTES } from "@/lib/constants";
import type { EquipmentStatus, Product } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";

const PRODUCTS_QUERY = `
  query GetProducts {
    products { id machineId kind brand model locationId location status issues }
  }
`;

const SELECT_CLASS =
  "h-10 rounded-xl border border-input bg-card/50 px-3 text-sm text-foreground focus:outline-none focus:border-ring cursor-pointer";

// Lo que un solicitante mira antes de entrar a un laboratorio: como estan sus
// maquinas, y desde ahi mismo reportar la que falla.
export function EquipmentOverview() {
  const [locationId, setLocationId] = useState("");
  const { locations } = useLocations();
  const [status, setStatus] = useState<EquipmentStatus | "">("");
  const [search, setSearch] = useState("");
  const { data, isLoading } = useAsync<{ products: Product[] }>(() => gql(PRODUCTS_QUERY), []);

  const term = search.trim().toLowerCase();
  const products = (data?.products ?? []).filter(
    (p) =>
      (!locationId || p.locationId === locationId) &&
      (!status || p.status === status) &&
      (!term || `${p.machineId} ${p.kind} ${p.brand} ${p.model}`.toLowerCase().includes(term)),
  );
  const withProblems = products.filter((p) => p.status === "in_repair" || p.issues).length;

  return (
    <section
      aria-label="Estado de los equipos"
      className="rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-6 space-y-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Estado de los equipos</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Elegí el lugar al que vas a entrar para ver cómo están sus máquinas.
          </p>
        </div>
        {data && (
          <span className="text-xs text-muted-foreground">
            {products.length} {products.length === 1 ? "equipo" : "equipos"}
            {withProblems > 0 && ` · ${withProblems} con problemas`}
          </span>
        )}
      </div>

      <div className="flex gap-3 flex-wrap">
        <select
          aria-label="Filtrar por ubicación"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">Todas las ubicaciones</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, tipo o modelo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          aria-label="Filtrar por estado"
          value={status}
          onChange={(e) => setStatus(e.target.value as EquipmentStatus | "")}
          className={SELECT_CLASS}
        >
          <option value="">Todos los estados</option>
          {Object.entries(EQUIPMENT_STATUS_CONFIG).map(([value, conf]) => (
            <option key={value} value={value}>
              {conf.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && !data ? (
        <TableSkeleton rows={6} cols={6} />
      ) : products.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          No hay equipos que coincidan con el filtro
        </div>
      ) : (
        <div className="rounded-2xl border border-border/70 overflow-x-auto bg-card/20">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Código", "Tipo", "Marca / Modelo", "Ubicación", "Estado", "Detalle", ""].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-6 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const statusConf = EQUIPMENT_STATUS_CONFIG[p.status];
                return (
                  <tr
                    key={p.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-6 py-4 font-mono text-xs font-semibold text-primary">
                      {p.machineId}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{p.kind}</td>
                    <td className="px-6 py-4 text-sm text-foreground">
                      {p.brand} {p.model}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{p.location}</td>
                    <td className="px-6 py-4">
                      <Badge color={statusConf.color} withDot>
                        {statusConf.label}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground max-w-[200px] truncate">
                      {p.issues ?? "—"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="secondary" size="sm" asChild>
                        <Link to={`${ROUTES.TICKETS}?nuevo=1&equipo=${p.id}`}>Reportar</Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
