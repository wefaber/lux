import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Link2, QrCode, Siren } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useI18n } from "@/hooks/useI18n";
import { errorMessage, gql, truncate } from "@/lib/utils";
import { ROUTES, TICKET_STATUS_CONFIG, equipmentKindLabel } from "@/lib/constants";
import type { Ticket } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorAlert } from "@/components/ui/error-alert";
import { ATTACH_EQUIPMENT_MUTATION, MOBILE_TICKETS_QUERY } from "./queries";
import type { ScannedProduct } from "./InventoryResult";

interface IncidentResultProps {
  product: ScannedProduct;
  /** Ticket al que se viene a adjuntar el equipo (?ticketId=) */
  ticketId?: string;
  onAgain: () => void;
}

// Escaneo desde Incidencia: adjuntar el equipo a un ticket o abrir una incidencia
// rapida por plantilla con el equipo ya elegido
export function IncidentResult({ product, ticketId, onAgain }: IncidentResultProps) {
  const { t } = useI18n();
  const [attachedTo, setAttachedTo] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  return (
    <div className="space-y-4">
      <Card className="hover:translate-y-0">
        <CardContent className="space-y-1 p-4">
          <p className="font-mono text-lg font-semibold text-primary">{product.machineId}</p>
          <p className="text-sm text-foreground">
            {product.brand} {product.model} · {equipmentKindLabel(product.kind)}
          </p>
          <p className="text-xs text-muted-foreground">{product.location}</p>
        </CardContent>
      </Card>

      {attachedTo ? (
        <div className="space-y-3">
          <div
            role="status"
            className="flex items-center gap-2 rounded-xl bg-success/10 p-3 text-sm text-success"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {t("mobile.incident.attached", { id: attachedTo })}
          </div>
          <Button className="w-full" asChild>
            <Link to={`${ROUTES.MOBILE_TICKETS}/${attachedTo}`}>
              {t("mobile.incident.viewTicket")}
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {ticketId && (
            <AttachButton
              ticketId={ticketId}
              productId={product.id}
              onAttached={() => setAttachedTo(ticketId)}
            />
          )}
          <Button className="w-full" variant={ticketId ? "secondary" : "default"} asChild>
            <Link to={`${ROUTES.MOBILE_INCIDENT}?equipo=${product.id}`}>
              <Siren className="h-4 w-4" />
              {t("mobile.incident.quick")}
            </Link>
          </Button>
          {!ticketId &&
            (picking ? (
              <TicketPicker
                productId={product.id}
                onAttached={(id) => {
                  setAttachedTo(id);
                  setPicking(false);
                }}
              />
            ) : (
              <Button variant="secondary" className="w-full" onClick={() => setPicking(true)}>
                <Link2 className="h-4 w-4" />
                {t("mobile.incident.attachExisting")}
              </Button>
            ))}
        </div>
      )}

      <Button variant="ghost" className="w-full" onClick={onAgain}>
        <QrCode className="h-4 w-4" />
        {t("mobile.scan.again")}
      </Button>
    </div>
  );
}

interface AttachButtonProps {
  ticketId: string;
  productId: string;
  onAttached: () => void;
}

function AttachButton({ ticketId, productId, onAttached }: AttachButtonProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleAttach = async () => {
    setSaving(true);
    setError("");
    try {
      await gql(ATTACH_EQUIPMENT_MUTATION, { id: ticketId, input: { equipmentId: productId } });
      onAttached();
    } catch (err) {
      setError(errorMessage(err, t("mobile.incident.attachFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button className="w-full" onClick={() => void handleAttach()} disabled={saving}>
        <Link2 className="h-4 w-4" />
        {saving ? t("common.saving") : t("mobile.incident.attachTo", { id: ticketId })}
      </Button>
      <ErrorAlert>{error}</ErrorAlert>
    </div>
  );
}

// Tickets abiertos que todavia no tienen equipo
function TicketPicker({
  productId,
  onAttached,
}: {
  productId: string;
  onAttached: (ticketId: string) => void;
}) {
  const { t } = useI18n();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const {
    data,
    isLoading,
    error: loadError,
  } = useAsync<{ tickets: Ticket[] }>(() => gql(MOBILE_TICKETS_QUERY), []);

  const candidates = (data?.tickets ?? []).filter(
    (tk) => tk.status !== "resolved" && !tk.equipmentId,
  );

  const attach = async (id: string) => {
    setSavingId(id);
    setError("");
    try {
      await gql(ATTACH_EQUIPMENT_MUTATION, { id, input: { equipmentId: productId } });
      onAttached(id);
    } catch (err) {
      setError(errorMessage(err, t("mobile.incident.attachFailed")));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-2" aria-label={t("mobile.incident.pickTicket")} role="group">
      <p className="text-sm font-medium text-foreground">{t("mobile.incident.pickTicket")}</p>
      {loadError && <ErrorAlert>{t("common.error", { error: loadError })}</ErrorAlert>}
      {isLoading && !data && <p className="text-xs text-muted-foreground">{t("common.loading")}</p>}
      {!isLoading && !loadError && candidates.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("mobile.incident.noCandidates")}</p>
      )}
      {candidates.map((tk) => (
        <button
          key={tk.id}
          type="button"
          disabled={savingId !== null}
          onClick={() => void attach(tk.id)}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-left disabled:opacity-50"
        >
          <span className="min-w-0">
            <span className="block font-mono text-xs text-muted-foreground">{tk.id}</span>
            <span className="block truncate text-sm font-medium text-foreground">
              {truncate(tk.title, 48)}
            </span>
          </span>
          <Badge color={TICKET_STATUS_CONFIG[tk.status].color}>
            {TICKET_STATUS_CONFIG[tk.status].label}
          </Badge>
        </button>
      ))}
      <ErrorAlert>{error}</ErrorAlert>
    </div>
  );
}
