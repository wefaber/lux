import { useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, MapPin } from "lucide-react";
import { useLocations } from "@/hooks/useLocations";
import { gql, formatDate, cn } from "@/lib/utils";
import {
  locationCode,
  validateLocation,
  type FieldErrors,
  type LocationFields,
} from "@/lib/validation";
import { LOCATION_KIND_LABELS } from "@/lib/constants";
import type { Location, LocationKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CREATE_LOCATION_MUTATION = `
  mutation CreateLocation($input: LocationInput!) { createLocation(input: $input) { id } }
`;
const UPDATE_LOCATION_MUTATION = `
  mutation UpdateLocation($id: ID!, $input: LocationUpdateInput!) { updateLocation(id: $id, input: $input) { id } }
`;
const DELETE_LOCATION_MUTATION = `
  mutation SoftDeleteLocation($id: ID!) { softDeleteLocation(id: $id) }
`;

// ABM de ubicaciones para el staff. Antes eran cuatro strings fijos en el codigo
export function LocationsPage() {
  const { locations, isLoading, error, refetch } = useLocations();
  // null = cerrado, "new" = alta, Location = edicion
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const [deleting, setDeleting] = useState<Location | null>(null);

  const done = () => {
    setEditing(null);
    setDeleting(null);
    refetch();
  };

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Ubicaciones</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Laboratorios, salones y oficinas. El código (L1 = Laboratorio 1) arranca el ID de sus equipos: L1-PC3.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5" />
          Nueva ubicación
        </Button>
      </div>

      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          Error: {error}
        </div>
      )}

      {isLoading && locations.length === 0 ? (
        <TableSkeleton rows={4} cols={5} />
      ) : locations.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No hay ubicaciones registradas
        </div>
      ) : (
        <div
          className={cn(
            "rounded-2xl border border-border/70 overflow-x-auto bg-card/20 backdrop-blur-sm transition-all duration-300",
            isLoading && "opacity-75 pointer-events-none",
          )}
        >
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Código", "Nombre", "Tipo", "Equipos", "Actualizada", ""].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-sm font-semibold text-primary">
                    {l.code}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-foreground">
                    <span className="inline-flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {l.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {LOCATION_KIND_LABELS[l.kind]}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{l.productCount}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(l.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(l)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleting(l)}
                        disabled={l.productCount > 0}
                        title={
                          l.productCount > 0
                            ? "Tiene equipos: movelos a otra ubicación para poder eliminarla"
                            : undefined
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Eliminar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md">
          {editing !== null && (
            <LocationForm
              // key: al pasar de una ubicacion a otra el formulario arranca de cero
              key={editing === "new" ? "new" : editing.id}
              location={editing === "new" ? null : editing}
              existing={locations}
              onDone={done}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <DeleteLocationDialog location={deleting} onDone={done} onCancel={() => setDeleting(null)} />
    </div>
  );
}

// Nombre sugerido a partir del tipo y el numero: Laboratorio 3
function autoName(kind: string, number: number): string {
  return `${LOCATION_KIND_LABELS[kind as LocationKind]} ${Number.isInteger(number) ? number : ""}`.trim();
}

interface LocationFormProps {
  location: Location | null;
  /** Las ya registradas, para proponer el proximo numero libre de cada tipo */
  existing: Location[];
  onDone: () => void;
  onCancel: () => void;
}

function LocationForm({ location, existing, onDone, onCancel }: LocationFormProps) {
  // Proximo numero libre del tipo: con Laboratorio 1 y 2 registrados, propone el 3
  const nextNumber = (kind: string) =>
    Math.max(0, ...existing.filter((l) => l.kind === kind).map((l) => l.number)) + 1;
  const [form, setForm] = useState<LocationFields>(() => {
    const kind = location?.kind ?? "laboratory";
    const number = location?.number ?? nextNumber(kind);
    return { kind, number, name: location?.name ?? `${LOCATION_KIND_LABELS[kind]} ${number}` };
  });
  // Mientras no se escriba un nombre propio, sigue al tipo y numero (Laboratorio 3)
  const [nameTouched, setNameTouched] = useState(location !== null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof LocationFields>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Con equipos, tipo y numero quedan fijos: forman el codigo de su ID de maquina
  const codeLocked = (location?.productCount ?? 0) > 0;
  const code = locationCode(form.kind, form.number);

  const update = <K extends keyof LocationFields>(k: K, v: LocationFields[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      return nameTouched || k === "name" ? next : { ...next, name: autoName(next.kind, next.number) };
    });
    setFieldErrors((e) => ({ ...e, [k]: undefined, ...(nameTouched ? {} : { name: undefined }) }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errors = validateLocation(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError("");
    try {
      const input = { kind: form.kind, number: form.number, name: form.name.trim() };
      await (location
        ? gql(UPDATE_LOCATION_MUTATION, { id: location.id, input })
        : gql(CREATE_LOCATION_MUTATION, { input }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar la ubicación");
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (k: keyof LocationFields) =>
    fieldErrors[k] && <p className="text-xs text-destructive">{fieldErrors[k]}</p>;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>{location ? "Editar ubicación" : "Nueva ubicación"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="loc-kind">Tipo</Label>
            <select
              id="loc-kind"
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value;
                // Al cambiar de tipo, el numero pasa al proximo libre de ese tipo
                setForm((f) => {
                  const number = location ? f.number : nextNumber(kind);
                  return {
                    kind,
                    number,
                    name: nameTouched ? f.name : autoName(kind, number),
                  };
                });
                setFieldErrors({});
              }}
              disabled={codeLocked}
              className="flex h-10 w-full rounded-xl border border-input bg-card/50 px-3 text-sm text-foreground focus:outline-none focus:border-ring disabled:opacity-50"
            >
              {Object.entries(LOCATION_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {fieldError("kind")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc-number">Número</Label>
            <Input
              id="loc-number"
              type="number"
              min={1}
              max={99}
              value={Number.isNaN(form.number) ? "" : form.number}
              onChange={(e) => update("number", e.target.valueAsNumber)}
              disabled={codeLocked}
            />
          </div>
        </div>
        {fieldError("number")}
        <p className="text-xs text-muted-foreground">
          {codeLocked
            ? `Código ${location?.code}: no se puede cambiar, ${location?.productCount} equipo(s) lo usan en su ID de máquina.`
            : code
              ? `Código: ${code}. Sus equipos se nombran ${code}-PC1, ${code}-PRY1…`
              : "El código sale del tipo y el número (L1 = Laboratorio 1)."}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="loc-name">Nombre</Label>
          <Input
            id="loc-name"
            placeholder="Ej: Laboratorio 3"
            value={form.name}
            onChange={(e) => {
              setNameTouched(true);
              update("name", e.target.value);
            }}
            aria-invalid={Boolean(fieldErrors.name)}
          />
          {fieldError("name")}
        </div>
        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Guardando..." : location ? "Guardar cambios" : "Crear ubicación"}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface DeleteLocationDialogProps {
  location: Location | null;
  onDone: () => void;
  onCancel: () => void;
}

function DeleteLocationDialog({ location, onDone, onCancel }: DeleteLocationDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setError("");
    onCancel();
  };

  const handleConfirm = async () => {
    if (!location) return;
    setSaving(true);
    setError("");
    try {
      await gql(DELETE_LOCATION_MUTATION, { id: location.id });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar la ubicación");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={location !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Eliminar ubicación</DialogTitle>
          <DialogDescription>
            {location?.name} ({location?.code}) deja de figurar en filtros y formularios.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={saving}>
            {saving ? "Eliminando..." : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
