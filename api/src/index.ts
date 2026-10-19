import { Elysia } from "elysia";
import { GraphQLError, NoSchemaIntrospectionCustomRule } from "graphql";
import { createSchema, createYoga, type Plugin } from "graphql-yoga";
import { createContext } from "./context";
import { pool } from "./db/client";
import { loadEnv, serverHost, serverPort } from "./env";
import { clientIp } from "./net";
import { classifyUnexpected, ERROR_STATUS } from "./errors";
import { resolvers } from "./graphql/resolvers";
import { typeDefs } from "./graphql/schema";

loadEnv();

const schema = createSchema({ typeDefs, resolvers });

// En produccion no se sirve GraphiQL ni se permite introspeccion: la superficie
// que ve un atacante es solo la de las operaciones que el cliente ya conoce.
const isProduction = process.env.NODE_ENV === "production";

// Los errores de graphql-js que no salen de un resolver (query mal formada,
// variable con tipo equivocado) no traen un codigo del catalogo: se completan
// con BAD_REQUEST (el codigo original de graphql-js queda en `reason`) para que todo error de la API tenga `code` y `status`.
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

// Un GraphQLError lanzado a proposito por un resolver (cadena de originalError
// compuesta solo por GraphQLError) es un error del catalogo y sale tal cual.
function isCatalogError(error: unknown): boolean {
  if (!(error instanceof GraphQLError)) return false;
  return error.originalError ? isCatalogError(error.originalError) : true;
}

const errorCodes: Plugin = {
  onResultProcess({ result }) {
    addMissingCodes(result);
  },
};

const hardening: Plugin = {
  onValidate({ addValidationRule }) {
    if (isProduction) addValidationRule(NoSchemaIntrospectionCustomRule);
  },
};

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  graphiql: !isProduction,
  plugins: [errorCodes, hardening],
  // Un error que no es del catalogo (bug, caida de la base) no devuelve su texto
  // al cliente: se loguea completo en el servidor y sale como INTERNAL_ERROR.
  maskedErrors: {
    maskError(error) {
      if (isCatalogError(error)) return error as Error;
      // Yoga ya loguea el error original; aca solo se decide que ve el cliente.
      return classifyUnexpected((error as { originalError?: unknown }).originalError ?? error);
    },
  },
  // El frontend manda el JWT en `Authorization: Bearer`; el token identifica al
  // usuario y de aca sale `caller` para las reglas de permisos.
  context: ({ request, ip }: { request: Request; ip: string }) => createContext(request, ip),
});

// Tablas que tienen que existir para que /ready de 200: si faltan, no se aplicaron
// las migraciones y el deploy blue/green no debe mover el trafico al slot.
const REQUIRED_TABLES = [
  "users",
  "locations",
  "products",
  "components",
  "tickets",
  "loans",
  "loan_components",
  "service_requests",
  "interventions",
  "comments",
  "reservations",
  "notices",
  "pending_seen",
  "activity_logs",
  "revoked_tokens",
];

async function readiness(): Promise<boolean> {
  try {
    await pool.query("select 1");
    const result = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const present = new Set(result.rows.map((r) => r.table_name));
    const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
    if (missing.length > 0) {
      console.error(`[ready] faltan tablas (migraciones sin aplicar): ${missing.join(", ")}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[ready] la base no responde:", error);
    return false;
  }
}

const app = new Elysia()
  .get("/health", () => ({ status: "ok" }))
  .get("/ready", async ({ set }) => {
    // El detalle (tablas faltantes, texto de la base) queda en el log del servidor:
    // /ready no requiere autenticacion y no debe describir la infraestructura.
    const ok = await readiness();
    if (!ok) set.status = 503;
    return { status: ok ? "ready" : "not-ready", ok };
  })
  .all("/graphql", ({ request, server }) =>
    yoga.fetch(request, { ip: clientIp(request, server) }),
  );

app.listen({ hostname: serverHost(), port: serverPort() });

console.log(`Lux API escuchando en http://${serverHost()}:${serverPort()}/graphql`);
