import type { Ticket } from "@/lib/types";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/hooks/useI18n";

interface DiagnosisStepProps {
  ticket: Ticket;
  diagnosis: string;
  corrected: boolean | null;
  onDiagnosisChange: (v: string) => void;
  onCorrectedChange: (v: boolean) => void;
  readOnly?: boolean;
}

export function DiagnosisStep({
  ticket,
  diagnosis,
  corrected,
  onDiagnosisChange,
  onCorrectedChange,
  readOnly = false,
}: DiagnosisStepProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-1">
          {t("tickets.diagnosis.title")}
        </h2>
        {ticket.equipment && (
          <p className="text-xs text-muted-foreground">
            {ticket.equipment.location} · {ticket.equipment.serialNumber}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>{t("tickets.diagnosis.label")}</Label>
        <Textarea
          value={diagnosis}
          onChange={(e) => onDiagnosisChange(e.target.value)}
          placeholder={t("tickets.diagnosis.placeholder")}
          className="h-36"
          readOnly={readOnly}
          disabled={readOnly}
        />
      </div>

      <div className="space-y-2">
        <Label>{t("tickets.diagnosis.fixed")}</Label>
        <div className="flex gap-3">
          {[
            { label: t("common.yes"), value: true },
            { label: t("common.no"), value: false },
          ].map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => !readOnly && onCorrectedChange(opt.value)}
              disabled={readOnly}
              className={`flex-1 rounded-xl border py-2.5 text-sm font-medium transition-all cursor-pointer ${
                corrected === opt.value
                  ? opt.value
                    ? "border-[rgba(52,199,89,0.3)] bg-[rgba(52,199,89,0.08)] text-success"
                    : "border-[rgba(255,69,58,0.3)] bg-destructive/10 text-destructive"
                  : "border-border bg-card/40 text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {ticket.actionsTaken && (
        <div>
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium block mb-1.5">
            {t("tickets.diagnosis.previousActions")}
          </span>
          <p className="text-sm text-foreground leading-relaxed bg-black/3 rounded-xl p-3">
            {ticket.actionsTaken}
          </p>
        </div>
      )}
    </div>
  );
}

// Export completo de pasos de diagnostico del ticket
