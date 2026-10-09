import { INTERVENTION_TYPE_LABELS, KIND_MACHINE_CODE, LOCATION_KIND_LETTER } from "./constants";
import type { LocationKind } from "./types";

// Reglas de nomenclatura de equipos. Las usan el formulario (feedback por
// campo) y los handlers (ultima barrera), para que no diverjan.

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
  if (!location || !code) return "Ubicación inválida";
  if (!kindCode) return "Tipo de equipo inválido";
  const example = `${code}-${kindCode}1`;
  const match = MACHINE_ID_PATTERN.exec(id);
  if (!match) return `Formato inválido. Ej: ${example}`;
  if (match[1] !== code) {
    return `Un equipo en ${location.name} empieza con "${code}-". Ej: ${example}`;
  }
  if (match[2] !== kindCode) return `Un ${kind} usa el código "${kindCode}". Ej: ${example}`;
  if (Number(match[3]) === 0) return "Los números arrancan en 1";
  return null;
}

// Marca, modelo, nombre, fabricante. No puede probar que el texto exista, pero
// corta lo que claramente no es un nombre: "JJSJS", "aaaa", "...".
export function validateName(value: string, label: string): string | null {
  const text = value.trim();
  if (text.length < 2) return `${label}: mínimo 2 caracteres`;
  if (text.length > 60) return `${label}: máximo 60 caracteres`;
  if (!NAME_CHARS.test(text)) return `${label}: tiene caracteres no permitidos`;
  if (!/\p{L}/u.test(text)) return `${label}: tiene que incluir letras`;
  if (/(.)\1{3,}/iu.test(text)) return `${label}: no parece un nombre válido`;
  const words = text.split(/[^\p{L}]+/u).filter(Boolean);
  const gibberish = (w: string) =>
    (w.length >= 5 && !/[aeiouyáéíóúü]/iu.test(w)) ||
    (w.length >= 4 && isRepeatedChunk(w)) ||
    isKeyboardRun(w);
  if (words.some(gibberish)) return `${label}: no parece un nombre válido`;
  return null;
}

// N° de serie y part number: alfanumericos con guiones, con al menos un digito
export function validateCode(value: string, label: string): string | null {
  const text = value.trim();
  if (!CODE_PATTERN.test(text)) {
    return `${label}: entre 3 y 40 caracteres, solo letras, números, "-", "/" o "."`;
  }
  if (!/\d/.test(text)) return `${label}: tiene que incluir al menos un número`;
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
    ["brand", validateName(p.brand, "Marca")],
    ["model", validateName(p.model, "Modelo")],
    ["serialNumber", validateCode(p.serialNumber, "N° de serie")],
    ["partNumber", validateCode(p.partNumber, "Part number")],
  ]);
}

// Ubicacion: nombre legible y codigo de 1 a 3 letras (arranca los IDs de maquina)
export function validateLocation(l: LocationFields): FieldErrors<keyof LocationFields> {
  return collect<keyof LocationFields>([
    ["kind", l.kind in LOCATION_KIND_LETTER ? null : "Elegí el tipo de ubicación"],
    [
      "number",
      Number.isInteger(l.number) && l.number >= 1 && l.number <= 99
        ? null
        : "Número: entero entre 1 y 99",
    ],
    ["name", validateName(l.name, "Nombre")],
  ]);
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
        ? "Fecha de inicio inválida"
        : start < now - 60_000
          ? "La reserva no puede empezar en el pasado"
          : null,
    ],
    [
      "endsAt",
      Number.isNaN(end)
        ? "Fecha de fin inválida"
        : !Number.isNaN(start) && end <= start
          ? "El fin tiene que ser posterior al inicio"
          : !Number.isNaN(start) && end - start > MAX_RESERVATION_DAYS * 86_400_000
            ? `Una reserva dura como máximo ${MAX_RESERVATION_DAYS} días`
            : null,
    ],
    [
      "purpose",
      purpose.length < 5
        ? "Motivo: mínimo 5 caracteres"
        : purpose.length > 300
          ? "Motivo: máximo 300 caracteres"
          : null,
    ],
  ]);
}

// Comentario: ni vacio ni un texto interminable
export function validateComment(body: string): string | null {
  const text = body.trim();
  if (!text) return "El comentario no puede estar vacío";
  if (text.length > 1000) return "El comentario no puede superar los 1000 caracteres";
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
    ["type", i.type in INTERVENTION_TYPE_LABELS ? null : "Elegí el tipo de intervención"],
    [
      "description",
      description.length < 10
        ? "Descripción: mínimo 10 caracteres"
        : description.length > 1000
          ? "Descripción: máximo 1000 caracteres"
          : null,
    ],
    [
      "partsReplaced",
      (i.partsReplaced ?? "").trim().length > 300 ? "Piezas: máximo 300 caracteres" : null,
    ],
    [
      "performedAt",
      Number.isNaN(performedAt)
        ? "Fecha inválida"
        : performedAt > now + 60_000
          ? "La fecha no puede ser futura"
          : null,
    ],
  ]);
}

export function validateComponent(c: ComponentFields): FieldErrors<keyof ComponentFields> {
  return collect<keyof ComponentFields>([
    ["name", validateName(c.name, "Nombre")],
    ["model", validateName(c.model, "Modelo")],
    ["manufacturer", validateName(c.manufacturer, "Fabricante")],
    ["serialNumber", validateCode(c.serialNumber, "N° de serie")],
    ["partNumber", validateCode(c.partNumber, "Part number")],
  ]);
}
