import { useState } from "react";
import { Plus, Search, Package, Cpu, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useLocations } from "@/hooks/useLocations";
import { gql, formatDate, cn } from "@/lib/utils";
import { EQUIPMENT_STATUS_CONFIG, ROUTES } from "@/lib/constants";
import type { Product, Component, EquipmentStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OptionSelect } from "@/components/ui/option-select";

const PRODUCTS_QUERY = `
  query GetProducts($status: String, $locationId: ID) {
    products(status: $status, locationId: $locationId) {
      id type machineId kind brand model serialNumber partNumber status issues location
      components { id name model manufacturer serialNumber partNumber isFactory isWorking }
      createdAt updatedAt deletedAt
    }
  }
`;

const COMPONENTS_QUERY = `
  query GetComponents($isWorking: Boolean) {
    components(isWorking: $isWorking) {
      id type name model manufacturer serialNumber partNumber isFactory isWorking productId createdAt updatedAt deletedAt
    }
  }
`;

export function InventoryPage() {
  const { hasRole } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<EquipmentStatus | "">("");
  const [locationFilter, setLocationFilter] = useState(""); // id de ubicacion, "" = todas
  const { locations } = useLocations();

  const { data: productsData, isLoading: loadingProducts } = useAsync<{ products: Product[] }>(
    () =>
      gql(PRODUCTS_QUERY, {
        status: statusFilter || undefined,
        locationId: locationFilter || undefined,
      }),
    [statusFilter, locationFilter],
  );

  const { data: componentsData, isLoading: loadingComponents } = useAsync<{
    components: Component[];
  }>(() => gql(COMPONENTS_QUERY), []);

  const products = (productsData?.products ?? []).filter(
    (p) =>
      !search ||
      `${p.brand} ${p.model} ${p.serialNumber}`.toLowerCase().includes(search.toLowerCase()),
  );

  const components = (componentsData?.components ?? []).filter(
    (c) =>
      !search ||
      `${c.name} ${c.model} ${c.manufacturer}`.toLowerCase().includes(search.toLowerCase()),
  );

  const canEdit = hasRole("root_admin", "admin", "tecnico");

  // Skeletons are shown ONLY on first mount (when we don't have list data yet)
  const showProductsSkeleton = loadingProducts && !productsData;
  const showComponentsSkeleton = loadingComponents && !componentsData;

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Inventario</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Equipos y componentes del instituto
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link to={ROUTES.LOCATIONS}>
                <MapPin className="h-3.5 w-3.5" />
                Ubicaciones
              </Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to={`${ROUTES.INVENTORY}/nuevo-componente`}>
                <Cpu className="h-3.5 w-3.5" />
                Componente
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to={`${ROUTES.INVENTORY}/nuevo`}>
                <Plus className="h-3.5 w-3.5" />
                Nuevo equipo
              </Link>
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por marca, modelo, serie..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <OptionSelect
          aria-label="Filtrar por estado"
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as EquipmentStatus | "")}
          options={[
            { value: "", label: "Todos los estados" },
            ...Object.entries(EQUIPMENT_STATUS_CONFIG).map(([value, conf]) => ({
              value,
              label: conf.label,
            })),
          ]}
        />
        <OptionSelect
          aria-label="Filtrar por ubicación"
          value={locationFilter}
          onValueChange={setLocationFilter}
          options={[
            { value: "", label: "Todas las ubicaciones" },
            ...locations.map((l) => ({ value: l.id, label: l.name })),
          ]}
        />
      </div>

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">
            <Package className="h-3.5 w-3.5" />
            Equipos ({products.length})
          </TabsTrigger>
          <TabsTrigger value="components">
            <Cpu className="h-3.5 w-3.5" />
            Componentes ({components.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          {showProductsSkeleton ? (
            <TableSkeleton rows={8} cols={6} />
          ) : products.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              No se encontraron equipos
            </div>
          ) : (
            <div
              className={cn(
                "rounded-2xl border border-border/70 overflow-x-auto bg-card/20 backdrop-blur-sm transition-all duration-300 ease-out",
                loadingProducts && "opacity-75 blur-xs pointer-events-none",
              )}
            >
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      "Tipo/Marca/Modelo",
                      "Serie",
                      "Estado",
                      "Ubicación",
                      "Componentes",
                      "Actualizado",
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
                  {products.map((p) => {
                    const statusConf = EQUIPMENT_STATUS_CONFIG[p.status];
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Link to={`${ROUTES.INVENTORY}/${p.id}`} className="hover:underline">
                            <p className="text-sm font-semibold text-foreground">
                              {p.brand} {p.model}
                            </p>
                            <p className="text-xs text-muted-foreground font-medium">
                              <span className="font-mono text-primary">{p.machineId}</span>
                              {" · "}
                              {p.kind}
                            </p>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                          {p.serialNumber}
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={statusConf.color} withDot>
                            {statusConf.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                          {p.location}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                          {p.components.length}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDate(p.updatedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="components">
          {showComponentsSkeleton ? (
            <TableSkeleton rows={8} cols={6} />
          ) : components.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              No se encontraron componentes
            </div>
          ) : (
            <div
              className={cn(
                "rounded-2xl border border-border/70 overflow-x-auto bg-card/20 backdrop-blur-sm transition-all duration-300 ease-out",
                loadingComponents && "opacity-75 blur-xs pointer-events-none",
              )}
            >
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      "Componente",
                      "Fabricante",
                      "Serie",
                      "De fábrica",
                      "Funcionando",
                      "Actualizado",
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
                  {components.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`${ROUTES.INVENTORY}/componente/${c.id}`}
                          className="hover:underline"
                        >
                          <p className="text-sm font-semibold text-foreground">{c.name}</p>
                          <p className="text-xs text-muted-foreground font-medium">{c.model}</p>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                        {c.manufacturer}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {c.serialNumber}
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={c.isFactory ? "success" : "muted"} withDot={c.isFactory}>
                          {c.isFactory ? "Sí" : "No"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={c.isWorking ? "success" : "destructive"} withDot>
                          {c.isWorking ? "Sí" : "No"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(c.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
