import { GraphQLError } from "graphql";

// Catalogo corto de errores de la API. Cada GraphQLError lleva
// `extensions.code` (estable, para que el cliente decida) y `extensions.status`
// (codigo HTTP equivalente). GraphQL responde siempre 200 cuando ejecuto la
// operacion, asi que ahi el status viaja en la extension; en `/api/v1` el mismo
// numero es el codigo HTTP real de la respuesta.
export const ERROR_STATUS = {
  BAD_REQUEST: 400, // pedido mal formado: JSON invalido, variable con tipo equivocado
  UNAUTHENTICATED: 401, // sin token, token vencido, alterado o revocado
  INVALID_CREDENTIALS: 401, // DNI o contrasena incorrectos (mismo mensaje para ambos)
  FORBIDDEN: 403, // autenticado pero sin permiso para esa accion
  NOT_FOUND: 404, // el recurso no existe (o no es visible para quien pregunta)
  CONFLICT: 409, // choca con el estado actual: duplicado, transicion invalida, recurso en uso
  VALIDATION_ERROR: 422, // los datos no cumplen las reglas de negocio
  TOO_MANY_ATTEMPTS: 429, // cuenta o IP bloqueada por intentos de login fallidos
  INTERNAL_ERROR: 500, // error inesperado; el detalle queda en el log, no en la respuesta
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const UNAUTHENTICATED_MESSAGE = "No autenticado";
export const FORBIDDEN_MESSAGE = "No tenés permisos para esta acción";
export const INTERNAL_MESSAGE = "Error interno del servidor";

export function apiError(
  code: ErrorCode,
  message: string,
  extensions: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, { extensions: { ...extensions, code, status: ERROR_STATUS[code] } });
}

export const badRequest = (message: string) => apiError("BAD_REQUEST", message);
export const unauthenticated = (message = UNAUTHENTICATED_MESSAGE) =>
  apiError("UNAUTHENTICATED", message);
export const invalidCredentials = (message = "Credenciales inválidas") =>
  apiError("INVALID_CREDENTIALS", message);
export const forbidden = (message = FORBIDDEN_MESSAGE) => apiError("FORBIDDEN", message);
export const notFound = (message: string) => apiError("NOT_FOUND", message);
export const conflict = (message: string) => apiError("CONFLICT", message);
export const invalid = (message: string) => apiError("VALIDATION_ERROR", message);
export const tooManyAttempts = (message: string, retryAfterSeconds: number) =>
  apiError("TOO_MANY_ATTEMPTS", message, { retryAfterSeconds });
export const internalError = () => apiError("INTERNAL_ERROR", INTERNAL_MESSAGE);

// Codigos de error de PostgreSQL que una escritura puede provocar aunque la capa
// de resolvers haya validado: la restriccion de la base es la ultima defensa.
const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_CHECK_VIOLATION = "23514";
const PG_NOT_NULL_VIOLATION = "23502";

function pgCode(error: unknown): string | undefined {
  // drizzle envuelve el error de `pg` en `cause`; graphql-js lo envuelve en `originalError`
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^\d{5}$/.test(code)) return code;
    current = (current as { cause?: unknown; originalError?: unknown }).cause ??
      (current as { originalError?: unknown }).originalError;
  }
  return undefined;
}

/**
 * Traduce un error inesperado (no GraphQLError del catalogo) a uno del catalogo
 * sin filtrar texto de la base. Las violaciones de restriccion pasan a 409/422;
 * el resto es INTERNAL_ERROR.
 */
export function classifyUnexpected(error: unknown): GraphQLError {
  switch (pgCode(error)) {
    case PG_UNIQUE_VIOLATION:
      return conflict("Ya existe un registro con esos datos");
    case PG_FOREIGN_KEY_VIOLATION:
      return invalid("La operación referencia un registro que no existe o que está en uso");
    case PG_CHECK_VIOLATION:
    case PG_NOT_NULL_VIOLATION:
      return invalid("Alguno de los datos tiene un valor no permitido");
    default:
      return internalError();
  }
}

export function statusOf(error: unknown): number {
  const status = (error as { extensions?: { status?: unknown } } | null)?.extensions?.status;
  return typeof status === "number" ? status : ERROR_STATUS.INTERNAL_ERROR;
}

export function codeOf(error: unknown): ErrorCode {
  const code = (error as { extensions?: { code?: unknown } } | null)?.extensions?.code;
  return typeof code === "string" && code in ERROR_STATUS ? (code as ErrorCode) : "INTERNAL_ERROR";
}
