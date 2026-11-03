import { describe, expect, test } from "bun:test";
import { PASSWORD_MIN_LENGTH, SAME_PASSWORD_MESSAGE, validateNewPassword } from "./validation";
import {
  localDateOnly,
  todayLocalDate,
  validateEquipmentNote,
  validateIncidentTemplate,
  validateLoan,
  validateTicket,
} from "./validation";

// Cambiar la contrasena desde el perfil no necesita Postgres para probarse:
// la regla (politica de largo + no repetir la actual) es pura. El resolver la
// aplica despues de verificar la actual con argon2.
describe("contraseña nueva", () => {
  test("no se puede repetir la contraseña actual", () => {
    expect(validateNewPassword("actual2026", "actual2026")).toBe(SAME_PASSWORD_MESSAGE);
  });

  test("distingue mayúsculas, espacios y variantes: solo la cadena exacta es la misma", () => {
    expect(validateNewPassword("Actual2026", "actual2026")).toBeNull();
    expect(validateNewPassword("actual 2026", "actual2026")).toBeNull();
    expect(validateNewPassword("actual2026 ", "actual2026")).toBeNull();
  });

  test("aplica la politica de largo del proyecto", () => {
    expect(validateNewPassword("actual2026", "a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`,
    );
    expect(validateNewPassword("actual2026", "a".repeat(129))).toBe(
      "La contraseña no puede superar los 128 caracteres",
    );
  });

  test("una contraseña nueva válida pasa", () => {
    expect(validateNewPassword("actual2026", "nueva2026")).toBeNull();
  });
});

// 21 de octubre de 2026, 22:30 hora local (la hora en la que toISOString()
// ya devuelve el día siguiente en Uruguay)
const now = new Date(2026, 9, 21, 22, 30);

describe("validateLoan", () => {
  test("acepta la entrega de hoy aunque sea de noche", () => {
    expect(
      validateLoan({ issueDate: "2026-10-21T23:00", returnDate: "2026-10-22T08:00" }, now),
    ).toEqual({});
  });

  test("rechaza la entrega de ayer", () => {
    expect(
      validateLoan({ issueDate: "2026-10-20T23:00", returnDate: "2026-10-22T08:00" }, now),
    ).toEqual({ issueDate: "La fecha de entrega no puede ser anterior a hoy" });
  });

  test("rechaza una devolución anterior a la entrega", () => {
    expect(
      validateLoan({ issueDate: "2026-10-22T10:00", returnDate: "2026-10-21T10:00" }, now),
    ).toEqual({ returnDate: "La devolución no puede ser anterior a la entrega" });
  });

  test("el mismo día, la devolución tiene que ser posterior en hora", () => {
    expect(
      validateLoan({ issueDate: "2026-10-22T10:00", returnDate: "2026-10-22T09:00" }, now),
    ).toEqual({ returnDate: "La fecha de devolución debe ser posterior a la de entrega" });
    expect(
      validateLoan({ issueDate: "2026-10-22T10:00", returnDate: "2026-10-22T11:00" }, now),
    ).toEqual({});
  });

  test("rechaza fechas inválidas", () => {
    expect(validateLoan({ issueDate: "", returnDate: "2026-10-22T08:00" }, now)).toEqual({
      issueDate: "Fecha de entrega inválida",
    });
    expect(validateLoan({ issueDate: "2026-02-30T10:00", returnDate: "ayer" }, now)).toEqual({
      issueDate: "Fecha de entrega inválida",
      returnDate: "Fecha de devolución inválida",
    });
  });

  test("el día se lee tal cual, sin pasar por UTC", () => {
    expect(localDateOnly("2026-10-21T23:30")).toBe("2026-10-21");
    expect(localDateOnly("2026-10-21T23:30:00.000Z")).toBe("2026-10-21");
    expect(localDateOnly("sin fecha")).toBeNull();
    expect(todayLocalDate(new Date(2026, 9, 21, 23, 59))).toBe("2026-10-21");
  });
});

describe("validateTicket", () => {
  const ok = {
    title: "Proyector sin imagen",
    description: "No enciende desde ayer",
    category: "hardware",
    priority: "medium",
  };

  test("acepta un ticket completo", () => {
    expect(validateTicket(ok)).toEqual({});
  });

  test("título de 3 a 120 y descripción de 5 a 2000 caracteres, sin contar espacios de los bordes", () => {
    expect(validateTicket({ ...ok, title: "  ab  " }).title).toBe("Título: mínimo 3 caracteres");
    expect(validateTicket({ ...ok, title: "a".repeat(121) }).title).toBe(
      "Título: máximo 120 caracteres",
    );
    expect(validateTicket({ ...ok, description: "1234" }).description).toBe(
      "Descripción: mínimo 5 caracteres",
    );
    expect(validateTicket({ ...ok, description: "a".repeat(2001) }).description).toBe(
      "Descripción: máximo 2000 caracteres",
    );
    expect(
      validateTicket({ ...ok, title: "a".repeat(120), description: "a".repeat(2000) }),
    ).toEqual({});
  });

  test("categoría y prioridad tienen que ser de la lista", () => {
    expect(validateTicket({ ...ok, category: "magia" }).category).toBe(
      "Elegí una categoría válida",
    );
    expect(validateTicket({ ...ok, priority: "urgente" }).priority).toBe(
      "Elegí una prioridad válida",
    );
    for (const priority of ["low", "medium", "high", "critical"]) {
      expect(validateTicket({ ...ok, priority })).toEqual({});
    }
  });
});

describe("validateIncidentTemplate", () => {
  const ok = {
    name: "Sin red",
    category: "network",
    priority: "high",
    title: "Equipo sin conexión",
    description: "No obtiene IP por DHCP",
  };

  test("acepta una plantilla completa", () => {
    expect(validateIncidentTemplate(ok)).toEqual({});
  });

  test("nombre de 3 a 80 caracteres", () => {
    expect(validateIncidentTemplate({ ...ok, name: "ab" }).name).toBe(
      "Nombre: mínimo 3 caracteres",
    );
    expect(validateIncidentTemplate({ ...ok, name: "a".repeat(81) }).name).toBe(
      "Nombre: máximo 80 caracteres",
    );
  });

  test("hereda las reglas de título, descripción, categoría y prioridad", () => {
    const errors = validateIncidentTemplate({
      name: "Sin red",
      category: "x",
      priority: "y",
      title: "a",
      description: "b",
    });
    expect(Object.keys(errors).sort()).toEqual(["category", "description", "priority", "title"]);
  });
});

describe("validateEquipmentNote", () => {
  test("ni vacía ni de más de 2000 caracteres", () => {
    expect(validateEquipmentNote("   ")).toBe("La nota no puede estar vacía");
    expect(validateEquipmentNote("a".repeat(2001))).toBe(
      "La nota no puede superar los 2000 caracteres",
    );
    expect(validateEquipmentNote("a")).toBeNull();
    expect(validateEquipmentNote("a".repeat(2000))).toBeNull();
  });
});
