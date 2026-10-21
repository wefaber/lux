import { useState, type FormEvent } from "react";
import { gql, errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/useI18n";
import { ErrorAlert } from "@/components/ui/error-alert";

const RETURN_MUTATION = `
 mutation ReturnLoan($id: ID!) { returnLoan(id: $id) { id status actualReturnDate } }
`;

interface ReturnFormProps {
  loanId: string;
  onSuccess: () => void;
}

export function ReturnForm({ loanId, onSuccess }: ReturnFormProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await gql(RETURN_MUTATION, { id: loanId });
      onSuccess();
    } catch (err) {
      setError(errorMessage(err, t("loans.returnForm.failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("loans.returnForm.note")}</p>
      <ErrorAlert>{error}</ErrorAlert>
      <div className="flex gap-2 justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? t("loans.returnDialog.registering") : t("loans.returnForm.confirm")}
        </Button>
      </div>
    </form>
  );
}
