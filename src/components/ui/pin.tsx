import { useState } from "react";
import { BellRing, Check, Pin } from "lucide-react";
import { gql } from "@/lib/utils";
import type { PinState } from "@/lib/pins";
import type { ClosureNotice } from "@/lib/types";

const ACKNOWLEDGE_MUTATION = `
  mutation AcknowledgeClosure($entity: String!, $id: ID!) {
    acknowledgeClosure(entity: $entity, id: $id) { id }
  }
`;

export type ClosureEntity = "ticket" | "service_request" | "loan" | "reservation";

// Fondo de la fila fijada: suave para lo asignado, ambar para un aviso sin ver
export function pinRowClass(state: PinState): string {
  if (state === "notice") return "bg-amber-500/[0.08] hover:bg-amber-500/[0.12]";
  if (state === "active") return "bg-primary/[0.05] hover:bg-primary/[0.09]";
  return "hover:bg-muted/30";
}

// Icono junto al ID de lo que esta fijado
export function PinMark({ state }: { state: PinState }) {
  if (state === "active") {
    return (
      <Pin
        className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5 text-primary"
        aria-label="Fijado: lo tenés asignado"
      >
        <title>Fijado: lo tenés asignado</title>
      </Pin>
    );
  }
  if (state === "notice") {
    return (
      <BellRing
        className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5 text-amber-500"
        aria-label="Fijado: lo cerró otra persona"
      >
        <title>Fijado: lo cerró otra persona</title>
      </BellRing>
    );
  }
  return null;
}

interface ClosureNoticeLineProps {
  notice: ClosureNotice;
  /** Que hizo la otra persona: "Lo resolvió", "La canceló"... */
  action: string;
  entity: ClosureEntity;
  id: string;
  onSeen: () => void;
}

// Aviso de que otra persona cerro algo que tenias asignado. Sigue fijado hasta
// que lo marcas como visto.
export function ClosureNoticeLine({ notice, action, entity, id, onSeen }: ClosureNoticeLineProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const markSeen = async () => {
    setSaving(true);
    setError("");
    try {
      await gql(ACKNOWLEDGE_MUTATION, { entity, id });
      onSeen();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo marcar como visto");
      setSaving(false);
    }
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs whitespace-normal">
      <span className="text-amber-600 dark:text-amber-400 font-medium">
        {action} {notice.by.name}
      </span>
      <button
        type="button"
        onClick={markSeen}
        disabled={saving}
        className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
      >
        <Check className="h-3 w-3" />
        {saving ? "Marcando..." : "Marcar como visto"}
      </button>
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
