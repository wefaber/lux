import { useState, type FormEvent } from "react";
import { useAsync } from "@/hooks/useSkeleton";
import { useLocations } from "@/hooks/useLocations";
import { gql, toDateTimeInput, fromDateTimeInput } from "@/lib/utils";
import { RESERVATION_RESOURCE_LABELS } from "@/lib/constants";
import {
  validateReservation,
  type FieldErrors,
  type ReservationFields,
} from "@/lib/validation";
import type { Product, Reservation, ReservationResource } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const PRODUCTS_QUERY = `
  query GetProducts {
    products { id machineId kind brand model status location }
  }
`;
const CREATE_MUTATION = `
  mutation CreateReservation($input: ReservationInput!) { createReservation(input: $input) { id } }
`;
const UPDATE_MUTATION = `
  mutation UpdateReservation($id: ID!, $input: ReservationUpdateInput!) { updateReservation(id: $id, input: $input) { id } }
`;

export function resourceName(r: Pick<Reservation, "equipment" | "location">): string {
  if (r.equipment) return `${r.equipment.machineId} · ${r.equipment.brand} ${r.equipment.model}`;
  return r.location?.name ?? "—";
}

interface ReservationFormProps {
  /** null = pedir una nueva; si viene, se modifican fechas y motivo */
  reservation: Reservation | null;
  onDone: () => void;
  onCancel: () => void;
}

// Pedir una reserva (cualquier rol) o modificarla (staff). Al modificar, el
// recurso queda fijo: cambian las fechas y el motivo
export function ReservationForm({ reservation, onDone, onCancel }: ReservationFormProps) {
  const isEdit = reservation !== null;
  const { data: productsData } = useAsync<{ products: Product[] }>(
    () => (isEdit ? Promise.resolve({ products: [] }) : gql(PRODUCTS_QUERY)),
    [isEdit],
  );
  const { locations } = useLocations();
  // En reparacion o de baja no se reserva
  const products = (productsData?.products ?? []).filter(
    (p) => p.status !== "in_repair" && p.status !== "retired",
  );

  const defaultStart = new Date(Date.now() + 60 * 60_000);
  defaultStart.setMinutes(0, 0, 0);
  const [resourceType, setResourceType] = useState<ReservationResource>("equipment");
  const [equipmentId, setEquipmentId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [form, setForm] = useState({
    startsAt: toDateTimeInput(reservation?.startsAt ?? defaultStart),
    endsAt: toDateTimeInput(
      reservation?.endsAt ?? new Date(defaultStart.getTime() + 2 * 60 * 60_000),
    ),
    purpose: reservation?.purpose ?? "",
  });
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<keyof ReservationFields | "resource">
  >({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const update = (k: keyof ReservationFields, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((e) => ({ ...e, [k]: undefined }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const fields: ReservationFields = {
      startsAt: fromDateTimeInput(form.startsAt),
      endsAt: fromDateTimeInput(form.endsAt),
      purpose: form.purpose,
    };
    const errors: FieldErrors<keyof ReservationFields | "resource"> = validateReservation(fields);
    const resourceId = resourceType === "equipment" ? equipmentId : locationId;
    if (!isEdit && !resourceId) {
      errors.resource =
        resourceType === "equipment" ? "Elegí el equipo a reservar" : "Elegí el espacio a reservar";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError("");
    try {
      await (isEdit
        ? gql(UPDATE_MUTATION, { id: reservation.id, input: fields })
        : gql(CREATE_MUTATION, {
            input: {
              ...fields,
              resourceType,
              ...(resourceType === "equipment" ? { equipmentId } : { locationId }),
            },
          }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar la reserva");
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (k: keyof ReservationFields | "resource") =>
    fieldErrors[k] && <p className="text-xs text-destructive">{fieldErrors[k]}</p>;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Modificar reserva" : "Nueva reserva"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {isEdit ? (
          <div className="space-y-1.5">
            <Label>{RESERVATION_RESOURCE_LABELS[reservation.resourceType]}</Label>
            <p className="text-sm text-foreground">{resourceName(reservation)}</p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Qué querés reservar</Label>
              <div className="flex gap-2" role="radiogroup" aria-label="Qué querés reservar">
                {(Object.keys(RESERVATION_RESOURCE_LABELS) as ReservationResource[]).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    role="radio"
                    aria-checked={resourceType === t}
                    variant={resourceType === t ? "default" : "secondary"}
                    onClick={() => {
                      setResourceType(t);
                      setFieldErrors((e) => ({ ...e, resource: undefined }));
                    }}
                  >
                    {RESERVATION_RESOURCE_LABELS[t]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rsv-resource">
                {resourceType === "equipment" ? "Equipo" : "Espacio"}
              </Label>
              {resourceType === "equipment" ? (
                // Mismo buscador que el equipo de un ticket: por ID, marca, modelo o ubicacion
                <SearchSelect
                  id="rsv-resource"
                  items={products}
                  value={equipmentId}
                  onChange={(eqId) => {
                    setEquipmentId(eqId);
                    setFieldErrors((er) => ({ ...er, resource: undefined }));
                  }}
                  getKey={(p) => p.id}
                  getLabel={(p) => `${p.machineId} · ${p.brand} ${p.model}`}
                  getSearchText={(p) => `${p.machineId} ${p.kind} ${p.brand} ${p.model} ${p.location}`}
                  placeholder="Buscar: proyector, L1-PC3, Laboratorio 1..."
                  renderOption={(p) => (
                    <>
                      <span className="font-mono text-xs text-primary font-semibold">{p.machineId}</span>
                      <span className="text-foreground">
                        {p.brand} {p.model}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">{p.location}</span>
                    </>
                  )}
                />
              ) : (
                <SearchSelect
                  id="rsv-resource"
                  items={locations}
                  value={locationId}
                  onChange={(locId) => {
                    setLocationId(locId);
                    setFieldErrors((er) => ({ ...er, resource: undefined }));
                  }}
                  getKey={(l) => l.id}
                  getLabel={(l) => `${l.name} (${l.code})`}
                  placeholder="Buscar: laboratorio 2, L2..."
                  renderOption={(l) => (
                    <>
                      <span className="font-mono text-xs text-primary font-semibold">{l.code}</span>
                      <span className="text-foreground">{l.name}</span>
                    </>
                  )}
                />
              )}
              {fieldError("resource")}
            </div>
          </>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="rsv-start">Desde</Label>
            <Input
              id="rsv-start"
              type="datetime-local"
              value={form.startsAt}
              min={toDateTimeInput()}
              onChange={(e) => update("startsAt", e.target.value)}
            />
            {fieldError("startsAt")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rsv-end">Hasta</Label>
            <Input
              id="rsv-end"
              type="datetime-local"
              value={form.endsAt}
              min={form.startsAt}
              onChange={(e) => update("endsAt", e.target.value)}
            />
            {fieldError("endsAt")}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rsv-purpose">Motivo</Label>
          <Textarea
            id="rsv-purpose"
            placeholder="Ej: Clase práctica de redes de 3er año"
            value={form.purpose}
            onChange={(e) => update("purpose", e.target.value)}
            maxLength={300}
            className="h-20"
          />
          {fieldError("purpose")}
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
          {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Pedir reserva"}
        </Button>
      </DialogFooter>
    </form>
  );
}
