import { describe, expect, test } from "bun:test";
import {
  buildBrowserReport,
  fingerprintOf,
  isExpectedError,
  sanitizeErrorText,
} from "./error-fingerprint";
import { ApiError, MocksUnavailableError } from "./utils";

describe("huella estable de errores", () => {
  const stack =
    "TypeError: boom\n    at Inventario (http://localhost:5173/src/features/inventory/InventoryPage.tsx:84:21)";

  test("el mismo error da la misma huella", () => {
    expect(fingerprintOf("TypeError: boom", stack)).toBe(fingerprintOf("TypeError: boom", stack));
    // El origen del dev server y los saltos de linea no cambian la huella
    const otherOrigin = stack.replace("http://localhost:5173", "https://lux.eternum.lat");
    expect(fingerprintOf("TypeError: boom", otherOrigin)).toBe(fingerprintOf("TypeError: boom", stack));
    expect(fingerprintOf("TypeError: boom", stack.replaceAll("\n", "\r\n"))).toBe(
      fingerprintOf("TypeError: boom", stack),
    );
  });

  test("distinto stack o distinto mensaje dan huellas distintas", () => {
    const otherStack = stack.replace("InventoryPage.tsx:84:21", "TicketList.tsx:31:7");
    expect(fingerprintOf("TypeError: boom", otherStack)).not.toBe(
      fingerprintOf("TypeError: boom", stack),
    );
    expect(fingerprintOf("RangeError: boom", stack)).not.toBe(
      fingerprintOf("TypeError: boom", stack),
    );
  });

  test("la huella es hexadecimal y estable en longitud", () => {
    expect(fingerprintOf("x")).toMatch(/^[a-f0-9]{16}$/);
    expect(fingerprintOf("otro error", "stack")).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("saneo antes de mandar el reporte", () => {
  test("no guarda tokens, contrasenas ni correos", () => {
    const text = sanitizeErrorText(
      'POST falló: {"password":"secreto123","token":"tok_abc"} ana@escuela.edu.uy Bearer eyJhbGc.eyJzdWIi.firma',
      1000,
    );
    expect(text).not.toContain("secreto123");
    expect(text).not.toContain("tok_abc");
    expect(text).not.toContain("ana@escuela.edu.uy");
    expect(text).not.toContain("eyJhbGc");
    expect(text).toContain("<redacted>");
    expect(text).toContain("<token>");
    expect(text).toContain("<email>");
  });

  test("el payload no incluye el cuerpo del formulario ni datos personales", () => {
    const error = new Error('No se pudo guardar password="hunter2"');
    error.stack = "Error: x\n    at Guardar (src/features/profile/ProfilePage.tsx:20:3)";
    const payload = buildBrowserReport(error, {
      route: "/dashboard/profile",
      role: "solicitante",
      userAgent: "Mozilla/5.0 ana@escuela.edu.uy",
    });
    expect(payload.message).not.toContain("hunter2");
    expect(payload.userAgent).not.toContain("ana@escuela.edu.uy");
    expect(payload.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(payload.role).toBe("solicitante");
    expect(payload.route).toBe("/dashboard/profile");
  });
});

describe("que errores no se reportan", () => {
  test("validacion, permisos y red esperados quedan afuera", () => {
    expect(isExpectedError(new ApiError("Datos inválidos", "VALIDATION_ERROR"))).toBe(true);
    expect(isExpectedError(new ApiError("No tenés permisos", "FORBIDDEN"))).toBe(true);
    expect(isExpectedError(new ApiError("No autenticado", "UNAUTHENTICATED"))).toBe(true);
    expect(isExpectedError(new MocksUnavailableError(405))).toBe(true);
    expect(isExpectedError(new TypeError("Failed to fetch"))).toBe(true);
  });

  test("un error interno o desconocido si se reporta", () => {
    expect(isExpectedError(new ApiError("Error interno del servidor", "INTERNAL_ERROR"))).toBe(false);
    expect(isExpectedError(new Error("Cannot read properties of undefined"))).toBe(false);
  });
});
