import { describe, expect, test } from "bun:test";
import { PASSWORD_MIN_LENGTH, SAME_PASSWORD_MESSAGE, validateNewPassword } from "./validation";
import { localDateOnly, todayLocalDate, validateLoan } from "./validation";

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
