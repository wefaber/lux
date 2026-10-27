import { t } from "@/i18n";
import {
  INTERVENTION_TYPE_LABELS,
  KIND_MACHINE_CODE,
  LOCATION_KIND_LETTER,
  ROLE_CONFIG,
  SERVICE_TYPE_LABELS,
  TICKET_CATEGORY_LABELS,
  equipmentKindLabel,
} from "./constants";
import type { Location, LocationKind } from "./types";

// Reglas de nomenclatura de equipos. Las usan el formulario (feedback por
// campo) y los handlers (ultima barrera), para que no diverjan. Los mensajes
// salen del diccionario (src/i18n) en el idioma activo.

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Lo que la nomenclatura necesita saber de la ubicacion */
export interface LocationRef {
  name: string;
  code: string;
}

export interface ProductFields {
  machineId: string;
  kind: string;
  /** undefined si el id de ubicacion no existe o fue dada de baja */
  location: LocationRef | undefined;
  brand: string;
  model: string;
  serialNumber: string;
  partNumber: string;
}

export interface ComponentFields {
  name: string;
  model: string;
  manufacturer: string;
  serialNumber: string;
  partNumber: string;
}

export interface InterventionFields {
  type: string;
  description: string;
  partsReplaced: string | null;
  performedAt: string;
}

export interface LocationFields {
  kind: string;
  number: number;
  name: string;
}

// {codigo de ubicacion}-{codigo de tipo}{n° correlativo}: L1-PC3 es la PC 3 del
// Laboratorio 1, S2-PRY1 el proyector 1 del Salon 2
const MACHINE_ID_PATTERN = /^([A-Z]\d{1,2})-([A-Z]{2,3})(\d{1,3})$/;

