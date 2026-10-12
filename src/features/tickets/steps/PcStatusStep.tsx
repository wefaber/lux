import type { Ticket } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { EQUIPMENT_STATUS_CONFIG } from "@/lib/constants";
import { DetailRow } from "@/components/ui/detail-row";

interface PcStatusStepProps {
  ticket: Ticket;
}

export function PcStatusStep({ ticket }: PcStatusStepProps) {
  const { equipment } = ticket;

  if (!equipment) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No hay equipo asociado a este ticket.
      </div>
    );
  }

  const statusConf = EQUIPMENT_STATUS_CONFIG[equipment.status];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-1">Estado del equipo</h2>
        <p className="text-xs text-muted-foreground">
          {equipment.machineId} · {equipment.location} · {equipment.serialNumber}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <DetailRow
          label="ID de máquina"
          value={
            <span className="font-mono font-semibold text-primary">{equipment.machineId}</span>
          }
        />
        <DetailRow label="Ubicación" value={equipment.location} />
        <DetailRow
          label="Estado"
          value={<Badge color={statusConf.color}>{statusConf.label}</Badge>}
        />
        <DetailRow label="Tipo" value={equipment.kind} />
        <DetailRow label="Marca / Modelo" value={`${equipment.brand} ${equipment.model}`} />
        <DetailRow
          label="N° de serie"
          value={<span className="font-mono text-xs">{equipment.serialNumber}</span>}
        />
        <DetailRow
          label="Part number"
          value={<span className="font-mono text-xs">{equipment.partNumber}</span>}
        />
      </div>

      {equipment.issues && (
        <div>
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium block mb-1.5">
            Fallas registradas
          </span>
          <p className="text-sm text-warning">{equipment.issues}</p>
        </div>
      )}

      <div>
        <h3 className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-3">
          Componentes ({equipment.components.length})
        </h3>
        {equipment.components.length === 0 ? (
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
                    "Part#",
                    "Fábrica",
                    "Funciona",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                    >
                      {h}
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
                        {c.isFactory ? "Sí" : "No"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
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
      </div>
    </div>
  );
}
