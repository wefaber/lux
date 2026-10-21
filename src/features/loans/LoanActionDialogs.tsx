import { useState, type FormEvent } from "react";
import { gql, errorMessage } from "@/lib/utils";
import { useI18n } from "@/hooks/useI18n";
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
import { ErrorAlert } from "@/components/ui/error-alert";

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
  const { t } = useI18n();
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
      setError(t("loans.rejectDialog.required"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await gql(REJECT_MUTATION, { id: loan.id, reason });
      setReason("");
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("loans.rejectDialog.failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={loan !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("loans.rejectDialog.title")}</DialogTitle>
          {loan && (
            <DialogDescription>
              {t("loans.rejectDialog.description", {
                equipment: equipmentName(loan),
                user: loan.user.name,
              })}
            </DialogDescription>
          )}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">{t("label.reason")}</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("loans.rejectDialog.placeholder")}
              className="h-24"
              required
            />
          </div>
          <ErrorAlert>{error}</ErrorAlert>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving ? t("loans.rejectDialog.rejecting") : t("loans.reject")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnLoanDialog({ loan, onClose, onDone }: LoanActionDialogProps) {
  const { t } = useI18n();
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
      setError(t("loans.returnDialog.issuesRequired"));
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
      setError(errorMessage(err, t("loans.returnDialog.failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={loan !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("loans.returnDialog.title")}</DialogTitle>
          {loan && (
            <DialogDescription>
              {t("loans.returnDialog.description", {
                equipment: equipmentName(loan),
                user: loan.user.name,
              })}
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
            <span className="text-sm text-foreground">{t("loans.returnDialog.damaged")}</span>
          </label>
          {damaged && (
            <div className="space-y-1.5">
              <Label htmlFor="return-issues">{t("loans.returnDialog.issues")}</Label>
              <Textarea
                id="return-issues"
                value={issues}
                onChange={(e) => setIssues(e.target.value)}
                placeholder={t("loans.returnDialog.issuesPlaceholder")}
                className="h-24"
              />
            </div>
          )}
          <ErrorAlert>{error}</ErrorAlert>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t("loans.returnDialog.registering") : t("loans.returnDialog.title")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