// Letra del tipo + numero: Laboratorio 1 -> L1
export function locationCode(kind: string, number: number): string | null {
  const letter = LOCATION_KIND_LETTER[kind as LocationKind];
  return letter && Number.isInteger(number) && number >= 1 && number <= 99
    ? `${letter}${number}`
    : null;
}
const NAME_CHARS = /^[\p{L}\d .\-/+&()']+$/u;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9\-/.]{2,39}$/i;
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

// "asdasd", "jsjsjs": la palabra entera es un mismo bloque repetido
function isRepeatedChunk(word: string): boolean {
  return /^(.{2,3})\1+$/iu.test(word);
}

// "qwerty", "asdfg": cinco o mas teclas seguidas de una misma fila
function isKeyboardRun(word: string): boolean {
  const w = word.toLowerCase();
  for (let i = 0; i + 5 <= w.length; i++) {
    const chunk = w.slice(i, i + 5);
    if (KEYBOARD_ROWS.some((row) => row.includes(chunk))) return true;
  }
  return false;
}

export function machineIdPrefix(kind: string, code: string | undefined): string | null {
  const kindCode = KIND_MACHINE_CODE[kind];
  return code && kindCode ? `${code}-${kindCode}` : null;
}

// Proximo ID libre para el area 1 de la ubicacion, como sugerencia
export function suggestMachineId(
  kind: string,
  code: string | undefined,
  taken: string[],
): string | null {
  const prefix = machineIdPrefix(kind, code);
  if (!prefix) return null;
  const used = taken
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter(Number.isFinite);
  return `${prefix}${Math.max(0, ...used) + 1}`;
}

export function validateMachineId(
  machineId: string,
  kind: string,
  location: LocationRef | undefined,
): string | null {
  const id = machineId.trim().toUpperCase();
  const code = location?.code;
  const kindCode = KIND_MACHINE_CODE[kind];
  if (!location || !code) return t("validation.locationInvalid");
  if (!kindCode) return t("validation.kindInvalid");
  const example = `${code}-${kindCode}1`;
  const match = MACHINE_ID_PATTERN.exec(id);
  if (!match) return t("validation.machineId.format", { example });
  if (match[1] !== code) {
    return t("validation.machineId.location", { location: location.name, code, example });
  }
  if (match[2] !== kindCode) {
    return t("validation.machineId.kind", { kind: equipmentKindLabel(kind), kindCode, example });
  }
  if (Number(match[3]) === 0) return t("validation.machineId.start");
  return null;
}

// Marca, modelo, nombre, fabricante. No puede probar que el texto exista, pero
// corta lo que claramente no es un nombre: "JJSJS", "aaaa", "...".
export function validateName(value: string, label: string): string | null {
  const text = value.trim();
  if (text.length < 2) return t("validation.min", { label, min: 2 });
  if (text.length > 60) return t("validation.max", { label, max: 60 });
  if (!NAME_CHARS.test(text)) return t("validation.name.chars", { label });
  if (!/\p{L}/u.test(text)) return t("validation.name.letters", { label });
  if (/(.)\1{3,}/iu.test(text)) return t("validation.name.invalid", { label });
  const words = text.split(/[^\p{L}]+/u).filter(Boolean);
  const gibberish = (w: string) =>
    (w.length >= 5 && !/[aeiouyáéíóúü]/iu.test(w)) ||
    (w.length >= 4 && isRepeatedChunk(w)) ||
    isKeyboardRun(w);
  if (words.some(gibberish)) return t("validation.name.invalid", { label });
  return null;
}

// N° de serie y part number: alfanumericos con guiones, con al menos un digito
export function validateCode(value: string, label: string): string | null {
  const text = value.trim();
  if (!CODE_PATTERN.test(text)) {
    return t("validation.code.format", { label });
  }
  if (!/\d/.test(text)) return t("validation.code.digit", { label });
  return null;
}

function collect<K extends string>(checks: Array<[K, string | null]>): FieldErrors<K> {
  const errors: FieldErrors<K> = {};
  for (const [field, error] of checks) if (error) errors[field] = error;
  return errors;
}

export function validateProduct(p: ProductFields): FieldErrors<keyof ProductFields> {
  return collect<keyof ProductFields>([
    ["machineId", validateMachineId(p.machineId, p.kind, p.location)],
    ["brand", validateName(p.brand, t("field.brand"))],
    ["model", validateName(p.model, t("field.model"))],
    ["serialNumber", validateCode(p.serialNumber, t("field.serialNumber"))],
    ["partNumber", validateCode(p.partNumber, t("field.partNumber"))],
  ]);
}

// Ubicacion: nombre legible y codigo de 1 a 3 letras (arranca los IDs de maquina)
export function validateLocation(l: LocationFields): FieldErrors<keyof LocationFields> {
  return collect<keyof LocationFields>([
    ["kind", l.kind in LOCATION_KIND_LETTER ? null : t("validation.location.kind")],
    [
      "number",
      Number.isInteger(l.number) && l.number >= 1 && l.number <= 99
        ? null
        : t("validation.location.number"),
    ],
    ["name", validateName(l.name, t("field.name"))],
  ]);
}

// "Administración" y "administracion" son la misma ubicacion
export function normalizeLocationName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Nombre y codigo (tipo + numero) no se repiten entre las ubicaciones vigentes.
// El servidor es la ultima barrera; esto lo avisa en el campo antes de enviar.
export function locationConflict(
  fields: LocationFields & { code: string | null },
  others: Array<Pick<Location, "id" | "name" | "code">>,
  exceptId?: string,
): FieldErrors<keyof LocationFields> {
  if (!fields.code) return {};
  const active = others.filter((l) => l.id !== exceptId);
  const sameCode = active.find((l) => l.code === fields.code);
  if (sameCode) {
    return {
      number: t("validation.location.duplicateCode", { name: sameCode.name, code: fields.code }),
    };
  }
  const normalized = normalizeLocationName(fields.name);
  if (active.some((l) => normalizeLocationName(l.name) === normalized)) {
    return { name: t("validation.location.duplicateName", { name: fields.name.trim() }) };
  }
  return {};
}

export interface ReservationFields {
  startsAt: string;
  endsAt: string;
  purpose: string;
}

const MAX_RESERVATION_DAYS = 14;

// Reserva: rango que empieza en el futuro, termina despues de empezar y no se
// extiende mas de dos semanas, con un motivo que se entienda
export function validateReservation(
  r: ReservationFields,
  now: number = Date.now(),
): FieldErrors<keyof ReservationFields> {
  const start = new Date(r.startsAt).getTime();
  const end = new Date(r.endsAt).getTime();
  const purpose = r.purpose.trim();
  return collect<keyof ReservationFields>([
    [
      "startsAt",
      Number.isNaN(start)
        ? t("validation.reservation.startInvalid")
        : start < now - 60_000
          ? t("validation.reservation.past")
          : null,
    ],
    [
      "endsAt",
      Number.isNaN(end)
        ? t("validation.reservation.endInvalid")
        : !Number.isNaN(start) && end <= start
          ? t("validation.reservation.order")
          : !Number.isNaN(start) && end - start > MAX_RESERVATION_DAYS * 86_400_000
            ? t("validation.reservation.maxDays", { days: MAX_RESERVATION_DAYS })
            : null,
    ],
    [
      "purpose",
      purpose.length < 5
        ? t("validation.reservation.purposeMin")
        : purpose.length > 300
          ? t("validation.reservation.purposeMax")
          : null,
    ],
  ]);
}

// ── Préstamos ────────────────────────────────────────────────────────────────
// La entrega no puede ser anterior a hoy y la devolución no puede ser anterior
// a la entrega. Se comparan días de calendario en hora local: NUNCA con
// toISOString(), que en Uruguay a las 21:00 ya cae en el día siguiente. Las
// fechas llegan como las elige el <input type="datetime-local">, sin zona.

export interface LoanFields {
  issueDate: string;
  returnDate: string;
}

const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Día "YYYY-MM-DD" elegido en la fecha, sin convertirla a UTC. */
export function localDateOnly(value: string): string | null {
  const match = DATE_PREFIX.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  const valid =
    date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day);
  return valid ? `${year}-${month}-${day}` : null;
}

