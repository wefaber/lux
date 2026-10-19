import { useState } from "react";
import { BellRing, Check, Pin } from "lucide-react";
import { useNotices } from "@/hooks/useNotices";
import { useI18n } from "@/hooks/useI18n";
import { t as translateNow } from "@/i18n";
import { NOTICE_ENTITY_GENDER, NOTICE_KIND_LABELS } from "@/lib/constants";
import type { PinState } from "@/lib/pins";
import type { Notice } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

// Fondo de la fila fijada: suave para lo asignado, ambar para un aviso sin ver
export function pinRowClass(state: PinState): string {
  if (state === "notice") return "bg-amber-500/[0.08] hover:bg-amber-500/[0.12]";
  if (state === "active") return "bg-primary/[0.05] hover:bg-primary/[0.09]";
  return "hover:bg-muted/30";
}

// Icono junto al ID de lo que esta fijado
export function PinMark({ state }: { state: PinState }) {
  const { t } = useI18n();
  if (state === "active") {
    return (
      <Pin
        className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5 text-primary"
        aria-label={t("ui.pin.active")}
      >
        <title>{t("ui.pin.active")}</title>
      </Pin>
    );
  }
  if (state === "notice") {
    return (
      <BellRing
        className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5 text-amber-500"
        aria-label={t("ui.pin.notice")}
      >
        <title>{t("ui.pin.notice")}</title>
      </BellRing>
    );
  }
  return null;
}

// "La aprobó Ana", "Te lo asignó Nicolás", "Venció la fecha de devolución"
export function noticeText(notice: Pick<Notice, "entityType" | "kind" | "by">): string {
  return NOTICE_KIND_LABELS[notice.kind]
    .replace("{o}", NOTICE_ENTITY_GENDER[notice.entityType])
    .replace("{by}", notice.by?.name ?? translateNow("ui.notice.system"));
}

// Que paso y el boton para marcarlo como visto. Hasta entonces la fila sigue
// fijada arriba de todo
export function NoticeLine({ notice }: { notice: Notice }) {
  const { acknowledge } = useNotices();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const markSeen = async () => {
    setSaving(true);
    setError("");
    try {
      await acknowledge(notice.id);
    } catch (err) {
      setError(errorMessage(err, t("ui.notice.markFailed")));
      setSaving(false);
    }
  };

  const text = noticeText(notice);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs whitespace-normal">
      <span className="text-amber-600 dark:text-amber-400 font-medium">{text}</span>
      {/* Con varios avisos en la lista, el lector de pantalla tiene que poder
          distinguir cual se marca */}
      <button
        type="button"
        onClick={markSeen}
        disabled={saving}
        aria-label={t("ui.notice.markSeenLabel", { text, id: notice.entityId })}
        className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
      >
        <Check className="h-3 w-3" />
        {saving ? t("ui.notice.marking") : t("ui.notice.markSeen")}
      </button>
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
