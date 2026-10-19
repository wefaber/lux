import { describe, expect, test } from "bun:test";
import { GraphQLError } from "graphql";
import {
  classifyUnexpected,
  codeOf,
  conflict,
  ERROR_STATUS,
  forbidden,
  internalError,
  invalid,
  notFound,
  statusOf,
  tooManyAttempts,
  unauthenticated,
} from "./errors";

describe("catalogo de errores", () => {
  test("cada helper lleva code y status coherentes", () => {
    const cases = [
      [unauthenticated(), "UNAUTHENTICATED", 401],
      [forbidden(), "FORBIDDEN", 403],
      [notFound("x"), "NOT_FOUND", 404],
      [conflict("x"), "CONFLICT", 409],
      [invalid("x"), "VALIDATION_ERROR", 422],
      [tooManyAttempts("x", 30), "TOO_MANY_ATTEMPTS", 429],
      [internalError(), "INTERNAL_ERROR", 500],
    ] as const;
    for (const [error, code, status] of cases) {
      expect(error).toBeInstanceOf(GraphQLError);
      expect(error.extensions.code).toBe(code);
      expect(error.extensions.status).toBe(status);
      expect(ERROR_STATUS[code]).toBe(status);
    }
  });

  test("conserva los mensajes en castellano que consume el frontend", () => {
    expect(unauthenticated().message).toBe("No autenticado");
    expect(forbidden().message).toBe("No tenés permisos para esta acción");
  });

  test("tooManyAttempts informa cuanto esperar", () => {
    expect(tooManyAttempts("bloqueado", 90).extensions.retryAfterSeconds).toBe(90);
  });

  test("codeOf y statusOf degradan a INTERNAL_ERROR ante algo desconocido", () => {
    expect(codeOf(new Error("boom"))).toBe("INTERNAL_ERROR");
    expect(statusOf(new Error("boom"))).toBe(500);
    expect(statusOf(conflict("x"))).toBe(409);
  });
});

describe("classifyUnexpected", () => {
  const pgError = (code: string) => Object.assign(new Error("detalle interno de la base"), { code });

  test("traduce violaciones de restriccion de PostgreSQL", () => {
    expect(classifyUnexpected(pgError("23505")).extensions.code).toBe("CONFLICT");
    expect(classifyUnexpected(pgError("23503")).extensions.code).toBe("VALIDATION_ERROR");
    expect(classifyUnexpected(pgError("23514")).extensions.code).toBe("VALIDATION_ERROR");
  });

  test("encuentra el codigo dentro de cause (drizzle) y originalError (graphql-js)", () => {
    const wrapped = new Error("Failed query", { cause: pgError("23505") });
    expect(classifyUnexpected(wrapped).extensions.code).toBe("CONFLICT");
    const located = Object.assign(new Error("x"), { originalError: wrapped });
    expect(classifyUnexpected(located).extensions.code).toBe("CONFLICT");
  });

  test("un error desconocido sale como INTERNAL_ERROR sin filtrar su texto", () => {
    const masked = classifyUnexpected(new Error('password authentication failed for user "lux_app"'));
    expect(masked.extensions.code).toBe("INTERNAL_ERROR");
    expect(masked.extensions.status).toBe(500);
    expect(masked.message).toBe("Error interno del servidor");
    expect(masked.message).not.toContain("lux_app");
  });

  test("los mensajes de las violaciones tampoco incluyen texto de la base", () => {
    for (const code of ["23505", "23503", "23514"]) {
      expect(classifyUnexpected(pgError(code)).message).not.toContain("detalle interno");
    }
  });
});
