import { useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, MapPin, Search } from "lucide-react";
import { useLocations } from "@/hooks/useLocations";
import { useI18n } from "@/hooks/useI18n";
import { gql, formatDate, cn, errorMessage } from "@/lib/utils";
import {
  locationCode,
  locationConflict,
  validateLocation,
  type FieldErrors,
  type LocationFields,
} from "@/lib/validation";
import { LOCATION_KIND_LABELS, LOCATION_KIND_ORDER } from "@/lib/constants";
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
import { OptionSelect } from "@/components/ui/option-select";
import { ErrorAlert } from "@/components/ui/error-alert";

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
  const { t } = useI18n();
  const { locations, isLoading, error, refetch } = useLocations();
  // null = cerrado, "new" = alta, Location = edicion
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const [deleting, setDeleting] = useState<Location | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<LocationKind | "">("");

  const done = () => {
    setEditing(null);
    setDeleting(null);
    refetch();
  };

  const term = search.trim().toLowerCase();
  // Las areas se ordenan por tipo (aulas, oficinas, especiales) y numero, no
  // por el orden en que se dieron de alta
  const visible = locations
    .filter(
      (l) =>
        (!kindFilter || l.kind === kindFilter) &&
        (!term ||
          l.name.toLowerCase().includes(term) ||
          l.code.toLowerCase().includes(term)),
    )
    .toSorted(
      (a, b) =>
        LOCATION_KIND_ORDER.indexOf(a.kind) - LOCATION_KIND_ORDER.indexOf(b.kind) ||
        a.number - b.number,
    );
  const equipment = locations.reduce((sum, l) => sum + l.productCount, 0);

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("locations.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("locations.subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5" />
          {t("locations.new")}
        </Button>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute z-10 left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("locations.search")}
            aria-label={t("locations.searchLabel")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <OptionSelect
          aria-label={t("locations.filterKind")}
          value={kindFilter}
          onValueChange={(v) => setKindFilter(v as LocationKind | "")}
          options={[
            { value: "", label: t("locations.allKinds") },
            ...LOCATION_KIND_ORDER.map((kind) => ({
              value: kind,
              label: LOCATION_KIND_LABELS[kind],
            })),
          ]}
        />
        {locations.length > 0 && (
          <p className="text-xs text-muted-foreground ms-auto">
            {t("locations.summary", { count: locations.length, equipment })}
          </p>
        )}
      </div>

      {error && <ErrorAlert>{t("common.error", { error })}</ErrorAlert>}

      {isLoading && locations.length === 0 ? (
        <TableSkeleton rows={4} cols={5} />
      ) : locations.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {t("locations.empty")}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-muted-foreground text-sm">{t("locations.emptyFiltered")}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setKindFilter("");
            }}
          >
            {t("locations.clearFilters")}
          </Button>
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
                {[
                  t("locations.col.code"),
                  t("label.name"),
                  t("label.type"),
                  t("locations.col.equipment"),
                  t("locations.col.updated"),
                  "",
                ].map((h) => (
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
              {visible.map((l) => (
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
                        {t("common.edit")}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleting(l)}
                        disabled={l.productCount > 0}
                        title={l.productCount > 0 ? t("locations.deleteBlocked") : undefined}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("common.delete")}
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

// Nombre sugerido a partir del tipo y el numero: Laboratorio 3. Las areas
// especiales se llaman por su nombre (Direccion, Adscripciones), asi que no se
// propone uno automatico
function autoName(kind: string, number: number): string {
  if (kind === "special") return "";
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
  const { t } = useI18n();
  // Proximo numero libre del tipo: con Laboratorio 1 y 2 registrados, propone el 3
  const nextNumber = (kind: string) =>
    Math.max(0, ...existing.filter((l) => l.kind === kind).map((l) => l.number)) + 1;
  const [form, setForm] = useState<LocationFields>(() => {
    const kind = location?.kind ?? "laboratory";
    const number = location?.number ?? nextNumber(kind);
    return { kind, number, name: location?.name ?? autoName(kind, number) };
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
      return nameTouched || k === "name"
        ? next
        : { ...next, name: autoName(next.kind, next.number) };
    });
    setFieldErrors((e) => ({ ...e, [k]: undefined, ...(nameTouched ? {} : { name: undefined }) }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Las mismas reglas que la API, incluidos los duplicados de nombre y codigo
    const errors = validateLocation(form);
    const conflict = locationConflict({ ...form, code }, existing, location?.id);
    const all = { ...conflict, ...errors };
    setFieldErrors(all);
    if (Object.keys(all).length > 0) return;
    setSaving(true);
    setError("");
    try {
      const input = { kind: form.kind, number: form.number, name: form.name.trim() };
      await (location
        ? gql(UPDATE_LOCATION_MUTATION, { id: location.id, input })
        : gql(CREATE_LOCATION_MUTATION, { input }));
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("locations.form.failed")));
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (k: keyof LocationFields) =>
    fieldErrors[k] && <p className="text-xs text-destructive">{fieldErrors[k]}</p>;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>{location ? t("locations.form.titleEdit") : t("locations.new")}</DialogTitle>
        <DialogDescription>{t("locations.form.description")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="loc-kind">{t("label.type")}</Label>
            <OptionSelect
              id="loc-kind"
              className="w-full"
              value={form.kind}
              onValueChange={(kind) => {
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
              options={Object.entries(LOCATION_KIND_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            {fieldError("kind")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc-number">{t("locations.form.number")}</Label>
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
            ? t("locations.form.codeLocked", {
                code: location?.code ?? "",
                count: location?.productCount ?? 0,
              })
            : code
              ? t("locations.form.codeHint", { code })
              : t("locations.form.codeEmpty")}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="loc-name">{t("label.name")}</Label>
          <Input
            id="loc-name"
            placeholder={t("locations.form.namePlaceholder")}
            value={form.name}
            onChange={(e) => {
              setNameTouched(true);
              update("name", e.target.value);
            }}
            aria-invalid={Boolean(fieldErrors.name)}
          />
          {fieldError("name")}
        </div>
        <ErrorAlert>{error}</ErrorAlert>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={saving}>
          {saving
            ? t("common.saving")
            : location
              ? t("locations.form.saveChanges")
              : t("locations.form.submit")}
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
  const { t } = useI18n();
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
      setError(errorMessage(err, t("locations.delete.failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={location !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("locations.delete.title")}</DialogTitle>
          <DialogDescription>
            {location &&
              t("locations.delete.description", { name: location.name, code: location.code })}
          </DialogDescription>
        </DialogHeader>
        <ErrorAlert>{error}</ErrorAlert>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={saving}>
            {saving ? t("locations.delete.submitting") : t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
