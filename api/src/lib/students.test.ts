import { describe, expect, test } from "bun:test";
import {
  filterUsers,
  normalizeStudent,
  parseSubjects,
  validateImportRow,
  validateStudent,
} from "./students";
import type { User } from "./types";

const user = (overrides: Partial<User> = {}): User => ({
  id: "u-1",
  name: "Ana García",
  dni: "67890123",
  email: "agarcia@iti.edu.uy",
  role: "solicitante",
  isActive: true,
  studentGroup: "1°B",
  studentShift: "matutino",
  studentSubjects: ["Matemática", "Programación"],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

describe("ficha de estudiante (API)", () => {
  test("valida grupo, turno y materias con las mismas reglas que el frontend", () => {
    expect(
      validateStudent({
        studentGroup: "2°A",
        studentShift: "vespertino",
        studentSubjects: ["Redes"],
      }),
    ).toEqual({});
    expect(
      validateStudent({ studentGroup: "<script>", studentShift: "mañana", studentSubjects: ["A"] }),
    ).toEqual({
      studentGroup: "Grupo: hasta 20 caracteres (ej. 1°B)",
      studentShift: "Turno inválido",
      studentSubjects: "Materias: hasta 20 materias de 60 caracteres",
    });
  });

  test("normaliza y vacía la ficha de quien no es solicitante", () => {
    expect(
      normalizeStudent(
        { studentGroup: "  1°B ", studentShift: "matutino", studentSubjects: ["Redes", "redes"] },
        "solicitante",
      ),
    ).toEqual({ studentGroup: "1°B", studentShift: "matutino", studentSubjects: ["Redes"] });
    expect(
      normalizeStudent(
        { studentGroup: "1°B", studentShift: "otro", studentSubjects: ["Redes"] },
        "solicitante",
      ),
    ).toEqual({ studentGroup: "1°B", studentShift: null, studentSubjects: ["Redes"] });
    expect(
      normalizeStudent(
        { studentGroup: "1°B", studentShift: "matutino", studentSubjects: ["Redes"] },
        "admin",
      ),
    ).toEqual({ studentGroup: null, studentShift: null, studentSubjects: [] });
  });

  test("separa materias y descarta repetidas", () => {
    expect(parseSubjects("Redes, Programación;Redes|Base de Datos")).toEqual([
      "Redes",
      "Programación",
      "Base de Datos",
    ]);
  });

  test("filtra por grupo, turno y materia sin distinguir mayúsculas", () => {
    const users = [
      user(),
      user({ id: "u-2", studentGroup: "2°A", studentShift: "nocturno", studentSubjects: ["Redes"] }),
    ];
    expect(filterUsers(users, { group: "1°b" }).map((u) => u.id)).toEqual(["u-1"]);
    expect(filterUsers(users, { shift: "nocturno" }).map((u) => u.id)).toEqual(["u-2"]);
    expect(filterUsers(users, { subject: "redes" }).map((u) => u.id)).toEqual(["u-2"]);
  });
});

describe("fila de importación (API)", () => {
  const base = {
    line: 2,
    name: "Ana García",
    dni: "67890123",
    email: "Ana@ITI.edu.uy",
    role: "solicitante",
  };

  test("normaliza una fila válida y usa solicitante por defecto", () => {
    const result = validateImportRow({
      ...base,
      role: null,
      studentGroup: "1°B",
      studentShift: "matutino",
      studentSubjects: ["Matemática", "Programación"],
    });
    expect(result).toEqual({
      row: {
        line: 2,
        name: "Ana García",
        dni: "67890123",
        email: "ana@iti.edu.uy",
        role: "solicitante",
        password: null,
        isActive: true,
        student: {
          studentGroup: "1°B",
          studentShift: "matutino",
          studentSubjects: ["Matemática", "Programación"],
        },
      },
    });
  });

  test("rechaza documento, email, rol y contraseña inválidos", () => {
    expect(validateImportRow({ ...base, dni: "123" })).toEqual({
      error: "Cédula: 8 dígitos, sin puntos ni guión",
    });
    expect(validateImportRow({ ...base, email: "sin-arroba" })).toEqual({
      error: "Email inválido",
    });
    expect(validateImportRow({ ...base, role: "root_admin" })).toEqual({ error: "Rol inválido" });
    expect(validateImportRow({ ...base, password: "123" })).toEqual({
      error: "La contraseña debe tener al menos 6 caracteres",
    });
  });

  test("no acepta datos de estudiante en otros roles", () => {
    expect(validateImportRow({ ...base, role: "tecnico", studentGroup: "1°B" })).toEqual({
      error: "Solo los solicitantes tienen datos de estudiante",
    });
  });
});
