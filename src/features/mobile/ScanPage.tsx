import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { CloudUpload, Lock, QrCode, RefreshCw, SearchX } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { cn, errorMessage } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import { STAFF_ROLES } from "@/lib/roles";
import { newClientId, sendOrQueue } from "@/lib/outbox";
import type { ScanContext, ScanResult } from "@/lib/types";
import type { MessageKey } from "@/i18n";
import { QrScanner } from "@/components/ui/QrScanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorAlert } from "@/components/ui/error-alert";
import { RECORD_SCAN_MUTATION } from "./queries";
import { InventoryResult } from "./InventoryResult";
import { IncidentResult } from "./IncidentResult";

const CONTEXTS: Array<{ id: ScanContext; labelKey: MessageKey; staffOnly: boolean }> = [
  { id: "inventory", labelKey: "mobile.context.inventory", staffOnly: true },
  { id: "incident", labelKey: "mobile.context.incident", staffOnly: true },
  { id: "loan", labelKey: "mobile.context.loan", staffOnly: false },
];

function isContext(value: string | null): value is ScanContext {
  return CONTEXTS.some((c) => c.id === value);
}

type ScanState =
  | { phase: "scan" }
  | { phase: "busy"; machineId: string }
  | { phase: "result"; machineId: string; result: ScanResult }
  | { phase: "queued"; machineId: string }
  | { phase: "error"; machineId: string; message: string };

// Normaliza lo leido: el QR guarda el ID de maquina tal cual (L1-PC3)
function normalize(raw: string): string {
  return raw.trim().toUpperCase();
}

// Escaneo QR de pantalla completa. Segun el origen (inventario, incidencia,
// prestamo) lo que sigue al resultado cambia. Si no hay red, el escaneo queda en
// la cola offline y se registra al volver la conexion.
export function ScanPage() {
  const { t } = useI18n();
  const { hasRole } = useAuth();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<ScanState>({ phase: "scan" });

  const staff = hasRole(...STAFF_ROLES);
  const ticketId = params.get("ticketId") ?? undefined;
  const requested = params.get("context");
  const context: ScanContext = isContext(requested)
    ? requested
    : staff
      ? ticketId
        ? "incident"
        : "inventory"
      : "loan";
  const locked = !staff && CONTEXTS.find((c) => c.id === context)?.staffOnly === true;

  const pick = (next: ScanContext) => {
    const copy = new URLSearchParams(params);
    copy.set("context", next);
    if (next !== "incident") copy.delete("ticketId");
    setParams(copy, { replace: true });
    setState({ phase: "scan" });
  };

  const reset = () => setState({ phase: "scan" });

  const handleCode = async (raw: string) => {
    const machineId = normalize(raw);
    if (!machineId) return;
    setState({ phase: "busy", machineId });
    const clientId = newClientId();
    try {
      const sent = await sendOrQueue<{ recordScan: ScanResult }>({
        op: "RecordScan",
        query: RECORD_SCAN_MUTATION,
        clientId,
        variables: {
          input: { machineId, context, userAgent: navigator.userAgent, clientId },
        },
      });
      setState(
        sent.status === "sent"
          ? { phase: "result", machineId, result: sent.data.recordScan }
          : { phase: "queued", machineId },
      );
    } catch (err) {
      setState({ phase: "error", machineId, message: errorMessage(err, t("mobile.scan.failed")) });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("mobile.scan.title")}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("mobile.scan.subtitle")}</p>
      </div>

      <div
        role="group"
        aria-label={t("mobile.scan.contextLabel")}
        className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
      >
        {CONTEXTS.map(({ id, labelKey, staffOnly }) => {
          const blocked = staffOnly && !staff;
          return (
            <button
              key={id}
              type="button"
              disabled={blocked}
              aria-pressed={context === id}
              onClick={() => pick(id)}
              className={cn(
                "flex min-h-11 items-center justify-center gap-1 rounded-lg px-1 text-xs font-medium transition-colors",
                context === id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground active:opacity-60",
                blocked && "opacity-50",
              )}
            >
              {blocked && <Lock className="h-3 w-3 shrink-0" />}
              <span className="truncate">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>

      {ticketId && context === "incident" && (
        <p className="rounded-xl bg-info/10 px-3 py-2 text-xs text-info">
          {t("mobile.scan.attachingTo", { id: ticketId })}
        </p>
      )}

      {locked ? (
        <Card className="flex flex-col items-center gap-2 p-6 text-center hover:translate-y-0">
          <Lock className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("mobile.locked")}</p>
          <Button variant="secondary" onClick={() => pick("loan")}>
            {t("mobile.scan.useLoan")}
          </Button>
        </Card>
      ) : state.phase === "scan" ? (
        <QrScanner variant="page" onScan={(value) => void handleCode(value)} />
      ) : state.phase === "busy" ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground hover:translate-y-0">
          <RefreshCw className="h-4 w-4 animate-spin" />
          {t("mobile.scan.looking", { id: state.machineId })}
        </Card>
      ) : state.phase === "queued" ? (
        <Card className="space-y-3 p-5 text-center hover:translate-y-0">
          <CloudUpload className="mx-auto h-7 w-7 text-warning" />
          <p className="font-mono text-sm font-semibold text-foreground">{state.machineId}</p>
          <p className="text-sm text-muted-foreground">{t("mobile.scan.queued")}</p>
          <Button className="w-full" onClick={reset}>
            <QrCode className="h-4 w-4" />
            {t("mobile.scan.again")}
          </Button>
        </Card>
      ) : state.phase === "error" ? (
        <div className="space-y-3">
          <ErrorAlert>{state.message}</ErrorAlert>
          <Button className="w-full" onClick={reset}>
            <QrCode className="h-4 w-4" />
            {t("mobile.scan.again")}
          </Button>
        </div>
      ) : (
        <ScanOutcome
          context={context}
          machineId={state.machineId}
          result={state.result}
          ticketId={ticketId}
          onAgain={reset}
        />
      )}
    </div>
  );
}

interface ScanOutcomeProps {
  context: ScanContext;
  machineId: string;
  result: ScanResult;
  ticketId?: string;
  onAgain: () => void;
}

function ScanOutcome({ context, machineId, result, ticketId, onAgain }: ScanOutcomeProps) {
  const { t } = useI18n();
  const { product } = result;

  // Prestamo: con el equipo encontrado se pasa directo a la solicitud prellenada
  if (context === "loan" && product) {
    return <Navigate to={`${ROUTES.MOBILE_LOAN}?equipo=${product.id}`} replace />;
  }

  if (!product) {
    if (context === "inventory") {
      return <InventoryResult machineId={machineId} product={null} onAgain={onAgain} />;
    }
    return (
      <Card className="space-y-3 p-5 text-center hover:translate-y-0">
        <SearchX className="mx-auto h-7 w-7 text-muted-foreground" />
        <p className="font-mono text-sm font-semibold text-foreground">{machineId}</p>
        <p className="text-sm text-muted-foreground">{t("mobile.scan.notFound")}</p>
        <Button className="w-full" onClick={onAgain}>
          <QrCode className="h-4 w-4" />
          {t("mobile.scan.again")}
        </Button>
        <Button variant="ghost" className="w-full" asChild>
          <Link to={ROUTES.MOBILE}>{t("mobile.home")}</Link>
        </Button>
      </Card>
    );
  }

  return context === "incident" ? (
    <IncidentResult product={product} ticketId={ticketId} onAgain={onAgain} />
  ) : (
    <InventoryResult machineId={machineId} product={product} onAgain={onAgain} />
  );
}
