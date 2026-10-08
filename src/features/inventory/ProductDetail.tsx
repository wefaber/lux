import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, Edit2, Trash2 } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { gql, formatDate } from "@/lib/utils";
import { EQUIPMENT_STATUS_CONFIG, ROUTES } from "@/lib/constants";
import type { Product } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { QrCode } from "@/components/ui/QrCode";
import { RetireEquipmentDialog } from "./RetireEquipmentDialog";
import { EquipmentHistory } from "./EquipmentHistory";

const PRODUCT_QUERY = `
  query GetProduct($id: ID!) {
    product(id: $id) {
      id type machineId kind brand model serialNumber partNumber status issues location
      components { id name model manufacturer serialNumber partNumber isFactory isWorking }
      createdAt updatedAt deletedAt
    }
  }
`;

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
        {label}
      </span>
      <span className="text-sm text-foreground">{value ?? "—"}</span>
    </div>
  );
}

export function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const [retireOpen, setRetireOpen] = useState(false);
  const { data, isLoading, error } = useAsync<{ product: Product | null }>(
    () => gql(PRODUCT_QUERY, { id }),
    [id],
  );

  const product = data?.product;
  const isStaff = hasRole("root_admin", "admin", "tecnico");
  const canEdit = isStaff && !product?.deletedAt;

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to={ROUTES.INVENTORY}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-[12rem]">
          {isLoading ? (
            <div className="h-6 w-48 bg-muted rounded animate-pulse" />
          ) : (
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {product ? `${product.brand} ${product.model}` : "Equipo no encontrado"}
            </h1>
          )}
        </div>
        {canEdit && product && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link to={`${ROUTES.INVENTORY}/${id}/editar`}>
                <Edit2 className="h-3.5 w-3.5" />
                Editar
              </Link>
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setRetireOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              Dar de baja
            </Button>
          </div>
        )}
      </div>

      {product && id && (
        <RetireEquipmentDialog
          kind="product"
          id={id}
          name={`${product.machineId} · ${product.brand} ${product.model}`}
          open={retireOpen}
          onOpenChange={setRetireOpen}
          onRetired={() => navigate(ROUTES.INVENTORY)}
        />
      )}

      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          Error: {error}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="h-3 w-16 bg-muted rounded animate-pulse" />
                    <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <TableSkeleton rows={4} cols={5} />
        </div>
      ) : product ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="space-y-6"
        >
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Información del equipo</CardTitle>
                <Badge color={EQUIPMENT_STATUS_CONFIG[product.status].color}>
                  {EQUIPMENT_STATUS_CONFIG[product.status].label}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 items-start">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 flex-1">
                  <DetailRow
                    label="ID de máquina"
                    value={
                      <span className="font-mono font-semibold text-primary">
                        {product.machineId}
                      </span>
                    }
                  />
                  <DetailRow label="Tipo" value={product.kind} />
                  <DetailRow label="Marca" value={product.brand} />
                  <DetailRow label="Modelo" value={product.model} />
                  <DetailRow
                    label="N° de serie"
                    value={<span className="font-mono text-xs">{product.serialNumber}</span>}
                  />
                  <DetailRow
                    label="Part number"
                    value={<span className="font-mono text-xs">{product.partNumber}</span>}
                  />
                  <DetailRow label="Ubicación" value={product.location} />
                  <DetailRow label="Registrado" value={formatDate(product.createdAt)} />
                  <DetailRow label="Actualizado" value={formatDate(product.updatedAt)} />
                  {product.issues && (
                    <div className="col-span-full">
                      <DetailRow
                        label="Fallas / Observaciones"
                        value={<span className="text-warning">{product.issues}</span>}
                      />
                    </div>
                  )}
                </div>
                <div className="shrink-0">
                  <QrCode value={product.machineId} size={120} label={product.machineId} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Componentes ({product.components.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {product.components.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin componentes registrados</p>
              ) : (
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        {[
                          "Componente",
                          "Modelo",
                          "Fabricante",
                          "Serie",
                          "De fábrica",
                          "Funciona",
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
                      {product.components.map((c) => (
                        <tr
                          key={c.id}
                          className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors"
                        >
                          <td className="px-4 py-3 text-sm font-medium text-foreground">
                            {c.name}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{c.model}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">
                            {c.manufacturer}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {c.serialNumber}
                          </td>
                          <td className="px-4 py-3">
                            <Badge color={c.isFactory ? "success" : "muted"}>
                              {c.isFactory ? "Sí" : "No"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge color={c.isWorking ? "success" : "destructive"}>
                              {c.isWorking ? "Sí" : "No"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {isStaff && <EquipmentHistory equipmentId={product.id} />}
        </motion.div>
      ) : (
        !isLoading && (
          <div className="text-center py-16 text-muted-foreground">Equipo no encontrado</div>
        )
      )}
    </div>
  );
}
