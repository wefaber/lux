import { describe, expect, test } from "bun:test";
import {
  STUDENT_SUBJECTS_MAX,
  emptyStudent,
  filterUsers,
  isStudentShift,
  normalizeGroup,
  normalizeStudent,
  parseSubjects,
  studentGroups,
  studentSubjects,
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

describe("turnos y grupos", () => {
  test("solo acepta los tres turnos de la institución", () => {
    expect(isStudentShift("matutino")).toBe(true);
    expect(isStudentShift("vespertino")).toBe(true);
    expect(isStudentShift("nocturno")).toBe(true);
    expect(isStudentShift("mañana")).toBe(false);
    expect(isStudentShift("")).toBe(false);
  });

  test("normaliza el grupo y deja null si está vacío", () => {
    expect(normalizeGroup("  1°B  ")).toBe("1°B");
    expect(normalizeGroup("2   A")).toBe("2 A");
    expect(normalizeGroup("   ")).toBeNull();
    expect(normalizeGroup(null)).toBeNull();
  });
});

describe("materias", () => {
  test("separa por coma, punto y coma o barra y limpia espacios", () => {
    expect(parseSubjects("Matemática, Programación;Redes|Base de Datos")).toEqual([
      "Matemática",
      "Programación",
      "Redes",
      "Base de Datos",
    ]);
  });

  test("no repite materias aunque cambien mayúsculas", () => {
    expect(parseSubjects(["Redes", "redes", " REDES ", "Programación"])).toEqual([
      "Redes",
      "Programación",
    ]);
  });

  test("respeta el tope de materias", () => {
    const many = Array.from({ length: STUDENT_SUBJECTS_MAX + 3 }, (_, i) => `Materia ${i}`);
    expect(parseSubjects(many)).toHaveLength(STUDENT_SUBJECTS_MAX);
  });
});

describe("validateStudent", () => {
  test("la ficha vacía es válida", () => {
    expect(validateStudent(emptyStudent())).toEqual({});
  });

  test("acepta grupo, turno y materias coherentes", () => {
    expect(
      validateStudent({
        studentGroup: "2°A",
        studentShift: "vespertino",
        studentSubjects: ["Redes", "Base de Datos"],
      }),
    ).toEqual({});
  });

  test("rechaza un grupo con caracteres raros o demasiado largo", () => {
    expect(
      validateStudent({ studentGroup: "1°B<script>", studentShift: null, studentSubjects: [] })
        .studentGroup,
    ).toBeDefined();
    expect(
      validateStudent({
        studentGroup: "A".repeat(21),
        studentShift: null,
        studentSubjects: [],
      }).studentGroup,
    ).toBeDefined();
  });

  test("rechaza un turno que no existe", () => {
    expect(
      validateStudent({ studentGroup: null, studentShift: "mañana", studentSubjects: [] })
        .studentShift,
    ).toBeDefined();
  });

  test("rechaza materias de una sola letra o demasiado largas", () => {
    expect(
      validateStudent({ studentGroup: null, studentShift: null, studentSubjects: ["A"] })
        .studentSubjects,
    ).toBeDefined();
    expect(
      validateStudent({
        studentGroup: null,
        studentShift: null,
        studentSubjects: ["X".repeat(61)],
      }).studentSubjects,
    ).toBeDefined();
  });
});

describe("normalizeStudent", () => {
  test("solo el solicitante conserva la ficha", () => {
    expect(
      normalizeStudent(
        { studentGroup: "1°B", studentShift: "matutino", studentSubjects: ["Redes"] },
        "solicitante",
      ),
    ).toEqual({ studentGroup: "1°B", studentShift: "matutino", studentSubjects: ["Redes"] });
    expect(
      normalizeStudent(
        { studentGroup: "1°B", studentShift: "matutino", studentSubjects: ["Redes"] },
        "admin",
      ),
    ).toEqual(emptyStudent());
  });

  test("un turno desconocido se guarda como sin turno", () => {
    expect(
      normalizeStudent({ studentShift: "mañana", studentGroup: null, studentSubjects: [] }, "solicitante")
        .studentShift,
    ).toBeNull();
  });
});

describe("filtros de usuarios", () => {
  const users = [
    user(),
    user({
      id: "u-2",
      name: "Carlos Suárez",
      dni: "78901234",
      email: "csuarez@iti.edu.uy",
      studentGroup: "2°A",
      studentShift: "nocturno",
      studentSubjects: ["Redes"],
    }),
    user({
      id: "u-3",
      name: "Marcela Rodríguez",
      dni: "12345678",
      email: "mrodriguez@iti.edu.uy",
      role: "admin",
      studentGroup: null,
      studentShift: null,
      studentSubjects: [],
    }),
  ];

  test("busca por nombre, cédula o email sin distinguir mayúsculas", () => {
    expect(filterUsers(users, { search: "ANA" }).map((u) => u.id)).toEqual(["u-1"]);
    expect(filterUsers(users, { search: "csuarez" }).map((u) => u.id)).toEqual(["u-2"]);
    expect(filterUsers(users, { search: "MRODRIGUEZ" }).map((u) => u.id)).toEqual(["u-3"]);
  });

  test("filtra por grupo, turno y materia", () => {
    expect(filterUsers(users, { group: "1°b" }).map((u) => u.id)).toEqual(["u-1"]);
    expect(filterUsers(users, { shift: "nocturno" }).map((u) => u.id)).toEqual(["u-2"]);
    expect(filterUsers(users, { subject: "redes" }).map((u) => u.id)).toEqual(["u-2"]);
    expect(filterUsers(users, { subject: "Programación" }).map((u) => u.id)).toEqual(["u-1"]);
  });

  test("combina filtros y rol", () => {
    expect(filterUsers(users, { role: "solicitante", shift: "matutino" }).map((u) => u.id)).toEqual([
      "u-1",
    ]);
    expect(filterUsers(users, { role: "admin", subject: "Redes" })).toEqual([]);
    expect(filterUsers(users, { group: "3°C" })).toEqual([]);
  });

  test("arma las opciones de los desplegables sin repetir", () => {
    expect(studentGroups(users)).toEqual(["1°B", "2°A"]);
    expect(studentSubjects(users)).toEqual(["Matemática", "Programación", "Redes"]);
  });
});
