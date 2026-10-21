import { describe, expect, test } from "bun:test";
import { PASSWORD_MIN_LENGTH, SAME_PASSWORD_MESSAGE, validateNewPassword } from "./validation";

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
