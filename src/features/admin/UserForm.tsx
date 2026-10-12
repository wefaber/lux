import { useState, type FormEvent } from "react";
import { gql } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/constants";
import { ASSIGNABLE_ROLES } from "@/lib/roles";
import { validateUser, type FieldErrors, type UserFields } from "@/lib/validation";
import type { User, UserRole } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";

const CREATE_USER_MUTATION = `
 mutation CreateUser($input: UserInput!) { createUser(input: $input) { id } }
`; //Mutacion de usuarios en caso de creacion

const UPDATE_USER_MUTATION = `
 mutation UpdateUser($id: ID!, $input: UserInput!) { updateUser(id: $id, input: $input) { id } }
`; // Mutacion de usuarios en caso de actualizacion

interface UserFormProps {
  user?: User;
  onSuccess: () => void;
} // intefaz de usuario con formulario

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

export function UserForm({ user, onSuccess }: UserFormProps) {
  const isEdit = !!user;
  // El rol del Super Admin es fijo: no se ofrece cambiarlo
  const roleLocked = user?.role === "root_admin";
  const [name, setName] = useState(user?.name ?? "");
  const [dni, setDni] = useState(user?.dni ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<UserRole>(user?.role ?? "solicitante");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof UserFields>>({});

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    // Mismas reglas que la API: el error aparece junto al campo sin ir al servidor
    const errors = validateUser({ name, dni, email, role, password }, !isEdit);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const input = { name, dni, email, role, ...(password ? { password } : {}) };
      if (isEdit) {
        await gql(UPDATE_USER_MUTATION, { id: user.id, input });
      } else {
        await gql(CREATE_USER_MUTATION, { input });
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="uf-name">Nombre completo</Label>
        <Input id="uf-name" value={name} onChange={(e) => setName(e.target.value)} required />
        <FieldError message={fieldErrors.name} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="uf-dni">Cédula</Label>
          <Input
            id="uf-dni"
            value={dni}
            onChange={(e) => setDni(e.target.value)}
            inputMode="numeric"
            maxLength={8}
            required
          />
          <FieldError message={fieldErrors.dni} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="uf-role">Rol</Label>
          {roleLocked ? (
            <Input id="uf-role" value={ROLE_LABELS[role]} disabled />
          ) : (
            <OptionSelect
              id="uf-role"
              size="md"
              value={role}
              onValueChange={(v) => setRole(v as UserRole)}
              options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            />
          )}
          <FieldError message={fieldErrors.role} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="uf-email">Email</Label>
        <Input
          id="uf-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <FieldError message={fieldErrors.email} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="uf-password">Contraseña {isEdit && "(dejar vacío para no cambiar)"}</Label>
        <Input
          id="uf-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={!isEdit}
        />
        <FieldError message={fieldErrors.password} />
      </div>
      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear usuario"}
        </Button>
      </div>
    </form>
  );
}
