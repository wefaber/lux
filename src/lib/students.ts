import { t } from "@/i18n";
import type { StudentShift, User, UserRole } from "./types";
import type { FieldErrors } from "./validation";

// Datos de estudiante: grupo, turno y materias de un solicitante. Viven en el
// mismo registro del usuario (no hay tabla aparte): son datos de la persona,
// opcionales y sin historial propio. Los usan el formulario, la lista con sus
// filtros, la importación CSV y los handlers del mock.

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

export const EMPTY_STUDENT: NormalizedStudent = {
  studentGroup: null,
  studentShift: null,
  studentSubjects: [],
};

export function isStudentShift(value: unknown): value is StudentShift {
  return typeof value === "string" && (STUDENT_SHIFTS as readonly string[]).includes(value);
}

/** Grupo sin espacios de sobra; vacio es null (dato no cargado). */
export function normalizeGroup(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  return text ? text : null;
}

// Materias escritas en un solo campo: "Programación, Redes" (también acepta
// punto y coma o barra). En CSV se usa "|" como separador interno.
const SUBJECT_SEPARATOR = /[,;|]/;

/** Lista limpia: sin vacios, sin repetidas (sin distinguir mayusculas) y con tope. */
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
  return { ...EMPTY_STUDENT, studentSubjects: [] };
}

/**
 * Deja los datos como se guardan: solo el solicitante tiene ficha de
 * estudiante; el resto queda vacio. Valida antes de llamar.
 */
export function normalizeStudent(
  input: Partial<StudentFields> | null | undefined,
  role: UserRole,
): NormalizedStudent {
  if (role !== "solicitante") return emptyStudent();
  const shift = isStudentShift(input?.studentShift) ? input.studentShift : null;
  return {
    studentGroup: normalizeGroup(input?.studentGroup),
    studentShift: shift,
    studentSubjects: parseSubjects(input?.studentSubjects),
  };
}

export function validateStudent(s: StudentFields): FieldErrors<StudentFieldName> {
  const group = normalizeGroup(s.studentGroup);
  const groupError =
    group && (group.length > STUDENT_GROUP_MAX || !STUDENT_GROUP_PATTERN.test(group))
      ? t("validation.student.group", { max: STUDENT_GROUP_MAX })
      : null;
  const shiftError = s.studentShift && !isStudentShift(s.studentShift) ? t("validation.student.shift") : null;
  const subjects = parseSubjects(s.studentSubjects, STUDENT_SUBJECTS_MAX + 1);
  const tooMany = subjects.length > STUDENT_SUBJECTS_MAX;
  const badSubject = subjects.some(
    (subject) => subject.length < 2 || subject.length > STUDENT_SUBJECT_MAX,
  );
  const subjectsError =
    tooMany || badSubject
      ? t("validation.student.subjects", {
          max: STUDENT_SUBJECTS_MAX,
          chars: STUDENT_SUBJECT_MAX,
        })
      : null;
  const errors: FieldErrors<StudentFieldName> = {};
  if (groupError) errors.studentGroup = groupError;
  if (shiftError) errors.studentShift = shiftError;
  if (subjectsError) errors.studentSubjects = subjectsError;
  return errors;
}

/** true si el usuario tiene algo de su ficha de estudiante cargado. */
export function hasStudentInfo(u: User): boolean {
  return Boolean(u.studentGroup || u.studentShift || u.studentSubjects.length > 0);
}

export interface UserFilters {
  search?: string;
  role?: UserRole | "";
  group?: string;
  shift?: StudentShift | "";
  subject?: string;
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("es") === b.trim().toLocaleLowerCase("es");
}

/** Filtro de la lista de usuarios. Funcion pura: la usan la pantalla y los tests. */
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

/** Grupos cargados, ordenados para el desplegable. */
export function studentGroups(users: User[]): string[] {
  const groups = new Set<string>();
  for (const u of users) if (u.studentGroup) groups.add(u.studentGroup);
  return [...groups].toSorted((a, b) => a.localeCompare(b, "es", { numeric: true }));
}

/** Materias cargadas, ordenadas para el desplegable. */
export function studentSubjects(users: User[]): string[] {
  const byKey = new Map<string, string>();
  for (const u of users) {
    for (const subject of u.studentSubjects) {
      const key = subject.toLocaleLowerCase("es");
      if (!byKey.has(key)) byKey.set(key, subject);
    }
  }
  return [...byKey.values()].toSorted((a, b) => a.localeCompare(b, "es"));
}
