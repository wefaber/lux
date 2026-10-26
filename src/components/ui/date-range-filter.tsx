import type { ChangeEvent } from "react";
import { useId } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";
import {
  EMPTY_DATE_RANGE,
  dateRangeError,
  isDateInput,
  isDateRangeActive,
  type DateRange,
} from "@/lib/date-range";
import { Button } from "./button";
import { Input } from "./input";

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

// Filtro "desde / hasta" de los listados. El "hasta" incluye todo el dia.
// Con las fechas invertidas se avisa y no se filtra: la lista muestra lo mismo
// que sin rango hasta que se corrija, en vez de quedar vacia sin explicacion.
export function DateRangeFilter({ value, onChange, className }: DateRangeFilterProps) {
  const { t } = useI18n();
  const errorId = useId();
  const invalid = dateRangeError(value) !== null;
  const active = isDateRangeActive(value);

  const set = (key: keyof DateRange) => (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    // Un valor que no venga del selector nativo (o una fecha inexistente) se
    // descarta en vez de viajar a la API
    onChange({ ...value, [key]: isDateInput(next) ? next : "" });
  };

  return (
    <div className={cn("flex w-full flex-wrap items-start gap-2 sm:w-auto", className)}>
      <div
        role="group"
        aria-label={t("filters.dateRange")}
        className="flex w-full min-w-0 items-center gap-2 sm:w-auto"
      >
        <Input
          type="date"
          aria-label={t("filters.from")}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          value={value.from}
          onChange={set("from")}
          className="w-full min-w-0 flex-1 sm:w-36 sm:flex-none"
        />
        <Input
          type="date"
          aria-label={t("filters.to")}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          value={value.to}
          onChange={set("to")}
          className="w-full min-w-0 flex-1 sm:w-36 sm:flex-none"
        />
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("filters.clear")}
            title={t("filters.clear")}
            onClick={() => onChange(EMPTY_DATE_RANGE)}
            className="shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="basis-full text-xs text-destructive">
          {t("filters.invalidOrder")}
        </p>
      )}
    </div>
  );
}
