// Filtro por rango de fechas en la API. El cliente manda startDate/endDate como
// instantes ISO ya resueltos en su zona horaria (medianoche local y
// 23:59:59.999 local), asi que aca solo se comparan instantes: el servidor no
// necesita saber en que zona esta el navegador. Los dos extremos son
// inclusivos y cualquiera puede faltar (rango abierto de un lado).
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

// Reservas: se incluyen las que se solapan con el rango, no solo las que
// empiezan dentro. Una reserva de 22:00 a 02:00 aparece al filtrar el dia en
// que termina.
export function overlapsRange(
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

/**
 * Los registros de actividad se guardan como texto ISO, asi que la consulta a
 * la base usa `timestamp < fin exclusivo`. Sumar un milisegundo al "hasta"
 * mantiene la comparacion inclusive y no depende de si el texto guardado tiene
 * milisegundos. Devuelve null si la fecha no es valida.
 */
export function exclusiveEnd(endDate: string): string | null {
  const instant = Date.parse(endDate);
  return Number.isNaN(instant) ? null : new Date(instant + 1).toISOString();
}
