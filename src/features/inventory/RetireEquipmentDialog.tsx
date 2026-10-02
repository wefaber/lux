import { useState } from "react";
import { gql } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
      setError(err instanceof Error ? err.message : "Error al dar de baja");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Dar de baja {kind === "product" ? "el equipo" : "el componente"}
          </DialogTitle>
          <DialogDescription>
            {name} deja de figurar en el inventario. El historial se conserva.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={saving}>
            {saving ? "Dando de baja..." : "Dar de baja"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
