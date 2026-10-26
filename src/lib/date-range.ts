// Rango de fechas por dia local. Los dos extremos son "AAAA-MM-DD", el valor
// que devuelve <input type="date">, y "" significa "sin limite de ese lado".
// El "hasta" incluye todo ese dia: se compara por dia local, no por instante,
// asi una fila de las 23:59 no queda afuera por la zona horaria.
export interface DateRange {
  from: string;
  to: string;
}

export const EMPTY_DATE_RANGE: DateRange = { from: "", to: "" };

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

// Valida el texto de un input date y descarta fechas que no existen (30/02)
export function isDateInput(value: string): boolean {
  const match = DATE_INPUT.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// Medianoche y ultimo milisegundo del dia, en la zona horaria del navegador.
// toISOString() los manda a la API como instantes UTC, que es lo que compara
// el servidor: el cliente es el unico que conoce la zona local.
function dayStart(value: string): Date {
  const date = new Date(0);
  date.setFullYear(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
  );
  date.setHours(0, 0, 0, 0);
  return date;
}

function dayEnd(value: string): Date {
  const date = dayStart(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

/** "2026-10-21" -> instante UTC de la medianoche local de ese dia. */
export function startOfDayIso(value: string): string {
  return dayStart(value).toISOString();
}

/** "2026-10-21" -> instante UTC del ultimo milisegundo local de ese dia. */
export function endOfDayIso(value: string): string {
  return dayEnd(value).toISOString();
}

/** Una fecha posterior a la otra: el rango se muestra en error y no filtra. */
export function dateRangeError(range: DateRange): "order" | null {
  if (!isDateInput(range.from) || !isDateInput(range.to)) return null;
  return range.from > range.to ? "order" : null;
}

/** Hay al menos un extremo valido. */
export function isDateRangeActive(range: DateRange): boolean {
  return isDateInput(range.from) || isDateInput(range.to);
}

/**
 * Instantes que entiende la API (startDate/endDate inclusivos). Devuelve null
 * si el rango esta vacio o invertido: en ese caso no se manda filtro.
 */
export function dateRangeBounds(
  range: DateRange,
): { startDate?: string; endDate?: string } | null {
  if (!isDateRangeActive(range) || dateRangeError(range)) return null;
  return {
    startDate: isDateInput(range.from) ? startOfDayIso(range.from) : undefined,
    endDate: isDateInput(range.to) ? endOfDayIso(range.to) : undefined,
  };
}

/** Compara un instante ISO contra los extremos inclusivos de la API. */
export function withinInstantRange(
  value: string,
  startDate?: string,
  endDate?: string,
): boolean {
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return false;
  const start = startDate ? Date.parse(startDate) : NaN;
  const end = endDate ? Date.parse(endDate) : NaN;
  if (!Number.isNaN(start) && instant < start) return false;
  if (!Number.isNaN(end) && instant > end) return false;
  return true;
}

/** Filtro en cliente por dia local (tickets, solicitudes, registros...). */
export function inDateRange(value: string, range: DateRange): boolean {
  const bounds = dateRangeBounds(range);
  if (!bounds) return true;
  return withinInstantRange(value, bounds.startDate, bounds.endDate);
}

/**
 * Reservas: se muestran las que se solapan con el rango, no solo las que
 * empiezan dentro. Una reserva de 22:00 a 02:00 aparece al filtrar el dia
 * en que termina.
 */
export function overlapsDateRange(startsAt: string, endsAt: string, range: DateRange): boolean {
  const bounds = dateRangeBounds(range);
  if (!bounds) return true;
  return overlapsInstantRange(startsAt, endsAt, bounds.startDate, bounds.endDate);
}

/** Lo mismo con los extremos ya resueltos como instantes (mock y API). */
export function overlapsInstantRange(
  startsAt: string,
  endsAt: string,
  startDate?: string,
  endDate?: string,
): boolean {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  const from = startDate ? Date.parse(startDate) : NaN;
  const to = endDate ? Date.parse(endDate) : NaN;
  if (!Number.isNaN(to) && start > to) return false;
  if (!Number.isNaN(from) && end < from) return false;
  return true;
}
