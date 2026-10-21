import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Wrench } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useI18n } from "@/hooks/useI18n";
import { gql, formatDateTime, toDateTimeInput, fromDateTimeInput, errorMessage } from "@/lib/utils";
import { INTERVENTION_TYPE_LABELS, ROUTES } from "@/lib/constants";
import { validateIntervention, type FieldErrors, type InterventionFields } from "@/lib/validation";
import type { Intervention, InterventionType, Ticket } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const INTERVENTIONS_QUERY = `
  query GetInterventions($equipmentId: ID!) {
    interventions(equipmentId: $equipmentId) {
      id equipmentId type description partsReplaced ticketId performedAt createdAt updatedAt
      technician { id name }
    }
  }
`;
// Tickets del equipo, para vincular la intervencion con el que la origino
const EQUIPMENT_TICKETS_QUERY = `
  query GetTickets($equipmentId: ID) {
    tickets(equipmentId: $equipmentId) { id title status }
  }
`;
const CREATE_MUTATION = `
  mutation CreateIntervention($input: InterventionInput!) { createIntervention(input: $input) { id } }
`;
const UPDATE_MUTATION = `
  mutation UpdateIntervention($id: ID!, $input: InterventionUpdateInput!) { updateIntervention(id: $id, input: $input) { id } }
`;

interface EquipmentInterventionsProps {
  equipmentId: string;
  /** Un equipo dado de baja conserva su historial pero no recibe intervenciones nuevas */
  canEdit: boolean;
}

// Trabajo hecho sobre el equipo (mantenimiento, limpieza, cambio de piezas...),
// haya o no un ticket de por medio
export function EquipmentInterventions({ equipmentId, canEdit }: EquipmentInterventionsProps) {
  const { t } = useI18n();
  const { data, isLoading, error, refetch } = useAsync<{ interventions: Intervention[] }>(
    () => gql(INTERVENTIONS_QUERY, { equipmentId }),
    [equipmentId],
  );
  const { data: ticketsData } = useAsync<{ tickets: Ticket[] }>(
    () => gql(EQUIPMENT_TICKETS_QUERY, { equipmentId }),
    [equipmentId],
  );
  // null = cerrado, "new" = alta, Intervention = edicion
  const [editing, setEditing] = useState<Intervention | "new" | null>(null);
  const interventions = data?.interventions ?? [];
  const tickets = ticketsData?.tickets ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("interventions.title", { count: interventions.length })}</CardTitle>
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
              <Plus className="h-3.5 w-3.5" />
              {t("interventions.register")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && !data ? (
          <div className="space-y-2">
            {["a", "b"].map((k) => (
              <div key={k} className="h-14 rounded-xl bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{t("interventions.loadError", { error })}</p>
        ) : interventions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("interventions.empty")}</p>
        ) : (
          <ol className="space-y-2">
            {interventions.map((i) => (
              <li
                key={i.id}
                className="flex items-start gap-3 rounded-xl border border-border/70 p-3"
              >
                <Wrench className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge color="info">{INTERVENTION_TYPE_LABELS[i.type]}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(i.performedAt)} · {i.technician.name}
                    </span>
                    {i.ticketId && (
                      <Link
                        to={`${ROUTES.TICKETS}/${i.ticketId}`}
                        className="text-xs font-mono text-primary hover:underline"
                      >
                        {i.ticketId}
                      </Link>
                    )}
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-line break-words">
                    {i.description}
                  </p>
                  {i.partsReplaced && (
                    <p className="text-xs text-muted-foreground">
                      {t("interventions.parts", { parts: i.partsReplaced })}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(i)}
                    aria-label={t("interventions.edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing !== null && (
            <InterventionForm
              key={editing === "new" ? "new" : editing.id}
              equipmentId={equipmentId}
              intervention={editing === "new" ? null : editing}
              tickets={tickets}
              onDone={() => {
                setEditing(null);
                refetch();
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface InterventionFormProps {
  equipmentId: string;
  intervention: Intervention | null;
  tickets: Ticket[];
  onDone: () => void;
  onCancel: () => void;
}

interface FormState {
  type: InterventionType | "";
  description: string;
  partsReplaced: string;
  performedAt: string; // valor del input datetime-local
  ticketId: string;
}

function InterventionForm({
  equipmentId,
  intervention,
  tickets,
  onDone,
  onCancel,
}: InterventionFormProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>({
    type: intervention?.type ?? "",
    description: intervention?.description ?? "",
    partsReplaced: intervention?.partsReplaced ?? "",
    performedAt: toDateTimeInput(intervention?.performedAt),
    ticketId: intervention?.ticketId ?? "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof InterventionFields>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((e) => ({ ...e, [k]: undefined }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const fields: InterventionFields = {
      type: form.type,
      description: form.description,
      partsReplaced: form.partsReplaced || null,
      performedAt: fromDateTimeInput(form.performedAt),
    };
    const errors = validateIntervention(fields);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError("");
    try {
      const input = { ...fields, ticketId: form.ticketId || null };
      await (intervention
        ? gql(UPDATE_MUTATION, { id: intervention.id, input })
        : gql(CREATE_MUTATION, { input: { ...input, equipmentId } }));
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("interventions.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (k: keyof InterventionFields) =>
    fieldErrors[k] && <p className="text-xs text-destructive">{fieldErrors[k]}</p>;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>
          {intervention ? t("interventions.edit") : t("interventions.register")}
        </DialogTitle>
        <DialogDescription>{t("interventions.formDescription")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="int-type">{t("label.type")}</Label>
            <OptionSelect
              id="int-type"
              className="w-full"
              value={form.type}
              onValueChange={(v) => update("type", v as InterventionType | "")}
              placeholder={t("interventions.pickType")}
              options={Object.entries(INTERVENTION_TYPE_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            {fieldError("type")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="int-date">{t("interventions.dateTime")}</Label>
            <Input
              id="int-date"
              type="datetime-local"
              value={form.performedAt}
              max={toDateTimeInput()}
              onChange={(e) => update("performedAt", e.target.value)}
            />
            {fieldError("performedAt")}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="int-desc">{t("interventions.what")}</Label>
          <Textarea
            id="int-desc"
            placeholder={t("interventions.whatPlaceholder")}
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            className="h-24"
          />
          {fieldError("description")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="int-parts">{t("interventions.partsLabel")}</Label>
          <Input
            id="int-parts"
            placeholder={t("interventions.partsPlaceholder")}
            value={form.partsReplaced}
            onChange={(e) => update("partsReplaced", e.target.value)}
          />
          {fieldError("partsReplaced")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="int-ticket">{t("interventions.ticket")}</Label>
          <OptionSelect
            id="int-ticket"
            className="w-full"
            value={form.ticketId}
            onValueChange={(v) => update("ticketId", v)}
            options={[
              { value: "", label: t("interventions.noTicket") },
              ...tickets.map((tk) => ({ value: tk.id, label: `${tk.id} · ${tk.title}` })),
            ]}
          />
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
            : intervention
              ? t("form.saveChanges")
              : t("interventions.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
