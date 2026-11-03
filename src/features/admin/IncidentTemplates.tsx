import { useState } from "react";
import { Ban, Check, Pencil, Plus, Send, X } from "lucide-react";
import { useAsync } from "@/hooks/useSkeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { errorMessage, formatDate, gql } from "@/lib/utils";
import {
  TEMPLATE_STATUS_CONFIG,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_CONFIG,
} from "@/lib/constants";
import { ADMIN_ROLES } from "@/lib/roles";
import {
  validateIncidentTemplate,
  type FieldErrors,
  type IncidentTemplateFields,
} from "@/lib/validation";
import type { IncidentTemplate, TemplateStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/ui/error-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import { TableSkeleton } from "@/components/skeletons/TableSkeleton";

const TEMPLATES_QUERY = `
  query IncidentTemplates($status: String) {
    incidentTemplates(status: $status) {
      id name category priority title description status
      author { id name }
      approvedBy { id name }
      approvedAt createdAt updatedAt
    }
  }
`;

const CREATE_MUTATION = `
  mutation CreateIncidentTemplate($input: IncidentTemplateInput!) {
    createIncidentTemplate(input: $input) { id status }
  }
`;

const UPDATE_MUTATION = `
  mutation UpdateIncidentTemplate($id: ID!, $input: IncidentTemplateInput!) {
    updateIncidentTemplate(id: $id, input: $input) { id status }
  }
`;

const SUBMIT_MUTATION = `
  mutation SubmitIncidentTemplate($id: ID!) {
    submitIncidentTemplate(id: $id) { id status }
  }
`;

const APPROVE_MUTATION = `
  mutation ApproveIncidentTemplate($id: ID!) {
    approveIncidentTemplate(id: $id) { id status }
  }
`;

const REJECT_MUTATION = `
  mutation RejectIncidentTemplate($id: ID!, $reason: String!) {
    rejectIncidentTemplate(id: $id, reason: $reason) { id status }
  }
`;

const RETIRE_MUTATION = `
  mutation RetireIncidentTemplate($id: ID!) {
    retireIncidentTemplate(id: $id) { id status }
  }
`;

const EMPTY_FORM: IncidentTemplateFields = {
  name: "",
  category: "hardware",
  priority: "medium",
  title: "",
  description: "",
};

const REASON_MIN = 3;

type Pending =
  | { kind: "form"; template: IncidentTemplate | null }
  | { kind: "reject"; template: IncidentTemplate }
  | { kind: "retire"; template: IncidentTemplate };

// Plantillas de incidencia rapida. Los tecnicos crean las suyas y las prueban
// (borrador -> en prueba, usandolas desde el telefono); el administrador las
// aprueba, rechaza (con motivo) o retira. El tecnico ve las propias y las
// aprobadas; el administrador, todas.
export function IncidentTemplates() {
  const { t } = useI18n();
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(...ADMIN_ROLES);
  const [statusFilter, setStatusFilter] = useState<TemplateStatus | "">("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const { data, isLoading, error, refetch } = useAsync<{ incidentTemplates: IncidentTemplate[] }>(
    () => gql(TEMPLATES_QUERY, { status: statusFilter || undefined }),
    [statusFilter],
  );
  const templates = data?.incidentTemplates ?? [];

  const run = async (id: string, mutation: string, variables: Record<string, unknown>) => {
    setBusyId(id);
    setActionError("");
    try {
      await gql(mutation, variables);
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, t("templates.actionFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const can = (tpl: IncidentTemplate) => {
    const own = tpl.author.id === user?.id;
    const open = tpl.status === "draft" || tpl.status === "testing";
    return {
      edit: tpl.status !== "retired" && (isAdmin || (own && open)),
      submit: tpl.status === "draft" && (own || isAdmin),
      review: tpl.status === "testing" && isAdmin,
      retire: tpl.status !== "retired" && (isAdmin || (own && tpl.status !== "approved")),
    };
  };

  const done = () => {
    setPending(null);
    refetch();
  };

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t("templates.title")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isAdmin ? t("templates.subtitleAdmin") : t("templates.subtitleTech")}
          </p>
        </div>
        <Button size="sm" onClick={() => setPending({ kind: "form", template: null })}>
          <Plus className="h-3.5 w-3.5" />
          {t("templates.new")}
        </Button>
      </div>

      <OptionSelect
        aria-label={t("common.filterStatus")}
        value={statusFilter}
        onValueChange={(v) => setStatusFilter(v as TemplateStatus | "")}
        options={[
          { value: "", label: t("common.allStatuses") },
          ...Object.entries(TEMPLATE_STATUS_CONFIG).map(([value, conf]) => ({
            value,
            label: conf.label,
          })),
        ]}
      />

      {error && <ErrorAlert>{t("common.error", { error })}</ErrorAlert>}
      <ErrorAlert>{actionError}</ErrorAlert>

      {isLoading && !data ? (
        <TableSkeleton rows={5} cols={6} />
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {t("templates.empty")}
        </div>
      ) : (
        <div className="rounded-2xl border border-border/70 overflow-x-auto bg-card/20 backdrop-blur-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {(
                  [
                    "label.name",
                    "label.category",
                    "label.priority",
                    "label.status",
                    "templates.author",
                    "templates.updated",
                    "templates.actions",
                  ] as const
                ).map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-muted-foreground"
                  >
                    {t(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => {
                const status = TEMPLATE_STATUS_CONFIG[tpl.status];
                const allowed = can(tpl);
                const busy = busyId === tpl.id;
                return (
                  <tr key={tpl.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 min-w-48 max-w-72 whitespace-normal">
                      <p className="text-sm font-semibold text-foreground">{tpl.name}</p>
                      <p className="text-xs text-muted-foreground">{tpl.title}</p>
                    </td>
                    <td className="px-4 py-2 text-sm text-muted-foreground">
                      {TICKET_CATEGORY_LABELS[tpl.category]}
                    </td>
                    <td className="px-4 py-2">
                      <Badge color={TICKET_PRIORITY_CONFIG[tpl.priority].color}>
                        {TICKET_PRIORITY_CONFIG[tpl.priority].label}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <Badge color={status.color} withDot>
                        {status.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-sm text-muted-foreground whitespace-normal">
                      {tpl.author.name}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDate(tpl.updatedAt)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {allowed.edit && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => setPending({ kind: "form", template: tpl })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {t("common.edit")}
                          </Button>
                        )}
                        {allowed.submit && (
                          <Button
                            variant="info"
                            size="sm"
                            disabled={busy}
                            onClick={() => run(tpl.id, SUBMIT_MUTATION, { id: tpl.id })}
                          >
                            <Send className="h-3.5 w-3.5" />
                            {t("templates.submit")}
                          </Button>
                        )}
                        {allowed.review && (
                          <>
                            <Button
                              variant="success"
                              size="sm"
                              disabled={busy}
                              onClick={() => run(tpl.id, APPROVE_MUTATION, { id: tpl.id })}
                            >
                              <Check className="h-3.5 w-3.5" />
                              {t("templates.approve")}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={busy}
                              onClick={() => setPending({ kind: "reject", template: tpl })}
                            >
                              <X className="h-3.5 w-3.5" />
                              {t("templates.reject")}
                            </Button>
                          </>
                        )}
                        {allowed.retire && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => setPending({ kind: "retire", template: tpl })}
                          >
                            <Ban className="h-3.5 w-3.5" />
                            {t("templates.retire")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pending?.kind === "form" && (
        <TemplateFormDialog
          template={pending.template}
          onClose={() => setPending(null)}
          onSaved={done}
        />
      )}
      {pending?.kind === "reject" && (
        <RejectDialog template={pending.template} onClose={() => setPending(null)} onDone={done} />
      )}
      {pending?.kind === "retire" && (
        <RetireDialog template={pending.template} onClose={() => setPending(null)} onDone={done} />
      )}
    </div>
  );
}

interface TemplateFormDialogProps {
  template: IncidentTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}

function TemplateFormDialog({ template, onClose, onSaved }: TemplateFormDialogProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<IncidentTemplateFields>(
    template
      ? {
          name: template.name,
          category: template.category,
          priority: template.priority,
          title: template.title,
          description: template.description,
        }
      : EMPTY_FORM,
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof IncidentTemplateFields>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (key: keyof IncidentTemplateFields, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
  };

  const fieldError = (key: keyof IncidentTemplateFields) =>
    fieldErrors[key] && <p className="text-xs text-destructive">{fieldErrors[key]}</p>;

  const handleSave = async () => {
    const errors = validateIncidentTemplate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError("");
    const input = {
      name: form.name.trim(),
      category: form.category,
      priority: form.priority,
      title: form.title.trim(),
      description: form.description.trim(),
    };
    try {
      await (template
        ? gql(UPDATE_MUTATION, { id: template.id, input })
        : gql(CREATE_MUTATION, { input }));
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t("templates.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? t("templates.edit") : t("templates.new")}</DialogTitle>
          <DialogDescription>{t("templates.formHelp")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">{t("templates.name")}</Label>
            <Input
              id="tpl-name"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder={t("templates.namePlaceholder")}
            />
            {fieldError("name")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-category">{t("label.category")}</Label>
              <OptionSelect
                id="tpl-category"
                className="w-full"
                value={form.category}
                onValueChange={(v) => update("category", v)}
                options={Object.entries(TICKET_CATEGORY_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              {fieldError("category")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-priority">{t("label.priority")}</Label>
              <OptionSelect
                id="tpl-priority"
                className="w-full"
                value={form.priority}
                onValueChange={(v) => update("priority", v)}
                options={TICKET_PRIORITIES.map((value) => ({
                  value,
                  label: TICKET_PRIORITY_CONFIG[value].label,
                }))}
              />
              {fieldError("priority")}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-title">{t("templates.ticketTitle")}</Label>
            <Input
              id="tpl-title"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder={t("tickets.create.titlePlaceholder")}
            />
            {fieldError("title")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-description">{t("templates.ticketDescription")}</Label>
            <Textarea
              id="tpl-description"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder={t("tickets.create.descriptionPlaceholder")}
              className="h-28"
            />
            {fieldError("description")}
          </div>
        </div>
        <ErrorAlert>{error}</ErrorAlert>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ActionDialogProps {
  template: IncidentTemplate;
  onClose: () => void;
  onDone: () => void;
}

function RejectDialog({ template, onClose, onDone }: ActionDialogProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleReject = async () => {
    const text = reason.trim();
    if (text.length < REASON_MIN) {
      setError(t("templates.reasonShort", { min: REASON_MIN }));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await gql(REJECT_MUTATION, { id: template.id, reason: text });
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("templates.actionFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("templates.rejectTitle")}</DialogTitle>
          <DialogDescription>
            {t("templates.rejectHelp", { name: template.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-reason">{t("templates.reason")}</Label>
          <Textarea
            id="tpl-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-24"
          />
        </div>
        <ErrorAlert>{error}</ErrorAlert>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleReject} disabled={saving}>
            {t("templates.reject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RetireDialog({ template, onClose, onDone }: ActionDialogProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleRetire = async () => {
    setSaving(true);
    setError("");
    try {
      await gql(RETIRE_MUTATION, { id: template.id });
      onDone();
    } catch (err) {
      setError(errorMessage(err, t("templates.actionFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("templates.retireTitle")}</DialogTitle>
          <DialogDescription>
            {t("templates.retireHelp", { name: template.name })}
          </DialogDescription>
        </DialogHeader>
        <ErrorAlert>{error}</ErrorAlert>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleRetire} disabled={saving}>
            {t("templates.retire")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
