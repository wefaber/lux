import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, PackagePlus, QrCode, SearchX, Trash2 } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { errorMessage, gql } from "@/lib/utils";
import { EQUIPMENT_STATUS_CONFIG, ROUTES, equipmentKindLabel } from "@/lib/constants";
import type { Product } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DetailRow } from "@/components/ui/detail-row";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/ui/error-alert";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EquipmentNotes } from "./EquipmentNotes";
import { RETIRE_PRODUCT_MUTATION } from "./queries";

export type ScannedProduct = Pick<
  Product,
  | "id"
  | "machineId"
  | "kind"
  | "brand"
  | "model"
  | "serialNumber"
  | "partNumber"
  | "status"
  | "issues"
  | "locationId"
  | "location"
>;

interface InventoryResultProps {
  machineId: string;
  /** null: el ID no corresponde a ningun equipo (se ofrece el alta) */
  product: ScannedProduct | null;
  onAgain: () => void;
}

const REASON_MIN = 5;
const REASON_MAX = 300;

// Escaneo desde Inventario: ficha resumida, notas privadas y baja con motivo; o
// el alta prellenada si el equipo no existe
export function InventoryResult({ machineId, product, onAgain }: InventoryResultProps) {
  const { t } = useI18n();
  const [retireOpen, setRetireOpen] = useState(false);
  const [retired, setRetired] = useState(false);

  if (!product) {
    const newUrl = `${ROUTES.MOBILE_NEW_EQUIPMENT}?machineId=${encodeURIComponent(machineId)}`;
    return (
      <Card className="space-y-3 p-5 text-center hover:translate-y-0">
        <SearchX className="mx-auto h-7 w-7 text-muted-foreground" />
        <p className="font-mono text-sm font-semibold text-foreground">{machineId}</p>
        <p className="text-sm text-muted-foreground">{t("mobile.inventory.unknown")}</p>
        <Button className="w-full" asChild>
          <Link to={newUrl}>
            <PackagePlus className="h-4 w-4" />
            {t("mobile.inventory.register")}
          </Link>
        </Button>
        <Button variant="secondary" className="w-full" onClick={onAgain}>
          <QrCode className="h-4 w-4" />
          {t("mobile.scan.again")}
        </Button>
      </Card>
    );
  }

  const status = EQUIPMENT_STATUS_CONFIG[retired ? "retired" : product.status];

  return (
    <div className="space-y-4">
      <Card className="hover:translate-y-0">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-lg font-semibold text-primary">{product.machineId}</p>
              <p className="truncate text-sm text-foreground">
                {product.brand} {product.model}
              </p>
            </div>
            <Badge color={status.color} withDot>
              {status.label}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DetailRow label={t("label.type")} value={equipmentKindLabel(product.kind)} />
            <DetailRow label={t("label.location")} value={product.location} />
            <DetailRow label={t("label.serialNumber")} value={product.serialNumber || "—"} />
            <DetailRow label={t("label.partNumber")} value={product.partNumber || "—"} />
          </div>
          {product.issues && (
            <DetailRow label={t("inventory.detail.issues")} value={product.issues} />
          )}
        </CardContent>
      </Card>

      {retired ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl bg-success/10 p-3 text-sm text-success"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {t("mobile.inventory.retired")}
        </div>
      ) : (
        <>
          <EquipmentNotes productId={product.id} />
          {product.status !== "retired" && (
            <Button variant="destructive" className="w-full" onClick={() => setRetireOpen(true)}>
              <Trash2 className="h-4 w-4" />
              {t("mobile.inventory.retire")}
            </Button>
          )}
        </>
      )}

      <Button variant="secondary" className="w-full" onClick={onAgain}>
        <QrCode className="h-4 w-4" />
        {t("mobile.scan.again")}
      </Button>

      <RetireDialog
        product={product}
        open={retireOpen}
        onOpenChange={setRetireOpen}
        onRetired={() => {
          setRetireOpen(false);
          setRetired(true);
        }}
      />
    </div>
  );
}

interface RetireDialogProps {
  product: ScannedProduct;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetired: () => void;
}

// Baja logica con motivo (queda en la auditoria). No va por la cola offline: es
// destructiva y el servidor puede rechazarla (prestamos o tickets en curso).
function RetireDialog({ product, open, onOpenChange, onRetired }: RetireDialogProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (!next) setError("");
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    const text = reason.trim();
    if (text.length < REASON_MIN) {
      setError(t("mobile.inventory.reasonShort", { min: REASON_MIN }));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await gql(RETIRE_PRODUCT_MUTATION, { id: product.id, reason: text });
      onRetired();
    } catch (err) {
      setError(errorMessage(err, t("retire.failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("retire.title.product")}</DialogTitle>
          <DialogDescription>
            {t("retire.description", { name: product.machineId })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="retire-reason">{t("mobile.inventory.reason")}</Label>
          <Textarea
            id="retire-reason"
            value={reason}
            maxLength={REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("mobile.inventory.reasonPlaceholder")}
            className="h-24"
          />
        </div>
        <ErrorAlert>{error}</ErrorAlert>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={saving}>
            {saving ? t("retire.retiring") : t("inventory.detail.retire")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