/** Hoy como día de calendario local, en el mismo formato que localDateOnly. */
export function todayLocalDate(now: number | Date = Date.now()): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function validateLoan(
  loan: LoanFields,
  now: number | Date = Date.now(),
): FieldErrors<keyof LoanFields> {
  const issue = localDateOnly(loan.issueDate);
  const returning = localDateOnly(loan.returnDate);
  const today = todayLocalDate(now);
  // La hora solo desempata cuando las dos fechas caen el mismo día
  const issueTime = new Date(loan.issueDate).getTime();
  const returnTime = new Date(loan.returnDate).getTime();
  return collect<keyof LoanFields>([
    [
      "issueDate",
      !issue ? t("error.loan.issueInvalid") : issue < today ? t("error.loan.issuePast") : null,
    ],
    [
      "returnDate",
      !returning
        ? t("error.loan.returnInvalid")
        : !issue
          ? null
          : returning < issue
            ? t("error.loan.returnBeforeIssue")
            : Number.isNaN(returnTime) || returnTime <= issueTime
              ? t("error.loan.dates")
              : null,
    ],
  ]);
}

// Comentario: ni vacio ni un texto interminable
export function validateComment(body: string): string | null {
  const text = body.trim();
  if (!text) return t("validation.comment.empty");
  if (text.length > 1000) return t("validation.comment.max");
  return null;
}

// Intervencion: tipo conocido, descripcion util y fecha que ya paso
export function validateIntervention(
  i: InterventionFields,
  now: number = Date.now(),
): FieldErrors<keyof InterventionFields> {
  const description = i.description.trim();
  const performedAt = new Date(i.performedAt).getTime();
  return collect<keyof InterventionFields>([
    ["type", i.type in INTERVENTION_TYPE_LABELS ? null : t("validation.intervention.type")],
    [
      "description",
      description.length < 10
        ? t("validation.intervention.descriptionMin")
        : description.length > 1000
          ? t("validation.intervention.descriptionMax")
          : null,
    ],
    [
      "partsReplaced",
      (i.partsReplaced ?? "").trim().length > 300 ? t("validation.intervention.partsMax") : null,
    ],
    [
      "performedAt",
      Number.isNaN(performedAt)
        ? t("validation.intervention.dateInvalid")
        : performedAt > now + 60_000
          ? t("validation.intervention.dateFuture")
          : null,
    ],
  ]);
}

