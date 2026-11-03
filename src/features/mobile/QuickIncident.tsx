import { useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, CloudUpload, MapPin, QrCode, Siren } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useLocations } from "@/hooks/useLocations";
import { useI18n } from "@/hooks/useI18n";
import { errorMessage, gql } from "@/lib/utils";
import {
  ROUTES,
  TEMPLATE_STATUS_CONFIG,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_CONFIG,
  equipmentKindLabel,
} from "@/lib/constants";
import { firstError, validateTicket } from "@/lib/validation";
import { newClientId, sendOrQueue } from "@/lib/outbox";
import type { IncidentTemplate, Product, TicketCategory, TicketPriority } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorAlert } from "@/components/ui/error-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import { LocationSearchSelect } from "@/components/search-pickers";
import { cn } from "@/lib/utils";
import { CREATE_TICKET_MUTATION, INCIDENT_TEMPLATES_QUERY, PRODUCT_QUERY } from "./queries";

type Outcome = { kind: "sent"; id: string } | { kind: "queued" };

interface Fields {
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
}

const EMPTY_FIELDS: Fields = {
  title: "",
  description: "",
  category: "hardware",
  priority: "medium",
};

// Incidencia rapida (staff): se elige una plantilla, que precarga categoria,
// prioridad, titulo y descripcion; la ubicacion sale del equipo y el tecnico la
// cambia solo si hubo movimiento. Va por la cola offline.
export function QuickIncident() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const productId = params.get("equipo") ?? "";

  const [templateId, setTemplateId] = useState("");
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  // null = la del equipo
  const [locationOverride, setLocationOverride] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Un clientId por incidencia: si el envio se reintenta, no se duplica
  const clientIdRef = useRef(newClientId());

  const { locations } = useLocations();
  const { data: productData } = useAsync<{ product: Product | null } | null>(
    () => (productId ? gql(PRODUCT_QUERY, { id: productId }) : Promise.resolve(null)),
    [productId],
  );
  const { data: templatesData, isLoading: loadingTemplates } = useAsync<{
    incidentTemplates: IncidentTemplate[];
  }>(() => gql(INCIDENT_TEMPLATES_QUERY), []);

  const product = productData?.product ?? null;
  const templates = (templatesData?.incidentTemplates ?? []).filter(
    (tpl) => tpl.status !== "retired",
  );
  const locationId = locationOverride ?? product?.locationId ?? "";
  const moved = locationOverride !== null && locationOverride !== (product?.locationId ?? "");

  const pickTemplate = (tpl: IncidentTemplate | null) => {
    setTemplateId(tpl?.id ?? "");
    setFields(
      tpl
        ? {
            title: tpl.title,
            description: tpl.description,
            category: tpl.category,
            priority: tpl.priority,
          }
        : EMPTY_FIELDS,
    );
  };

  const update = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = firstError(validateTicket(fields));
    setError(invalid ?? "");
    if (invalid) return;
    setSaving(true);
    const clientId = clientIdRef.current;
    try {
      const result = await sendOrQueue<{ createTicket: { id: string } }>({
        op: "CreateTicket",
        query: CREATE_TICKET_MUTATION,
        clientId,
        variables: {
          input: {
            title: fields.title.trim(),
            description: fields.description.trim(),
            category: fields.category,
            priority: fields.priority,
            equipmentId: productId || undefined,
            locationId: locationId || undefined,
            templateId: templateId || undefined,
            clientId,
          },
        },
      });
      setOutcome(
        result.status === "sent"
          ? { kind: "sent", id: result.data.createTicket.id }
          : { kind: "queued" },
      );
    } catch (err) {
      setError(errorMessage(err, t("tickets.create.failed")));
    } finally {
      setSaving(false);
    }
  };

  if (outcome) {
    return (
      <Card className="space-y-3 p-5 text-center hover:translate-y-0">
        {outcome.kind === "sent" ? (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
            <p className="text-sm text-foreground" role="status">
              {t("mobile.incident.created", { id: outcome.id })}
            </p>
            <Button className="w-full" asChild>
              <Link to={`${ROUTES.MOBILE_TICKETS}/${outcome.id}`}>
                {t("mobile.incident.viewTicket")}
              </Link>
            </Button>
          </>
        ) : (
          <>
            <CloudUpload className="mx-auto h-8 w-8 text-warning" />
            <p className="text-sm text-foreground" role="status">
              {t("mobile.incident.queued")}
            </p>
          </>
        )}
        <Button variant="secondary" className="w-full" asChild>
          <Link to={ROUTES.MOBILE_SCAN}>
            <QrCode className="h-4 w-4" />
            {t("mobile.scan.again")}
          </Link>
        </Button>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
          <Siren className="h-5 w-5" />
          {t("mobile.incident.title")}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("mobile.incident.subtitle")}</p>
      </div>

      {product ? (
        <Card className="hover:translate-y-0">
          <CardContent className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold text-primary">{product.machineId}</p>
              <p className="truncate text-xs text-muted-foreground">
                {product.brand} {product.model} · {equipmentKindLabel(product.kind)}
              </p>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link to={`${ROUTES.MOBILE_SCAN}?context=incident`}>
                {t("mobile.incident.change")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Button variant="secondary" className="w-full" asChild>
          <Link to={`${ROUTES.MOBILE_SCAN}?context=incident`}>
            <QrCode className="h-4 w-4" />
            {t("mobile.incident.scanEquipment")}
          </Link>
        </Button>
      )}

      <section aria-label={t("mobile.incident.templates")} className="space-y-2">
        <Label>{t("mobile.incident.templates")}</Label>
        <div className="flex flex-wrap gap-2">
          <TemplateChip active={templateId === ""} onClick={() => pickTemplate(null)}>
            {t("mobile.incident.noTemplate")}
          </TemplateChip>
          {templates.map((tpl) => (
            <TemplateChip
              key={tpl.id}
              active={templateId === tpl.id}
              onClick={() => pickTemplate(tpl)}
            >
              {tpl.name}
              {tpl.status !== "approved" && (
                <Badge color={TEMPLATE_STATUS_CONFIG[tpl.status].color} className="ml-1.5">
                  {TEMPLATE_STATUS_CONFIG[tpl.status].label}
                </Badge>
              )}
            </TemplateChip>
          ))}
        </div>
        {!loadingTemplates && templates.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("mobile.incident.noTemplates")}</p>
        )}
      </section>

      <div className="space-y-1.5">
        <Label htmlFor="qi-title">{t("label.title")}</Label>
        <Input
          id="qi-title"
          value={fields.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder={t("tickets.create.titlePlaceholder")}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="qi-description">{t("label.description")}</Label>
        <Textarea
          id="qi-description"
          value={fields.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder={t("tickets.create.descriptionPlaceholder")}
          className="h-28"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="qi-category">{t("label.category")}</Label>
          <OptionSelect
            id="qi-category"
            className="w-full"
            value={fields.category}
            onValueChange={(v) => update("category", v as TicketCategory)}
            options={Object.entries(TICKET_CATEGORY_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qi-priority">{t("label.priority")}</Label>
          <OptionSelect
            id="qi-priority"
            className="w-full"
            value={fields.priority}
            onValueChange={(v) => update("priority", v as TicketPriority)}
            options={TICKET_PRIORITIES.map((value) => ({
              value,
              label: TICKET_PRIORITY_CONFIG[value].label,
            }))}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="qi-location" className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          {t("mobile.incident.location")}
        </Label>
        <LocationSearchSelect
          id="qi-location"
          items={locations}
          value={locationId}
          onChange={(id) => setLocationOverride(id)}
        />
        <p className="text-xs text-muted-foreground">
          {moved ? t("mobile.incident.locationMoved") : t("mobile.incident.locationHelp")}
        </p>
      </div>

      <ErrorAlert>{error}</ErrorAlert>
      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? t("tickets.create.sending") : t("tickets.create.submit")}
      </Button>
    </form>
  );
}

function TemplateChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border/80 bg-card/60 text-foreground active:opacity-60",
      )}
    >
      {children}
    </button>
  );
}
