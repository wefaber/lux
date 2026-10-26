import { parseSubjects, validateStudent } from "./students";
import { validateUser } from "./validation";
import { ASSIGNABLE_ROLES } from "./roles";
import { t } from "@/i18n";
import type { UserRole } from "./types";

export type CsvCell = string | number | boolean | null | undefined;

// Punto y coma como separador: Excel en es-UY usa coma decimal y no separa
// columnas con coma. El parser acepta coma o tabulador si el encabezado los usa.
const SEPARATOR = ";";

function escapeCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  const text = String(cell);
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(escapeCell).join(SEPARATOR)).join("\r\n");
} // Serializa filas a CSV

export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  // El BOM hace que Excel abra el archivo como UTF-8 y respete los acentos
  const blob = new Blob(["\uFEFF", toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
} // Descarga un CSV desde el navegador

// ── Lectura de CSV ───────────────────────────────────────────────────────────

/** Primer renglon fuera de comillas: el separador mas repetido manda. */
function detectDelimiter(text: string): string {
  const candidates = [";", ",", "\t"];
  const counts = new Map(candidates.map((c) => [c, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        i++;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) break;
    if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  const [best] = [...counts.entries()].toSorted((a, b) => b[1] - a[1]);
  return best && best[1] > 0 ? best[0] : SEPARATOR;
}

/**
 * CSV a matriz de celdas. Soporta comillas, comillas escapadas ("") y saltos
 * de linea dentro de una celda. Descarta filas totalmente vacias.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

// ── Importación de usuarios ──────────────────────────────────────────────────

/** Columnas del CSV de importacion, en el orden de la plantilla. */
export const USER_IMPORT_COLUMNS = [
  "nombre",
  "documento",
  "email",
  "rol",
  "grupo",
  "turno",
  "materias",
  "activo",
  "contrasena",
] as const;

export type ImportColumn = "name" | "dni" | "email" | "role" | "group" | "shift" | "subjects" | "active" | "password";

const HEADER_ALIASES: Record<ImportColumn, string[]> = {
  name: ["nombre", "nombre completo", "name", "apellido y nombre"],
  dni: ["documento", "cedula", "dni", "documento de identidad"],
  email: ["email", "correo", "correo electronico", "mail"],
  role: ["rol", "role", "tipo de usuario"],
  group: ["grupo", "group", "clase", "grupo clase"],
  shift: ["turno", "shift"],
  subjects: ["materias", "subjects", "asignaturas"],
  active: ["activo", "active", "estado"],
  password: ["contrasena", "clave", "password"],
};

const REQUIRED_COLUMNS: ImportColumn[] = ["name", "dni", "email"];

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ");
}

export interface UserImportRow {
  /** Numero de fila del archivo: la primera fila de datos es la 2 */
  line: number;
  name: string;
  dni: string;
  email: string;
  role: UserRole;
  password: string | null;
  isActive: boolean;
  studentGroup: string | null;
  studentShift: string | null;
  studentSubjects: string[];
}

export interface UserImportRowError {
  line: number;
  message: string;
}

export interface UserImportParse {
  /** Filas validas, listas para mandar a importUsers */
  rows: UserImportRow[];
  /** Filas rechazadas por validacion (no abortan el resto) */
  errors: UserImportRowError[];
  /** Columnas obligatorias que faltan en el encabezado */
  missingColumns: ImportColumn[];
  /** Columnas del archivo que no se usan */
  unknownColumns: string[];
  /** Filas de datos leidas (validas + con error) */
  total: number;
}

export interface ImportRowInput {
  line: number;
  name: string;
  dni: string;
  email: string;
  role?: string | null;
  password?: string | null;
  isActive?: boolean | null;
  studentGroup?: string | null;
  studentShift?: string | null;
  studentSubjects?: string[] | string | null;
}

export type ImportRowValidation = { error: string } | { row: UserImportRow };

/** Valida y normaliza una fila. La usan el parser, el mock y los tests. */
export function validateImportRow(input: ImportRowInput): ImportRowValidation {
  const line = Number.isInteger(input.line) && input.line > 0 ? input.line : 1;
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  const dni = (input.dni ?? "").trim();
  const email = (input.email ?? "").trim().toLowerCase();
  const roleText = (input.role ?? "").trim().toLocaleLowerCase("es") || "solicitante";
  if (!ASSIGNABLE_ROLES.includes(roleText as UserRole)) {
    return { error: t("validation.user.role") };
  }

  const fields = { name, dni, email, role: roleText, password: input.password ?? "" };
  const errors = validateUser(fields, false);
  const firstError = Object.values(errors)[0];
  if (firstError) return { error: firstError };

  const rawStudent = {
    studentGroup: (input.studentGroup ?? "").trim() || null,
    studentShift: (input.studentShift ?? "").trim().toLocaleLowerCase("es") || null,
    studentSubjects: parseSubjects(input.studentSubjects),
  };
  const hasStudentData = Boolean(
    rawStudent.studentGroup || rawStudent.studentShift || rawStudent.studentSubjects.length > 0,
  );
  if (roleText !== "solicitante" && hasStudentData) {
    return { error: t("validation.student.onlyRequesters") };
  }
  const studentErrors = validateStudent(rawStudent);
  const studentError = Object.values(studentErrors)[0];
  if (studentError) return { error: studentError };

  return {
    row: {
      line,
      name,
      dni,
      email,
      role: roleText as UserRole,
      password: input.password?.trim() || null,
      isActive: input.isActive ?? true,
      studentGroup: rawStudent.studentGroup,
      studentShift: rawStudent.studentShift,
      studentSubjects: rawStudent.studentSubjects,
    },
  };
}

function parseActive(value: string): boolean | null {
  const text = normalizeHeader(value);
  if (!text) return null;
  if (["si", "sí", "true", "1", "activo", "active", "x"].includes(text)) return true;
  if (["no", "false", "0", "inactivo", "inactive"].includes(text)) return false;
  return null;
}

/**
 * Lee el CSV de usuarios. Devuelve las filas validas y los errores por fila:
 * una fila mala no descarta el resto del archivo.
 */
export function parseUserImportCsv(text: string): UserImportParse {
  const [headerRow = [], ...dataRows] = parseCsv(text);
  const headers = headerRow.map(normalizeHeader);
  const index = new Map<ImportColumn, number>();
  for (const [column, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [ImportColumn, string[]]
  >) {
    const position = headers.findIndex((header) => aliases.includes(header));
    if (position >= 0) index.set(column, position);
  }
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !index.has(column));
  const knownHeaders = new Set(Object.values(HEADER_ALIASES).flat());
  const unknownColumns = headerRow.filter(
    (header) => header.trim() && !knownHeaders.has(normalizeHeader(header)),
  );

  const rows: UserImportRow[] = [];
  const errors: UserImportRowError[] = [];
  if (missingColumns.length > 0) {
    return { rows, errors, missingColumns, unknownColumns, total: dataRows.length };
  }

  const value = (cells: string[], column: ImportColumn): string => {
    const position = index.get(column);
    return position === undefined ? "" : (cells[position] ?? "").trim();
  };

  dataRows.forEach((cells, i) => {
    const line = i + 2;
    const activeText = value(cells, "active");
    const active = parseActive(activeText);
    if (activeText && active === null) {
      errors.push({ line, message: t("validation.student.active") });
      return;
    }
    const shift = value(cells, "shift").toLocaleLowerCase("es");
    if (shift && !["matutino", "vespertino", "nocturno"].includes(shift)) {
      errors.push({ line, message: t("validation.student.shift") });
      return;
    }
    const validated = validateImportRow({
      line,
      name: value(cells, "name"),
      dni: value(cells, "dni"),
      email: value(cells, "email"),
      role: value(cells, "role"),
      password: value(cells, "password"),
      isActive: active ?? true,
      studentGroup: value(cells, "group"),
      studentShift: shift,
      studentSubjects: value(cells, "subjects"),
    });
    if ("error" in validated) errors.push({ line, message: validated.error });
    else rows.push(validated.row);
  });

  // Duplicados dentro del archivo: el segundo se reporta; el servidor ademas
  // compara contra los usuarios que ya existen.
  const seenDni = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  const unique: UserImportRow[] = [];
  for (const row of rows) {
    const firstDni = seenDni.get(row.dni);
    const firstEmail = seenEmail.get(row.email);
    if (firstDni !== undefined) {
      errors.push({
        line: row.line,
        message: t("validation.student.duplicateDni", { dni: row.dni, line: firstDni }),
      });
      continue;
    }
    if (firstEmail !== undefined) {
      errors.push({
        line: row.line,
        message: t("validation.student.duplicateEmail", { email: row.email, line: firstEmail }),
      });
      continue;
    }
    seenDni.set(row.dni, row.line);
    seenEmail.set(row.email, row.line);
    unique.push(row);
  }

  return {
    rows: unique,
    errors: errors.toSorted((a, b) => a.line - b.line),
    missingColumns,
    unknownColumns,
    total: dataRows.length,
  };
}

export const EXAMPLE_IMPORT_ROW: CsvCell[] = [
  "Ana García",
  "67890123",
  "agarcia@iti.edu.uy",
  "solicitante",
  "1°B",
  "matutino",
  "Matemática|Programación",
  "sí",
  "",
];

/** Encabezados + un ejemplo, para descargar la plantilla desde la pantalla. */
export function userImportTemplate(): CsvCell[][] {
  return [[...USER_IMPORT_COLUMNS], EXAMPLE_IMPORT_ROW];
}
