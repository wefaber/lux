import { useState, type FormEvent } from "react";
import { gql, errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";

const RETURN_MUTATION = `
 mutation ReturnLoan($id: ID!) { returnLoan(id: $id) { id status actualReturnDate } }
`;

interface ReturnFormProps {
  loanId: string;
  onSuccess: () => void;
}

export function ReturnForm({ loanId, onSuccess }: ReturnFormProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await gql(RETURN_MUTATION, { id: loanId });
      onSuccess();
    } catch (err) {
      setError(errorMessage(err, "Error al registrar devolución"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Se registrará la devolución con la fecha y hora actual.
      </p>
      <ErrorAlert>{error}</ErrorAlert>
      <div className="flex gap-2 justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "Registrando..." : "Confirmar devolución"}
        </Button>
      </div>
    </form>
  );
}
