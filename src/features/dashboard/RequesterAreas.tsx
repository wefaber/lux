import { MapPin } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { EQUIPMENT_STATUS_CONFIG, LOCATION_KIND_LABELS } from "@/lib/constants";
import type { EquipmentStatus, RequesterArea } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const STATUS_KEYS: Array<{ status: EquipmentStatus; key: keyof RequesterArea }> = [
  { status: "available", key: "available" },
  { status: "in_use", key: "inUse" },
  { status: "in_repair", key: "inRepair" },
  { status: "retired", key: "retired" },
];

// Los lugares que el solicitante ya uso, con el estado de los equipos de ahi.
// No es el inventario: solo las areas que le tocan por sus propios pedidos.
export function RequesterAreas({ areas }: { areas: RequesterArea[] }) {
  const { t } = useI18n();
  return (
    <section aria-label={t("home.areas.title")} className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{t("home.areas.title")}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t("home.areas.help")}</p>
      </div>

      {areas.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-6 text-center">
          <MapPin className="mx-auto h-6 w-6 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-medium text-foreground">{t("home.areas.empty")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("home.areas.emptyHelp")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {areas.map((area) => (
            <article
              key={area.location.id}
              className="rounded-2xl border border-border/70 bg-card/40 backdrop-blur-xl p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {area.location.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {LOCATION_KIND_LABELS[area.location.kind]} · {area.location.code}
                  </p>
                </div>
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                {t("home.areas.count", { count: area.location.productCount })}
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {STATUS_KEYS.flatMap(({ status, key }) => {
                  const count = area[key] as number;
                  if (count === 0) return [];
                  const config = EQUIPMENT_STATUS_CONFIG[status];
                  return (
                    <Badge key={status} color={config.color}>
                      {config.label} · {count}
                    </Badge>
                  );
                })}
                {area.openTickets > 0 && (
                  <Badge color="default">
                    {t("home.areas.openTickets", { count: area.openTickets })}
                  </Badge>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
