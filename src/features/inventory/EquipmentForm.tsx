import { useState, type FormEvent } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { gql } from "@/lib/utils";
import { useAsync } from "@/hooks/useSkeleton";
import { useLocations } from "@/hooks/useLocations";
import { ROUTES, EQUIPMENT_KINDS } from "@/lib/constants";
import {
  suggestMachineId,
  validateComponent,
  validateProduct,
  type FieldErrors,
} from "@/lib/validation";
import type { Component, Product } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";

const CREATE_PRODUCT_MUTATION = `
  mutation CreateProduct($input: ProductInput!) {
    createProduct(input: $input) { id }
  }
`;

const UPDATE_PRODUCT_MUTATION = `
  mutation UpdateProduct($id: ID!, $input: ProductUpdateInput!) {
    updateProduct(id: $id, input: $input) { id }
  }
`;

const CREATE_COMPONENT_MUTATION = `
  mutation CreateComponent($input: ComponentInput!) {
    createComponent(input: $input) { id }
  }
`;

const UPDATE_COMPONENT_MUTATION = `
  mutation UpdateComponent($id: ID!, $input: ComponentUpdateInput!) {
    updateComponent(id: $id, input: $input) { id }
  }
`;

const PRODUCT_QUERY = `
  query GetProduct($id: ID!) {
    product(id: $id) { id machineId kind brand model serialNumber partNumber status issues locationId location deletedAt }
  }
`;

const COMPONENT_QUERY = `
  query GetComponent($id: ID!) {
    component(id: $id) { id name model manufacturer serialNumber partNumber isFactory isWorking deletedAt }
  }
`;

const MACHINE_IDS_QUERY = `query GetProducts { products { id machineId } }`;

const SELECT_CLASS =
  "flex h-10 w-full rounded-xl border border-input bg-card/50 px-3 text-sm text-foreground focus:outline-none focus:border-ring";

type FormState = {
  machineId: string;
  kind: string;
  brand: string;
  model: string;
  serialNumber: string;
  partNumber: string;
  status: string;
  issues: string;
  locationId: string;
  name: string;
  manufacturer: string;
  isFactory: boolean;
  isWorking: boolean;
};

const EMPTY_FORM: FormState = {
  machineId: "",
  kind: "AIO",
  brand: "",
  model: "",
  serialNumber: "",
  partNumber: "",
  status: "available",
  issues: "",
  locationId: "", // vacio = la primera ubicacion disponible
  name: "",
  manufacturer: "",
  isFactory: true,
  isWorking: true,
};

interface EquipmentFormProps {
  mode: "product" | "component";
}

// Con :id en la ruta edita el registro existente; sin :id da de alta uno nuevo
export function EquipmentForm({ mode }: EquipmentFormProps) {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useAsync<{
    product?: Product | null;
    component?: Component | null;
  } | null>(
    () =>
      id
        ? gql(mode === "product" ? PRODUCT_QUERY : COMPONENT_QUERY, { id })
        : Promise.resolve(null),
    [id, mode],
  );

  if (!id) return <EquipmentFormFields mode={mode} initial={EMPTY_FORM} />;

  const record = mode === "product" ? data?.product : data?.component;
  if (isLoading && !data) return <TableSkeleton rows={4} cols={2} />;
  if (error || !record || record.deletedAt) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        {error ?? "El equipo no existe o fue dado de baja"}
      </div>
    );
  }

  // Se distingue por cual vino (product o component) y no por record.type: la query
  // no pide `type`, y una API GraphQL real solo devuelve los campos pedidos
  const initial: FormState = data?.product
    ? { ...EMPTY_FORM, ...data.product, issues: data.product.issues ?? "" }
    : { ...EMPTY_FORM, ...data?.component };

  return <EquipmentFormFields mode={mode} id={id} initial={initial} />;
}

interface EquipmentFormFieldsProps {
  mode: "product" | "component";
  id?: string;
  initial: FormState;
}

