import { KIND_MACHINE_CODE, LOCATION_CODES } from "./constants";
import type { Location } from "./types";

// Reglas de nomenclatura de equipos. Las usan el formulario (feedback por
// campo) y los handlers (ultima barrera), para que no diverjan.

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export interface ProductFields {
  machineId: string;
  kind: string;
  location: string;
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

// {codigo de ubicacion}{n° de area}-{codigo de tipo}{n° correlativo}: L1-PC3, S1-PRY2
const MACHINE_ID_PATTERN = /^([A-Z])(\d{1,2})-([A-Z]{2,3})(\d{1,3})$/;
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

export function machineIdPrefix(kind: string, location: string): string | null {
  const locationCode = LOCATION_CODES[location as Location];
  const kindCode = KIND_MACHINE_CODE[kind];
  return locationCode && kindCode ? `${locationCode}1-${kindCode}` : null;
}

// Proximo ID libre para el area 1 de la ubicacion, como sugerencia
export function suggestMachineId(kind: string, location: string, taken: string[]): string | null {
  const prefix = machineIdPrefix(kind, location);
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
  location: string,
): string | null {
  const id = machineId.trim().toUpperCase();
  const locationCode = LOCATION_CODES[location as Location];
  const kindCode = KIND_MACHINE_CODE[kind];
  if (!locationCode) return "Ubicación inválida";
  if (!kindCode) return "Tipo de equipo inválido";
  const example = `${locationCode}1-${kindCode}1`;
  const match = MACHINE_ID_PATTERN.exec(id);
  if (!match) return `Formato inválido. Ej: ${example}`;
  if (match[1] !== locationCode) {
    return `Un equipo en ${location} empieza con "${locationCode}". Ej: ${example}`;
  }
  if (match[3] !== kindCode) return `Un ${kind} usa el código "${kindCode}". Ej: ${example}`;
  if (Number(match[2]) === 0 || Number(match[4]) === 0) return "Los números arrancan en 1";
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

export function validateComponent(c: ComponentFields): FieldErrors<keyof ComponentFields> {
  return collect<keyof ComponentFields>([
    ["name", validateName(c.name, "Nombre")],
    ["model", validateName(c.model, "Modelo")],
    ["manufacturer", validateName(c.manufacturer, "Fabricante")],
    ["serialNumber", validateCode(c.serialNumber, "N° de serie")],
    ["partNumber", validateCode(c.partNumber, "Part number")],
  ]);
}
