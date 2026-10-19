import { Elysia } from "elysia";
import { createSchema } from "graphql-yoga";
import { createContext } from "./context";
import { corsPlugin } from "./cors";
import { pool } from "./db/client";
import { restPlugin } from "./rest/plugin";
import { loadEnv, serverHost, serverPort } from "./env";
import { clientIp } from "./net";
import { resolvers } from "./graphql/resolvers";
import { createGraphqlServer } from "./graphql/server";
import { typeDefs } from "./graphql/schema";

loadEnv();

const schema = createSchema({ typeDefs, resolvers });

const yoga = createGraphqlServer({
  schema,
  production: process.env.NODE_ENV === "production",
  createContext,
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
  .use(corsPlugin())
  .get("/health", () => ({ status: "ok" }))
  .get("/ready", async ({ set }) => {
    // El detalle (tablas faltantes, texto de la base) queda en el log del servidor:
    // /ready no requiere autenticacion y no debe describir la infraestructura.
    const ok = await readiness();
    if (!ok) set.status = 503;
    return { status: ok ? "ready" : "not-ready", ok };
  })
  .use(restPlugin({ schema, createContext: (request, ip) => createContext(request, ip) }))
  .all("/graphql", ({ request, server }) =>
    yoga.fetch(request, { ip: clientIp(request, server) }),
  );

app.listen({ hostname: serverHost(), port: serverPort(), maxRequestBodySize: 1024 * 1024 });

console.log(`Lux API escuchando en http://${serverHost()}:${serverPort()}/graphql`);