export function validateComponent(c: ComponentFields): FieldErrors<keyof ComponentFields> {
  return collect<keyof ComponentFields>([
    ["name", validateName(c.name, t("field.name"))],
    ["model", validateName(c.model, t("field.model"))],
    ["manufacturer", validateName(c.manufacturer, t("field.manufacturer"))],
    ["serialNumber", validateCode(c.serialNumber, t("field.serialNumber"))],
    ["partNumber", validateCode(c.partNumber, t("field.partNumber"))],
  ]);
}

// ── Usuarios ─────────────────────────────────────────────────────────────────
// Las usan el formulario de usuarios, el de cambio de contraseña y la API

export const PASSWORD_MIN_LENGTH = 6;

export interface UserFields {
  name: string;
  dni: string;
  email: string;
  role: string;
  /** Vacio al editar: no se cambia */
  password: string;
}

const DNI_PATTERN = /^\d{8}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return t("validation.password.min", { min: PASSWORD_MIN_LENGTH });
  }
  if (password.length > 128) return t("validation.password.max");
  return null;
}

/**
 * Contrasena nueva al cambiarla desde el perfil: la politica vigente y, ademas,
 * no repetir la actual. Comparacion exacta: el hash argon2 de la API distingue
 * mayusculas y espacios, asi que no hay "variante equivalente" que detectar.
 */
export function validateNewPassword(currentPassword: string, newPassword: string): string | null {
  return (
    validatePassword(newPassword) ??
    (newPassword === currentPassword ? t("error.password.same") : null)
  );
}

/** `requirePassword`: al crear es obligatoria; al editar, vacia significa "no cambiar". */
export function validateUser(
  u: UserFields,
  requirePassword: boolean,
): FieldErrors<keyof UserFields> {
  return collect<keyof UserFields>([
    ["name", validateName(u.name, t("field.name"))],
    ["dni", DNI_PATTERN.test(u.dni.trim()) ? null : t("validation.user.dni")],
    ["email", EMAIL_PATTERN.test(u.email.trim()) ? null : t("validation.user.email")],
    ["role", u.role in ROLE_CONFIG ? null : t("validation.user.role")],
    ["password", requirePassword || u.password ? validatePassword(u.password) : null],
  ]);
}

// ── Tickets y solicitudes ────────────────────────────────────────────────────

export interface TicketFields {
  title: string;
  description: string;
  category: string;
}

function textLength(value: string, label: string, min: number, max: number): string | null {
  const text = value.trim();
  if (text.length < min) return t("validation.min", { label, min });
  if (text.length > max) return t("validation.max", { label, max });
  return null;
}

export function validateTicket(tk: TicketFields): FieldErrors<keyof TicketFields> {
  return collect<keyof TicketFields>([
    ["title", textLength(tk.title, t("field.title"), 3, 120)],
    ["description", textLength(tk.description, t("field.description"), 5, 2000)],
    ["category", tk.category in TICKET_CATEGORY_LABELS ? null : t("validation.ticket.category")],
  ]);
}

export interface ServiceRequestFields {
  type: string;
  description: string;
}

export function validateServiceRequest(
  s: ServiceRequestFields,
): FieldErrors<keyof ServiceRequestFields> {
  return collect<keyof ServiceRequestFields>([
    ["type", s.type in SERVICE_TYPE_LABELS ? null : t("validation.service.type")],
    ["description", textLength(s.description, t("field.description"), 5, 2000)],
  ]);
}

/** Primer error de un formulario, para mostrarlo en un solo mensaje. */
export function firstError(errors: FieldErrors<string>): string | null {
  return Object.values(errors)[0] ?? null;
}
