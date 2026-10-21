import { NoSchemaIntrospectionCustomRule, type GraphQLSchema } from "graphql";
import { createYoga, type Plugin } from "graphql-yoga";
import type { Ctx } from "../context";
import { classifyUnexpected, ERROR_STATUS, isCatalogError } from "../errors";
import { graphqlMaxDepth, graphqlMaxRootFields } from "../env";
import { operationLimitsRule } from "./limits";

// Configuracion del servidor GraphQL. Vive aparte de index.ts (que abre el puerto
// y la base) para poder probarla: errores con codigo, enmascarado de errores
// inesperados y cierre de GraphiQL/introspeccion en produccion.

// Los errores de graphql-js que no salen de un resolver (query mal formada,
// variable con tipo equivocado) no traen un codigo del catalogo: se completan
// con BAD_REQUEST (el codigo original de graphql-js queda en `reason`) para que
// todo error de la API tenga `code` y `status`.
function addMissingCodes(result: unknown): void {
  const results = Array.isArray(result) ? result : [result];
  for (const entry of results) {
    const errors = (entry as { errors?: Array<{ extensions?: Record<string, unknown> }> } | null)
      ?.errors;
    for (const error of errors ?? []) {
      const current = error.extensions?.code;
      if (typeof current === "string" && current in ERROR_STATUS) continue;
      error.extensions = {
        ...error.extensions,
        ...(current ? { reason: current } : {}),
        code: "BAD_REQUEST",
        status: ERROR_STATUS.BAD_REQUEST,
      };
    }
  }
}

const errorCodes: Plugin = {
  onResultProcess({ result }) {
    addMissingCodes(result);
  },
};

export interface ServerOptions {
  schema: GraphQLSchema;
  /** En produccion no se sirve GraphiQL ni se permite introspeccion. */
  production: boolean;
  createContext: (request: Request, ip: string) => Promise<Ctx> | Ctx;
}

export function createGraphqlServer({ schema, production, createContext }: ServerOptions) {
  // La superficie que ve un atacante es solo la de las operaciones que el cliente ya conoce.
  const hardening: Plugin = {
    onValidate({ addValidationRule }) {
      addValidationRule(
        operationLimitsRule({
          maxDepth: graphqlMaxDepth(),
          maxRootFields: graphqlMaxRootFields(),
          maxRepeatedRootField: 3,
        }),
      );
      if (production) addValidationRule(NoSchemaIntrospectionCustomRule);
    },
  };

  return createYoga<{ ip: string }>({
    schema,
    graphqlEndpoint: "/graphql",
    graphiql: !production,
    // CORS lo resuelve src/cors.ts con lista de origenes; Yoga por defecto refleja cualquiera
    cors: false,
    plugins: [errorCodes, hardening],
    // Un error que no es del catalogo (bug, caida de la base) no devuelve su texto
    // al cliente: Yoga lo loguea completo en el servidor y sale como INTERNAL_ERROR.
    maskedErrors: {
      maskError(error) {
        if (isCatalogError(error)) return error as Error;
        return classifyUnexpected((error as { originalError?: unknown }).originalError ?? error);
      },
    },
    // El frontend manda el JWT en `Authorization: Bearer`; el token identifica al
    // usuario y de aca sale `caller` para las reglas de permisos.
    context: ({ request, ip }) => createContext(request, ip),
  });
}
