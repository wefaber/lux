import { useState, type FormEvent } from "react";
import { gql } from "@/lib/utils";
import type { Loan } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const REJECT_MUTATION = `
 mutation RejectLoan($id: ID!, $reason: String!) { rejectLoan(id: $id, reason: $reason) { id status } }
`;
const RETURN_MUTATION = `
 mutation ReturnLoan($id: ID!, $damaged: Boolean, $issues: String) {
 returnLoan(id: $id, damaged: $damaged, issues: $issues) { id status }
 }
`;

interface LoanActionDialogProps {
  loan: Loan | null;
  onClose: () => void;
  onDone: () => void;
}

function equipmentName(loan: Loan): string {
  return `${loan.equipment.brand} ${loan.equipment.model}`;
}

export function RejectLoanDialog({ loan, onClose, onDone }: LoanActionDialogProps) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setReason("");
    setError("");
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!loan) return;
    if (!reason.trim()) {
      setError("Indicá el motivo del rechazo.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await gql(REJECT_MUTATION, { id: loan.id, reason });
      setReason("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al rechazar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={loan !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rechazar préstamo</DialogTitle>
          {loan && (
            <DialogDescription>
              {equipmentName(loan)} para {loan.user.name}. El solicitante verá el motivo.
            </DialogDescription>
          )}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Motivo</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: el equipo está reservado para un examen ese día"
              className="h-24"
              required
            />
          </div>
          {error && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving ? "Rechazando..." : "Rechazar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnLoanDialog({ loan, onClose, onDone }: LoanActionDialogProps) {
  const [damaged, setDamaged] = useState(false);
  const [issues, setIssues] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setDamaged(false);
    setIssues("");
    setError("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!loan) return;
    if (damaged && !issues.trim()) {
      setError("Describí la falla para que quede registrada en el equipo.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await gql(RETURN_MUTATION, {
        id: loan.id,
        damaged,
        issues: damaged ? issues : undefined,
      });
      reset();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar la devolución");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={loan !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar devolución</DialogTitle>
          {loan && (
            <DialogDescription>
              {equipmentName(loan)} prestado a {loan.user.name}.
            </DialogDescription>
          )}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={damaged}
              onChange={(e) => setDamaged(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <span className="text-sm text-foreground">
              El equipo vuelve con fallas (pasa a reparación)
            </span>
          </label>
          {damaged && (
            <div className="space-y-1.5">
              <Label htmlFor="return-issues">Descripción de la falla</Label>
              <Textarea
                id="return-issues"
                value={issues}
                onChange={(e) => setIssues(e.target.value)}
                placeholder="Ej: no enciende la pantalla"
                className="h-24"
              />
            </div>
          )}
          {error && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Registrando..." : "Registrar devolución"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
