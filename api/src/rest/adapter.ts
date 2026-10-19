import {
  execute,
  GraphQLError,
  getNamedType,
  isEnumType,
  isInputObjectType,
  isObjectType,
  isScalarType,
  parse,
  type DocumentNode,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLOutputType,
  type GraphQLSchema,
} from "graphql";
import {
  badRequest,
  describeError,
  notFound,
  unauthenticated,
  type ErrorCode,
} from "../errors";

// Adaptador REST sobre el esquema GraphQL. No tiene reglas de negocio: cada ruta
// se compila a UNA operacion del esquema y se ejecuta con `execute()` contra los
// mismos resolvers (y por lo tanto los mismos permisos, validaciones, transaccion
// y auditoria) que /graphql. El documento y su selection set salen del propio
// esquema, asi que una ruta no puede divergir del contrato GraphQL.

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RouteSpec {
  method: HttpMethod;
  /** Relativa a /api/v1, con `:param` para segmentos variables. */
  path: string;
  /** Campo raiz de Query o Mutation que ejecuta. */
  operation: string;
  /** Respuesta 201 en lugar de 200 (altas). */
  created?: boolean;
  /** Si la operacion devuelve null: 404 (por defecto) o 401 (`me`). */
  nullAs?: "NOT_FOUND" | "UNAUTHENTICATED";
  /** Mensaje de exito; por defecto el del metodo. */
  message?: string;
  /** `data` cuando la operacion devuelve `true` (bajas, logout...). */
  flagData?: (params: Record<string, string>) => unknown;
}

/** Contrato de toda respuesta de /api/v1: `status`, `message` y `data`. */
export interface Envelope {
  status: number;
  message: string;
  data: unknown;
  /** Solo en errores: codigo del catalogo (ver docs/BACKEND.md). */
  code?: ErrorCode;
}

export interface RestResult {
  status: number;
  body: Envelope;
  headers?: Record<string, string>;
}

export interface CompiledRoute {
  spec: RouteSpec;
  document: DocumentNode;
  field: GraphQLField<unknown, unknown>;
}

const DEFAULT_MESSAGE: Record<HttpMethod, string> = {
  GET: "OK",
  POST: "Operación realizada",
  PUT: "Actualizado",
  DELETE: "Eliminado",
};

// Cuantos niveles de objetos anidados se incluyen (Ticket -> equipment -> components).
const SELECTION_DEPTH = 2;

function selectionFor(type: GraphQLOutputType, depth: number): string {
  const named = getNamedType(type);
  if (!isObjectType(named)) return "";
  const parts: string[] = [];
  for (const field of Object.values(named.getFields())) {
    const inner = getNamedType(field.type);
    if (isScalarType(inner) || isEnumType(inner)) parts.push(field.name);
    else if (isObjectType(inner) && depth > 0) {
      parts.push(`${field.name} ${selectionFor(field.type, depth - 1)}`);
    }
  }
  return `{ ${parts.join(" ")} }`;
}

export function compileRoutes(schema: GraphQLSchema, routes: RouteSpec[]): CompiledRoute[] {
  const queries = schema.getQueryType()?.getFields() ?? {};
  const mutations = schema.getMutationType()?.getFields() ?? {};
  return routes.map((spec) => {
    // GET ejecuta una Query; el resto, una Mutation. Unica excepcion: `login` es
    // una Query del esquema (el frontend la consume asi) pero se expone como POST.
    const fromMutation = spec.method !== "GET" ? mutations[spec.operation] : undefined;
    const fromQuery =
      spec.method === "GET" || spec.operation === "login" ? queries[spec.operation] : undefined;
    const field = fromMutation ?? fromQuery;
    if (!field) {
      throw new Error(`La ruta ${spec.method} ${spec.path} apunta a una operacion que no corresponde a ese metodo: ${spec.operation}`);
    }
    const kind = fromMutation ? "mutation" : "query";
    const defs = field.args.map((a) => `$${a.name}: ${a.type}`).join(", ");
    const uses = field.args.map((a) => `${a.name}: $${a.name}`).join(", ");
    const selection = selectionFor(field.type, SELECTION_DEPTH);
    const source = `${kind} Rest${spec.operation}${defs ? `(${defs})` : ""} { ${spec.operation}${uses ? `(${uses})` : ""} ${selection} }`;
    return { spec, document: parse(source), field };
  });
}

function coerceQueryValue(arg: GraphQLArgument, raw: string): unknown {
  const named = getNamedType(arg.type).name;
  if (named === "Boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw badRequest(`El parámetro ${arg.name} debe ser true o false`);
  }
  if (named === "Int" || named === "Float") {
    const value = Number(raw);
    if (raw.trim() === "" || Number.isNaN(value)) throw badRequest(`El parámetro ${arg.name} debe ser un número`);
    return value;
  }
  return raw;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Arma las variables de la operacion: un argumento sale del path (`:id`), del
 * cuerpo (`input` es el cuerpo entero; los demas, un campo del cuerpo) o de la
 * query string, en ese orden.
 */
export function buildVariables(
  field: GraphQLField<unknown, unknown>,
  input: { params: Record<string, string>; query: URLSearchParams; body: unknown },
): Record<string, unknown> {
  const variables: Record<string, unknown> = {};
  for (const arg of field.args) {
    let value: unknown;
    if (input.params[arg.name] !== undefined) value = input.params[arg.name];
    else if (arg.name === "input" && isInputObjectType(getNamedType(arg.type))) value = input.body;
    else if (isPlainObject(input.body) && arg.name in input.body) value = input.body[arg.name];
    else if (input.query.has(arg.name)) value = coerceQueryValue(arg, input.query.get(arg.name)!);
    if (value !== undefined) variables[arg.name] = value;
  }
  return variables;
}

function failure(error: GraphQLError): RestResult {
  const described = describeError(error);
  return {
    status: described.status,
    body: { status: described.status, message: described.message, data: null, code: described.code },
    ...(described.retryAfterSeconds ? { headers: { "Retry-After": String(described.retryAfterSeconds) } } : {}),
  };
}

export function errorResult(error: GraphQLError): RestResult {
  return failure(error);
}

/** Respuesta de error con un status que no sale de un GraphQLError (405). */
export function rawError(status: number, code: ErrorCode, message: string, headers?: Record<string, string>): RestResult {
  return { status, body: { status, message, data: null, code }, ...(headers ? { headers } : {}) };
}

export async function runRoute(
  schema: GraphQLSchema,
  route: CompiledRoute,
  input: { params: Record<string, string>; query: URLSearchParams; body: unknown },
  contextValue: unknown,
): Promise<RestResult> {
  const { spec } = route;
  let variables: Record<string, unknown>;
  try {
    variables = buildVariables(route.field, input);
  } catch (error) {
    return failure(error as GraphQLError);
  }

  const result = await execute({
    schema,
    document: route.document,
    variableValues: variables,
    contextValue,
  });

  const firstError = result.errors?.[0];
  if (firstError) return failure(firstError);

  const value = (result.data as Record<string, unknown> | null | undefined)?.[spec.operation];
  if (value === null || value === undefined) {
    return failure(
      spec.nullAs === "UNAUTHENTICATED" ? unauthenticated() : notFound("No encontrado"),
    );
  }

  const status = spec.created ? 201 : 200;
  const data = value === true ? (spec.flagData?.(input.params) ?? { ok: true }) : value;
  return {
    status,
    body: { status, message: spec.message ?? (spec.created ? "Creado" : DEFAULT_MESSAGE[spec.method]), data },
  };
}
