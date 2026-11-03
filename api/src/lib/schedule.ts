// Horarios de clase: quien esta a cargo de un salon o laboratorio en una franja
// semanal. Logica pura (sin base de datos) para poder probarla aparte.

/** Zona horaria de la institucion: los horarios se cargan en hora local. */
export const DEFAULT_INSTITUTION_TIME_ZONE = "America/Montevideo";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TEXT_MAX = 80;

export interface ScheduleFields {
  weekday: number;
  startTime: string;
  endTime: string;
  subject?: string | null;
  studentGroup?: string | null;
}

export interface ScheduleSlot {
  locationId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

/** "08:30" -> 510 (minutos desde la medianoche); null si no es una hora valida. */
export function timeToMinutes(value: string): number | null {
  if (!TIME_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/** Mensaje de error para el primer campo invalido, o null si el horario es valido. */
export function validateSchedule(fields: ScheduleFields): string | null {
  if (!Number.isInteger(fields.weekday) || fields.weekday < 1 || fields.weekday > 7) {
    return "Día de la semana inválido (1 = lunes a 7 = domingo)";
  }
  const start = timeToMinutes(fields.startTime);
  const end = timeToMinutes(fields.endTime);
  if (start === null) return "Hora de inicio inválida (formato HH:MM)";
  if (end === null) return "Hora de fin inválida (formato HH:MM)";
  if (end <= start) return "La hora de fin tiene que ser posterior a la de inicio";
  for (const [label, value] of [
    ["Materia", fields.subject],
    ["Grupo", fields.studentGroup],
  ] as const) {
    if (value && value.trim().length > TEXT_MAX) return `${label}: hasta ${TEXT_MAX} caracteres`;
  }
  return null;
}

/** Dos horarios del mismo lugar y dia chocan si sus franjas se pisan (el fin es exclusivo). */
export function schedulesOverlap(a: ScheduleSlot, b: ScheduleSlot): boolean {
  if (a.locationId !== b.locationId || a.weekday !== b.weekday) return false;
  const aStart = timeToMinutes(a.startTime)!;
  const aEnd = timeToMinutes(a.endTime)!;
  const bStart = timeToMinutes(b.startTime)!;
  const bEnd = timeToMinutes(b.endTime)!;
  return aStart < bEnd && bStart < aEnd;
}

const WEEKDAY_BY_NAME: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export interface LocalMoment {
  /** 1 = lunes ... 7 = domingo */
  weekday: number;
  /** Minutos desde la medianoche, hora local */
  minutes: number;
}

/** Dia de la semana y hora local de un instante en `timeZone`; null si el instante no es valido. */
export function localMoment(
  instant: string | Date,
  timeZone: string = DEFAULT_INSTITUTION_TIME_ZONE,
): LocalMoment | null {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = WEEKDAY_BY_NAME[get("weekday")];
  if (!weekday) return null;
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** `true` si el horario cubre el momento: mismo dia y inicio <= hora < fin. */
export function scheduleCovers(
  schedule: Pick<ScheduleSlot, "weekday" | "startTime" | "endTime">,
  moment: LocalMoment,
): boolean {
  if (schedule.weekday !== moment.weekday) return false;
  const start = timeToMinutes(schedule.startTime);
  const end = timeToMinutes(schedule.endTime);
  return start !== null && end !== null && start <= moment.minutes && moment.minutes < end;
}
