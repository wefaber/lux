import type { Ticket } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { EQUIPMENT_STATUS_CONFIG, equipmentKindLabel } from "@/lib/constants";
import { DetailRow } from "@/components/ui/detail-row";
import { useI18n } from "@/hooks/useI18n";

interface PcStatusStepProps {
  ticket: Ticket;
}

export function PcStatusStep({ ticket }: PcStatusStepProps) {
  const { t } = useI18n();
  const { equipment } = ticket;

  if (!equipment) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        {t("tickets.pcStatus.none")}
      </div>
    );
  }

  const statusConf = EQUIPMENT_STATUS_CONFIG[equipment.status];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-1">
          {t("tickets.pcStatus.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {equipment.machineId} · {equipment.location} · {equipment.serialNumber}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <DetailRow
          label={t("label.machineId")}
          value={
            <span className="font-mono font-semibold text-primary">{equipment.machineId}</span>
          }
        />
        <DetailRow label={t("label.location")} value={equipment.location} />
        <DetailRow
          label={t("label.status")}
          value={<Badge color={statusConf.color}>{statusConf.label}</Badge>}
        />
        <DetailRow label={t("label.type")} value={equipmentKindLabel(equipment.kind)} />
        <DetailRow label={t("label.brandModel")} value={`${equipment.brand} ${equipment.model}`} />
        <DetailRow
          label={t("label.serialNumber")}
          value={<span className="font-mono text-xs">{equipment.serialNumber}</span>}
        />
        <DetailRow
          label={t("label.partNumber")}
          value={<span className="font-mono text-xs">{equipment.partNumber}</span>}
        />
      </div>

      {equipment.issues && (
        <div>
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium block mb-1.5">
            {t("tickets.pcStatus.issues")}
          </span>
          <p className="text-sm text-warning">{equipment.issues}</p>
        </div>
      )}

      <div>
        <h3 className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-3">
          {t("tickets.pcStatus.components", { count: equipment.components.length })}
        </h3>
        {equipment.components.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("tickets.pcStatus.noComponents")}</p>
        ) : (
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {(
                    [
                      "tickets.pcStatus.col.component",
                      "label.model",
                      "label.manufacturer",
                      "tickets.pcStatus.col.serial",
                      "label.partNumber",
                      "tickets.pcStatus.col.factory",
                      "tickets.pcStatus.col.working",
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
                {equipment.components.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 hover:bg-black/2 transition-colors"
                  >
                    <td className="px-4 py-2 text-sm text-foreground">{c.name}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{c.model}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{c.manufacturer}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground font-mono">
                      {c.serialNumber}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground font-mono">
                      {c.partNumber}
                    </td>
                    <td className="px-4 py-2">
                      <Badge color={c.isFactory ? "success" : "muted"}>
                        {c.isFactory ? t("common.yes") : t("common.no")}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <Badge color={c.isWorking ? "success" : "destructive"}>
                        {c.isWorking ? t("common.yes") : t("common.no")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
