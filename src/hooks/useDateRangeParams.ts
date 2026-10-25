import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  dateRangeBounds,
  isDateInput,
  isDateRangeActive,
  type DateRange,
} from "@/lib/date-range";

// Nombres en espanol, como el resto de los parametros de la app (?nuevo, ?equipo).
// El rango vive en la URL para que se pueda recargar o compartir el listado ya
// filtrado, y para que sobreviva a la navegacion dentro de la seccion.
const FROM_PARAM = "desde";
const TO_PARAM = "hasta";

function readDate(value: string | null): string {
  // Un enlace compartido puede traer basura: se descarta en vez de romper la API
  return value && isDateInput(value) ? value : "";
}

export interface DateRangeParams {
  range: DateRange;
  setRange: (range: DateRange) => void;
  /** Hay al menos un extremo valido */
  active: boolean;
  /** Instantes ISO inclusivos para la API; null si no hay filtro valido */
  bounds: { startDate?: string; endDate?: string } | null;
}

export function useDateRangeParams(): DateRangeParams {
  const [searchParams, setSearchParams] = useSearchParams();
  const range: DateRange = {
    from: readDate(searchParams.get(FROM_PARAM)),
    to: readDate(searchParams.get(TO_PARAM)),
  };

  const setRange = useCallback(
    (next: DateRange) => {
      const clean: DateRange = {
        from: isDateInput(next.from) ? next.from : "",
        to: isDateInput(next.to) ? next.to : "",
      };
      setSearchParams(
        (prev) => {
          // Se parte de los parametros actuales: ?nuevo=1 o ?equipo=... siguen ahi
          const params = new URLSearchParams(prev);
          if (clean.from) params.set(FROM_PARAM, clean.from);
          else params.delete(FROM_PARAM);
          if (clean.to) params.set(TO_PARAM, clean.to);
          else params.delete(TO_PARAM);
          return params;
        },
        // Reemplaza en vez de apilar una entrada por cada fecha elegida
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return {
    range,
    setRange,
    active: isDateRangeActive(range),
    bounds: dateRangeBounds(range),
  };
}
