import { useEffect } from "react";
import { useNotices } from "@/hooks/useNotices";
import { useI18n } from "@/hooks/useI18n";
import type { NoticeEntity } from "@/lib/types";
import { OptionSelect, type OptionSelectProps } from "./option-select";
import { UnseenDot } from "./unseen-dot";

interface StatusFilterProps extends OptionSelectProps {
  /** Seccion cuyos pedidos pendientes nuevos marca este filtro */
  section: NoticeEntity;
}

// Filtro por estado que avisa al staff de pedidos pendientes nuevos: punto en el
// filtro y en la opcion "Pendiente". Filtrar por Pendiente los da por vistos
export function StatusFilter({ section, options, value, ...props }: StatusFilterProps) {
  const { hasNewPending, markPendingSeen } = useNotices();
  const { t } = useI18n();
  const fresh = hasNewPending(section);

  // Solo si habia algo nuevo: el solicitante nunca tiene, y no puede marcar
  useEffect(() => {
    if (value === "pending" && fresh) markPendingSeen(section);
  }, [value, fresh, section, markPendingSeen]);

  const marked = options.map((o) =>
    fresh && o.value === "pending"
      ? {
          ...o,
          label: (
            <span className="inline-flex items-center gap-2">
              {o.label}
              <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="sr-only">{t("ui.statusFilter.hasNew")}</span>
            </span>
          ),
        }
      : o,
  );

  return (
    <span className="relative inline-flex">
      <OptionSelect {...props} value={value} options={marked} />
      {fresh && <UnseenDot label={t("ui.statusFilter.newPending")} />}
    </span>
  );
}
