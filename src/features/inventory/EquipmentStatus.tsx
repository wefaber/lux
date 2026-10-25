import { motion } from "motion/react";
import { useAsync } from "@/hooks/useSkeleton";
import { gql, formatDate } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";
import { useLocations } from "@/hooks/useLocations";
import { EQUIPMENT_STATUS_CONFIG, SPRING_TRANSITION, equipmentKindLabel } from "@/lib/constants";
import type { Product } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { LuxPieChart } from "@/components/charts/PieChart";
import { LuxBarChart } from "@/components/charts/BarChart";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import { ChartSkeleton } from "@/components/skeletons/CardSkeleton";

const PRODUCTS_QUERY = `
 query GetProducts {
 products { id kind brand model serialNumber status locationId location issues components { id isWorking } updatedAt }
 }
`;

// Las ubicaciones ya no son fijas: el color sale del orden, ciclando la paleta
const LOCATION_PALETTE = [
  "rgb(0,122,255)",
  "rgb(52,199,89)",
  "rgb(255,159,10)",
  "rgb(134,134,139)",
  "rgb(175,82,222)",
  "rgb(255,69,58)",
];

export function EquipmentStatus() {
  const { t } = useI18n();
  const { data, isLoading } = useAsync<{ products: Product[] }>(() => gql(PRODUCTS_QUERY), []);
  const products = data?.products ?? [];
  const { locations } = useLocations();

  const byLocation = locations.map((loc, i) => ({
    name: loc.name,
    value: products.filter((p) => p.locationId === loc.id).length,
    color: LOCATION_PALETTE[i % LOCATION_PALETTE.length],
  }));

  const incidentsByLocation = locations.map((loc) => ({
    label: loc.name,
    value: products.filter((p) => p.locationId === loc.id && p.issues).length,
  }));

  // La tabla ocupa todo el ancho de la vista: sin un max-w que la recorte
  return (
    <div className="space-y-8 max-w-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("equipmentStatus.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("equipmentStatus.subtitle")}</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LuxPieChart data={byLocation} title={t("equipmentStatus.byLocation")} />
          <LuxBarChart
            data={incidentsByLocation}
            title={t("equipmentStatus.incidents")}
            color="rgb(255,159,10)"
          />
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING_TRANSITION}
          className="rounded-2xl border border-border overflow-x-auto bg-card/20 backdrop-blur-sm"
        >
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {(
                  [
                    "label.location",
                    "equipmentStatus.col.number",
                    "label.status",
                    "equipmentStatus.col.lastUpdate",
                    "label.type",
                    "equipmentStatus.col.faults",
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
              {products.map((p, i) => {
                const statusConf = EQUIPMENT_STATUS_CONFIG[p.status];
                return (
                  <motion.tr
                    key={p.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ ...SPRING_TRANSITION, delay: i * 0.02 }}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-foreground">{p.location}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {p.serialNumber}
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={statusConf.color}>{statusConf.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(p.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {equipmentKindLabel(p.kind)}
                    </td>
                    <td className="px-4 py-3">
                      {p.issues ? (
                        <span className="text-xs text-warning block min-w-40 max-w-xs whitespace-normal">
                          {p.issues}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("equipmentStatus.noFaults")}
                        </span>
                      )}
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      )}
    </div>
  );
}
