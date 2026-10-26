import type { StudentShift, User, UserRole } from "./types";
import { validateName, type FieldErrors } from "./validation";

// Mismas reglas que src/lib/students.ts del frontend, sin i18n: la API responde
// en espanol y el cliente traduce las plantillas conocidas (src/i18n/errors.ts).

export const STUDENT_SHIFTS = ["matutino", "vespertino", "nocturno"] as const;

export const STUDENT_GROUP_MAX = 20;
export const STUDENT_SUBJECTS_MAX = 20;
export const STUDENT_SUBJECT_MAX = 60;

export const STUDENT_GROUP_PATTERN = /^[\p{L}\d][\p{L}\d .°º/-]{0,19}$/u;

export interface StudentFields {
  studentGroup: string | null;
  studentShift: string | null;
  studentSubjects: string[];
}

/** Ficha ya normalizada: turno valido o null */
export interface NormalizedStudent extends StudentFields {
  studentShift: StudentShift | null;
}

export type StudentFieldName = keyof StudentFields;

export function isStudentShift(value: unknown): value is StudentShift {
  return typeof value === "string" && (STUDENT_SHIFTS as readonly string[]).includes(value);
}

export function normalizeGroup(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  return text ? text : null;
}

const SUBJECT_SEPARATOR = /[,;|]/;

export function parseSubjects(
  value: string | readonly string[] | null | undefined,
  max: number = STUDENT_SUBJECTS_MAX,
): string[] {
  const parts = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(SUBJECT_SEPARATOR)
      : [];
  const seen = new Set<string>();
  const subjects: string[] = [];
  for (const part of parts) {
    const text = String(part ?? "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    const key = text.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    subjects.push(text);
    if (subjects.length === max) break;
  }
  return subjects;
}

export function emptyStudent(): NormalizedStudent {
  return { studentGroup: null, studentShift: null, studentSubjects: [] };
}

/** Solo el solicitante conserva ficha de estudiante; el resto queda vacio. */
export function normalizeStudent(
  input: Partial<StudentFields> | null | undefined,
  role: UserRole,
): NormalizedStudent {
  if (role !== "solicitante") return emptyStudent();
  return {
    studentGroup: normalizeGroup(input?.studentGroup),
    studentShift: isStudentShift(input?.studentShift) ? input.studentShift : null,
    studentSubjects: parseSubjects(input?.studentSubjects),
  };
}

function collect<K extends string>(checks: Array<[K, string | null]>): FieldErrors<K> {
  const errors: FieldErrors<K> = {};
  for (const [field, error] of checks) if (error) errors[field] = error;
  return errors;
}

export function validateStudent(s: StudentFields): FieldErrors<StudentFieldName> {
  const group = normalizeGroup(s.studentGroup);
  const groupError =
    group && (group.length > STUDENT_GROUP_MAX || !STUDENT_GROUP_PATTERN.test(group))
      ? `Grupo: hasta ${STUDENT_GROUP_MAX} caracteres (ej. 1°B)`
      : null;
  const shiftError = s.studentShift && !isStudentShift(s.studentShift) ? "Turno inválido" : null;
  const subjects = parseSubjects(s.studentSubjects, STUDENT_SUBJECTS_MAX + 1);
  const subjectsError =
    subjects.length > STUDENT_SUBJECTS_MAX ||
    subjects.some((subject) => subject.length < 2 || subject.length > STUDENT_SUBJECT_MAX)
      ? `Materias: hasta ${STUDENT_SUBJECTS_MAX} materias de ${STUDENT_SUBJECT_MAX} caracteres`
      : null;
  return collect<StudentFieldName>([
    ["studentGroup", groupError],
    ["studentShift", shiftError],
    ["studentSubjects", subjectsError],
  ]);
}

export interface UserFilters {
  search?: string;
  role?: string;
  group?: string;
  shift?: string;
  subject?: string;
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("es") === b.trim().toLocaleLowerCase("es");
}

export function matchesUserFilters(u: User, f: UserFilters): boolean {
  const search = f.search?.trim().toLocaleLowerCase("es") ?? "";
  if (
    search &&
    !u.name.toLocaleLowerCase("es").includes(search) &&
    !u.dni.includes(search) &&
    !u.email.toLocaleLowerCase("es").includes(search)
  ) {
    return false;
  }
  if (f.role && u.role !== f.role) return false;
  if (f.group && !(u.studentGroup && sameText(u.studentGroup, f.group))) return false;
  if (f.shift && u.studentShift !== f.shift) return false;
  if (f.subject && !u.studentSubjects.some((subject) => sameText(subject, f.subject!))) {
    return false;
  }
  return true;
}

export function filterUsers(users: User[], filters: UserFilters): User[] {
  return users.filter((u) => matchesUserFilters(u, filters));
}

// ── Importación CSV ──────────────────────────────────────────────────────────
// Una fila del CSV ya parseada por el cliente. La API vuelve a validar todo:
// el archivo es entrada del usuario y el frontend no es la ultima barrera.

const DNI_PATTERN = /^\d{8}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const IMPORT_ROLES: UserRole[] = ["solicitante", "tecnico", "admin"];
export const IMPORT_PASSWORD_MIN = 6;

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
  studentSubjects?: string[] | null;
}

export interface NormalizedImportRow {
  line: number;
  name: string;
  dni: string;
  email: string;
  role: UserRole;
  password: string | null;
  isActive: boolean;
  student: NormalizedStudent;
}

export type ImportRowResult = { error: string } | { row: NormalizedImportRow };

/** Valida y normaliza una fila; el error viene listo para mostrar. */
export function validateImportRow(input: ImportRowInput): ImportRowResult {
  const line = Number.isInteger(input.line) && input.line > 0 ? input.line : 1;
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  const dni = (input.dni ?? "").trim();
  const email = (input.email ?? "").trim().toLowerCase();
  const roleText = (input.role ?? "").trim() || "solicitante";

  const nameError = validateName(name, "Nombre");
  if (nameError) return { error: nameError };
  if (!DNI_PATTERN.test(dni)) return { error: "Cédula: 8 dígitos, sin puntos ni guión" };
  if (!EMAIL_PATTERN.test(email)) return { error: "Email inválido" };
  if (!IMPORT_ROLES.includes(roleText as UserRole)) return { error: "Rol inválido" };

  const role = roleText as UserRole;
  const rawStudent: StudentFields = {
    studentGroup: normalizeGroup(input.studentGroup),
    studentShift: (input.studentShift ?? "").trim() || null,
    studentSubjects: parseSubjects(input.studentSubjects),
  };
  const hasStudentData = Boolean(
    rawStudent.studentGroup || rawStudent.studentShift || rawStudent.studentSubjects.length > 0,
  );
  if (role !== "solicitante" && hasStudentData) {
    return { error: "Solo los solicitantes tienen datos de estudiante" };
  }
  if (role === "solicitante") {
    const studentError = Object.values(validateStudent(rawStudent))[0];
    if (studentError) return { error: studentError };
  }

  const password = (input.password ?? "").trim() || null;
  if (password && password.length < IMPORT_PASSWORD_MIN) {
    return { error: `La contraseña debe tener al menos ${IMPORT_PASSWORD_MIN} caracteres` };
  }

  return {
    row: {
      line,
      name,
      dni,
      email,
      role,
      password,
      isActive: input.isActive ?? true,
      student: normalizeStudent(rawStudent, role),
    },
  };
}
