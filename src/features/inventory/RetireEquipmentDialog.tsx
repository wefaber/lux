import { useState } from "react";
import { gql, errorMessage } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/ui/error-alert";

const RETIRE_PRODUCT_MUTATION = `
 mutation SoftDeleteProduct($id: ID!) { softDeleteProduct(id: $id) }
`;
const RETIRE_COMPONENT_MUTATION = `
 mutation SoftDeleteComponent($id: ID!) { softDeleteComponent(id: $id) }
`;

interface RetireEquipmentDialogProps {
  kind: "product" | "component";
  id: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetired: () => void;
}

// Confirmacion de baja. El servidor la bloquea si hay prestamos o tickets en curso.
export function RetireEquipmentDialog({
  kind,
  id,
  name,
  open,
  onOpenChange,
  onRetired,
}: RetireEquipmentDialogProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (!next) setError("");
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError("");
    try {
      await gql(kind === "product" ? RETIRE_PRODUCT_MUTATION : RETIRE_COMPONENT_MUTATION, { id });
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
          <DialogTitle>
            {kind === "product" ? t("retire.title.product") : t("retire.title.component")}
          </DialogTitle>
          <DialogDescription>{t("retire.description", { name })}</DialogDescription>
        </DialogHeader>
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
