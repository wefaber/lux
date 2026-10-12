import { useState, type FormEvent } from "react";
import { useAsync } from "@/hooks/useSkeleton";
import { useLocations } from "@/hooks/useLocations";
import { gql, errorMessage } from "@/lib/utils";
import { SERVICE_TYPE_LABELS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EquipmentSearchSelect, LabSearchSelect } from "@/components/search-pickers";
import type { Product, ServiceType } from "@/lib/types";
import { ErrorAlert } from "@/components/ui/error-alert";
import { firstError, validateServiceRequest } from "@/lib/validation";

const CREATE_SERVICE_MUTATION = `
 mutation CreateServiceRequest($input: ServiceRequestInput!) {
 createServiceRequest(input: $input) { id }
 }
`; // Query, alteracion/creacion de service

const PRODUCTS_QUERY = `
 query GetProducts {
 products { id machineId kind brand model location status }
 }
`;

interface ServiceFormProps {
  onSuccess: () => void;
}

export function ServiceForm({ onSuccess }: ServiceFormProps) {
  const [type, setType] = useState<ServiceType>("lab_preparation"); // constante para tipos de service en base a ServiceType
  const [description, setDescription] = useState("");
  const [labNumber, setLabNumber] = useState("");
  const [softwareName, setSoftwareName] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [saving, setSaving] = useState(false); // Variable bool que marca si esta siendo guardado o no en el sistema
  const [error, setError] = useState("");
  const { locations } = useLocations();
  const { data: productsData } = useAsync<{ products: Product[] }>(() => gql(PRODUCTS_QUERY), []);
  // Un equipo dado de baja ya no se prepara
  const products = (productsData?.products ?? []).filter((p) => p.status !== "retired");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); // Previene que se dispare el evento por defecto.
    const invalid = firstError(validateServiceRequest({ type, description }));
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(""); // En caso de error si es que hay se marca.
    try {
      await gql(CREATE_SERVICE_MUTATION, {
        input: {
          type,
          description,
          labNumber: type === "lab_preparation" ? labNumber || undefined : undefined,
          softwareName: type === "software_installation" ? softwareName || undefined : undefined,
          equipmentId: type === "equipment_setup" ? equipmentId || undefined : undefined,
        }, // Verificacion de datos con sus respectivos valores o o undefined en caso de no existir.
      }); // Entrada a la base de datos
      onSuccess();
    } catch (err) {
      setError(errorMessage(err, "Error al crear solicitud")); // Disparador de error en caso de datos erroneos
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label>Tipo de solicitud</Label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-xl border py-2.5 px-3 text-sm text-left transition-all cursor-pointer ${
                type === t
                  ? "border-[rgba(0,122,255,0.3)] bg-info-bg text-primary"
                  : "border-border bg-card/40 text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {SERVICE_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {type === "lab_preparation" && (
        <div className="space-y-1.5">
          <Label htmlFor="lab-number">Laboratorio</Label>
          <LabSearchSelect
            id="lab-number"
            items={locations}
            value={labNumber}
            onChange={setLabNumber}
          />
        </div>
      )}

      {type === "software_installation" && (
        <div className="space-y-1.5">
          <Label htmlFor="software">Nombre del software</Label>
          <Input
            id="software"
            value={softwareName}
            onChange={(e) => setSoftwareName(e.target.value)}
            placeholder="Ej: AutoCAD 2024"
          />
        </div>
      )}

      {type === "equipment_setup" && (
        <div className="space-y-1.5">
          <Label htmlFor="eq-id">Equipo</Label>
          <EquipmentSearchSelect
            id="eq-id"
            items={products}
            value={equipmentId}
            onChange={setEquipmentId}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="description">Descripción</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describí lo que necesitás en detalle..."
          className="h-32"
          required
        />
      </div>

      <ErrorAlert>{error}</ErrorAlert>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "Enviando..." : "Enviar solicitud"}
        </Button>
      </div>
    </form>
  );
}