function EquipmentFormFields({ mode, id, initial }: EquipmentFormFieldsProps) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof FormState>>({});
  const [form, setForm] = useState<FormState>(initial);
  const isEdit = Boolean(id);

  const { data: idsData } = useAsync<{ products: Array<{ id: string; machineId: string }> }>(
    () => (mode === "product" ? gql(MACHINE_IDS_QUERY) : Promise.resolve({ products: [] })),
    [mode],
  );
  const takenIds = (idsData?.products ?? []).filter((p) => p.id !== id).map((p) => p.machineId);
  const { locations } = useLocations();
  const locationId = form.locationId || locations[0]?.id || "";
  const location = locations.find((l) => l.id === locationId);
  const suggestion =
    mode === "product" ? suggestMachineId(form.kind, location?.code, takenIds) : null;

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((e) => ({ ...e, [k]: undefined }));
  };

  const detailRoute =
    mode === "product" ? `${ROUTES.INVENTORY}/${id}` : `${ROUTES.INVENTORY}/componente/${id}`;
  const backRoute = isEdit ? detailRoute : ROUTES.INVENTORY;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errors: FieldErrors<keyof FormState> =
      mode === "product"
        ? (validateProduct({ ...form, location }) as FieldErrors<keyof FormState>)
        : validateComponent(form);
    if (mode === "product" && takenIds.includes(form.machineId.trim().toUpperCase())) {
      errors.machineId = `Ya existe un equipo con ID ${form.machineId.trim().toUpperCase()}`;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setError("");
    try {
      if (mode === "product") {
        const input = {
          machineId: form.machineId,
          kind: form.kind,
          brand: form.brand,
          model: form.model,
          serialNumber: form.serialNumber,
          partNumber: form.partNumber,
          issues: form.issues || null,
          locationId,
        };
        await (isEdit
          ? gql(UPDATE_PRODUCT_MUTATION, { id, input })
          : gql(CREATE_PRODUCT_MUTATION, { input: { ...input, status: form.status } }));
      } else {
        const input = {
          name: form.name,
          model: form.model,
          manufacturer: form.manufacturer,
          serialNumber: form.serialNumber,
          partNumber: form.partNumber,
          isFactory: form.isFactory,
          isWorking: form.isWorking,
        };
        await (isEdit
          ? gql(UPDATE_COMPONENT_MUTATION, { id, input })
          : gql(CREATE_COMPONENT_MUTATION, { input }));
      }
      navigate(isEdit ? detailRoute : ROUTES.INVENTORY);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const field = (
    key: keyof FormState,
    label: string,
    extra?: { mono?: boolean; upper?: boolean },
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        value={String(form[key])}
        onChange={(e) => update(key, extra?.upper ? e.target.value.toUpperCase() : e.target.value)}
        aria-invalid={Boolean(fieldErrors[key])}
        className={fieldErrors[key] ? "border-destructive" : extra?.mono ? "font-mono" : undefined}
        required
      />
      {fieldErrors[key] && <p className="text-xs text-destructive">{fieldErrors[key]}</p>}
    </div>
  );

  const title = isEdit
    ? mode === "product"
      ? "Editar equipo"
      : "Editar componente"
    : mode === "product"
      ? "Nuevo equipo"
      : "Nuevo componente";

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to={backRoute}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{mode === "product" ? "Datos del equipo" : "Datos del componente"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {mode === "product" ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="kind">Tipo</Label>
                    <select
                      id="kind"
                      value={form.kind}
                      onChange={(e) => update("kind", e.target.value)}
                      className={SELECT_CLASS}
                    >
                      {EQUIPMENT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="location">Ubicación</Label>
                    <select
                      id="location"
                      value={locationId}
                      onChange={(e) => update("locationId", e.target.value)}
                      className={SELECT_CLASS}
                    >
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.code})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {field("machineId", "ID de máquina", { mono: true, upper: true })}
                  {suggestion && (
                    <p className="text-xs text-muted-foreground">
                      Formato: ubicación y área, tipo y número. Próximo libre:{" "}
                      <button
                        type="button"
                        className="font-mono text-primary font-semibold hover:underline cursor-pointer"
                        onClick={() => update("machineId", suggestion)}
                      >
                        {suggestion}
                      </button>
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {field("brand", "Marca")}
                  {field("model", "Modelo")}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {field("serialNumber", "N° de serie", { mono: true, upper: true })}
                  {field("partNumber", "Part number", { mono: true, upper: true })}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="issues">Fallas / Observaciones</Label>
                  <Textarea
                    id="issues"
                    value={form.issues}
                    onChange={(e) => update("issues", e.target.value)}
                    placeholder="Opcional"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  {field("name", "Nombre del componente")}
                  {field("model", "Modelo")}
                </div>
                {field("manufacturer", "Fabricante")}
                <div className="grid grid-cols-2 gap-4">
                  {field("serialNumber", "N° de serie", { mono: true, upper: true })}
                  {field("partNumber", "Part number", { mono: true, upper: true })}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isFactory}
                      onChange={(e) => update("isFactory", e.target.checked)}
                      className="h-4 w-4 rounded"
                    />
                    <span className="text-sm text-foreground">¿Es de fábrica?</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isWorking}
                      onChange={(e) => update("isWorking", e.target.checked)}
                      className="h-4 w-4 rounded"
                    />
                    <span className="text-sm text-foreground">¿Está funcionando?</span>
                  </label>
                </div>
              </>
            )}

            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="secondary" asChild>
                <Link to={backRoute}>Cancelar</Link>
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Guardar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
