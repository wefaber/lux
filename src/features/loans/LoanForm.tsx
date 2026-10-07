import { useState, type FormEvent } from "react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { gql } from "@/lib/utils";
import type { Product, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

const SELECT_CLASS =
  "h-10 w-full rounded-xl border border-input bg-card/50 px-3 text-sm text-foreground focus:outline-none focus:border-ring cursor-pointer";

interface LoanFormProps {
  onSuccess: () => void;
}

export function LoanForm({ onSuccess }: LoanFormProps) {
  const [equipmentId, setEquipmentId] = useState("");
  const [userId, setUserId] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 16));
  const [returnDate, setReturnDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { hasRole } = useAuth();

  // El staff registra a nombre de cualquier usuario; el solicitante pide para si mismo
  const isStaff = hasRole("root_admin", "admin", "tecnico");

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
    if (!equipmentId || (isStaff && !userId) || !returnDate) {
      setError("Completá todos los campos requeridos.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await gql(CREATE_LOAN_MUTATION, {
        input: { equipmentId, userId: isStaff ? userId : undefined, issueDate, returnDate },
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label htmlFor="loan-equipment">Equipo</Label>
        <select
          id="loan-equipment"
          value={equipmentId}
          onChange={(e) => setEquipmentId(e.target.value)}
          className={SELECT_CLASS}
          required
        >
          <option value="">
            {loadingProducts
              ? "Cargando equipos..."
              : products.length === 0
                ? "No hay equipos disponibles"
                : "Seleccioná un equipo"}
          </option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.machineId} · {p.brand} {p.model} ({p.location})
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Solo se listan los equipos disponibles</p>
      </div>
      {isStaff && (
        <div className="space-y-1.5">
          <Label htmlFor="loan-user">Usuario</Label>
          <select
            id="loan-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className={SELECT_CLASS}
            required
          >
            <option value="">Seleccioná un usuario</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.dni}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="loan-issue">Fecha de entrega</Label>
          <Input
            id="loan-issue"
            type="datetime-local"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loan-return">Fecha de devolución</Label>
          <Input
            id="loan-return"
            type="datetime-local"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
            required
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "Enviando..." : isStaff ? "Registrar préstamo" : "Solicitar préstamo"}
        </Button>
      </div>
    </form>
  );
}
