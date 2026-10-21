import { useState } from "react";
import { Link } from "react-router-dom";
import { useAsync } from "@/hooks/useSkeleton";
import { useI18n } from "@/hooks/useI18n";
import { useLocations } from "@/hooks/useLocations";
import { gql } from "@/lib/utils";
import { EQUIPMENT_STATUS_CONFIG, ROUTES, equipmentKindLabel } from "@/lib/constants";
import type { EquipmentStatus, Product } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocationSearchBar } from "@/components/LocationSearchBar";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { OptionSelect } from "@/components/ui/option-select";
import { Pagination, clampPage } from "@/components/ui/pagination";

const PRODUCTS_QUERY = `
  query GetProducts {
    products { id machineId kind brand model locationId location status issues }
  }
`;

// Equipos por pagina en el inicio
const PAGE_SIZE = 8;

// Lo que un solicitante mira antes de entrar a un laboratorio: como estan sus
// maquinas, y desde ahi mismo reportar la que falla.
export function EquipmentOverview() {
  const { t } = useI18n();
  const [locationId, setLocationId] = useState("");
  const { locations } = useLocations();
  const [status, setStatus] = useState<EquipmentStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const { data, isLoading } = useAsync<{ products: Product[] }>(() => gql(PRODUCTS_QUERY), []);

  const term = search.trim().toLowerCase();
  const products = (data?.products ?? []).filter(
    (p) =>
      (!locationId || p.locationId === locationId) &&
      (!status || p.status === status) &&
      (!term || `${p.machineId} ${p.kind} ${p.brand} ${p.model}`.toLowerCase().includes(term)),
  );
  const withProblems = products.filter((p) => p.status === "in_repair" || p.issues).length;
  // De a 8 equipos por pagina; si un filtro deja menos paginas, se queda en la ultima
  const current = clampPage(page, products.length, PAGE_SIZE);
  const visible = products.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  return (
    <section
      aria-label={t("overview.title")}
      className="rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-6 space-y-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("overview.title")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("overview.help")}</p>
        </div>
        {data && (
          <span className="text-xs text-muted-foreground">
            {t("overview.count", { count: products.length })}
            {withProblems > 0 && ` · ${t("overview.withProblems", { count: withProblems })}`}
          </span>
        )}
      </div>

      <div className="flex gap-3 flex-wrap">
        <LocationSearchBar
          className="flex-1 min-w-[200px] max-w-md"
          placeholder={t("overview.search")}
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          locations={locations}
          locationId={locationId}
          onLocationChange={(v) => {
            setLocationId(v);
            setPage(0);
          }}
        />
        <OptionSelect
          aria-label={t("overview.filterStatus")}
          value={status}
          onValueChange={(v) => {
            setStatus(v as EquipmentStatus | "");
            setPage(0);
          }}
          options={[
            { value: "", label: t("overview.allStatuses") },
            ...Object.entries(EQUIPMENT_STATUS_CONFIG).map(([value, conf]) => ({
              value,
              label: conf.label,
            })),
          ]}
        />
      </div>

      {isLoading && !data ? (
        <TableSkeleton rows={6} cols={6} />
      ) : products.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">{t("overview.empty")}</div>
      ) : (
        <div className="rounded-2xl border border-border/70 overflow-x-auto bg-card/20">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {(
                  [
                    "overview.col.code",
                    "overview.col.kind",
                    "overview.col.brandModel",
                    "overview.col.location",
                    "overview.col.status",
                    "overview.col.detail",
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
              {visible.map((p) => {
                const statusConf = EQUIPMENT_STATUS_CONFIG[p.status];
                return (
                  <tr
                    key={p.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">
                      {p.machineId}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {equipmentKindLabel(p.kind)}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">
                      {p.brand} {p.model}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{p.location}</td>
                    <td className="px-4 py-3">
                      <Badge color={statusConf.color} withDot>
                        {statusConf.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground min-w-48 max-w-xs whitespace-normal">
                      {p.issues ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="secondary" size="sm" asChild>
                        <Link to={`${ROUTES.TICKETS}?nuevo=1&equipo=${p.id}`}>
                          {t("overview.report")}
                        </Link>
                      </Button>
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
        total={products.length}
        onPageChange={setPage}
      />
    </section>
  );
}
