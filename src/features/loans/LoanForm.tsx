import { useState, type FormEvent } from "react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { gql, errorMessage, toDateTimeInput } from "@/lib/utils";
import type { Product, User } from "@/lib/types";
import { validateLoan, type FieldErrors, type LoanFields } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserSearchSelect } from "@/components/search-pickers";
import { OptionSelect } from "@/components/ui/option-select";
import { STAFF_ROLES } from "@/lib/roles";
import { ErrorAlert } from "@/components/ui/error-alert";

const CREATE_LOAN_MUTATION = `
 mutation CreateLoan($input: LoanInput!) {
 createLoan(input: $input) { id }
 }
`;

const AVAILABLE_PRODUCTS_QUERY = `
 query GetProducts($availableForLoan: Boolean) {
 products(availableForLoan: $availableForLoan) { id machineId kind brand model location }
 }
`;

const ACTIVE_USERS_QUERY = `
 query GetUsers($isActive: Boolean) {
 users(isActive: $isActive) { id name dni }
 }
`;

interface LoanFormProps {
  onSuccess: () => void;
}

export function LoanForm({ onSuccess }: LoanFormProps) {
  const { t } = useI18n();
  const [equipmentId, setEquipmentId] = useState("");
  const [userId, setUserId] = useState("");
  // toDateTimeInput usa la fecha local: toISOString() a las 21:00 en Uruguay
  // ya devuelve el día siguiente
  const [form, setForm] = useState<LoanFields>({
    issueDate: toDateTimeInput(),
    returnDate: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof LoanFields>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { hasRole } = useAuth();

  // El staff registra a nombre de cualquier usuario; el solicitante pide para si mismo
  const isStaff = hasRole(...STAFF_ROLES);

  // Solo se ofrecen equipos libres: ni prestados, ni en reparacion, ni aprobados para otro prestamo
  const { data: productsData, isLoading: loadingProducts } = useAsync<{ products: Product[] }>(
    () => gql(AVAILABLE_PRODUCTS_QUERY, { availableForLoan: true }),
    [],
  );
  const { data: usersData } = useAsync<{ users: User[] } | null>(
    () => (isStaff ? gql(ACTIVE_USERS_QUERY, { isActive: true }) : Promise.resolve(null)),
    [isStaff],
  );

  const products = productsData?.products ?? [];
  const users = usersData?.users ?? [];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!equipmentId || (isStaff && !userId) || !form.returnDate) {
      setError(t("loans.form.required"));
      return;
    }
    const errors = validateLoan(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError("");
    try {
      await gql(CREATE_LOAN_MUTATION, {
        input: {
          equipmentId,
          userId: isStaff ? userId : undefined,
          issueDate: form.issueDate,
          returnDate: form.returnDate,
        },
      });
      onSuccess();
    } catch (err) {
      setError(errorMessage(err, t("loans.form.failed")));
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof LoanFields, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
  };

  const fieldError = (key: keyof LoanFields) =>
    fieldErrors[key] && <p className="text-xs text-destructive">{fieldErrors[key]}</p>;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label htmlFor="loan-equipment">{t("loans.form.equipment")}</Label>
        <OptionSelect
          id="loan-equipment"
          className="w-full"
          value={equipmentId}
          onValueChange={setEquipmentId}
          disabled={loadingProducts || products.length === 0}
          placeholder={
            loadingProducts
              ? t("loans.form.loading")
              : products.length === 0
                ? t("loans.form.none")
                : t("loans.form.pick")
          }
          options={products.map((p) => ({
            value: p.id,
            label: `${p.machineId} · ${p.brand} ${p.model} (${p.location})`,
          }))}
        />
        <p className="text-xs text-muted-foreground">{t("loans.form.availableOnly")}</p>
      </div>
      {isStaff && (
        <div className="space-y-1.5">
          <Label htmlFor="loan-user">{t("loans.form.user")}</Label>
          {/* Se busca por nombre o cedula, como el equipo al crear un ticket */}
          <UserSearchSelect id="loan-user" items={users} value={userId} onChange={setUserId} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="loan-issue">{t("loans.form.issueDate")}</Label>
          <Input
            id="loan-issue"
            type="datetime-local"
            value={form.issueDate}
            // La regla es por día: hoy vale a cualquier hora, ayer no
            min={toDateTimeInput().slice(0, 10)}
            onChange={(e) => update("issueDate", e.target.value)}
            required
          />
          {fieldError("issueDate")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loan-return">{t("loans.form.returnDate")}</Label>
          <Input
            id="loan-return"
            type="datetime-local"
            value={form.returnDate}
            min={form.issueDate}
            onChange={(e) => update("returnDate", e.target.value)}
            required
          />
          {fieldError("returnDate")}
        </div>
      </div>

      <ErrorAlert>{error}</ErrorAlert>

      <div className="flex gap-2 justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? t("loans.form.sending") : isStaff ? t("loans.register") : t("loans.request")}
        </Button>
      </div>
    </form>
  );
}
