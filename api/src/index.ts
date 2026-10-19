import { Elysia } from "elysia";
import { createSchema, createYoga } from "graphql-yoga";
import { bearerFrom, verifyToken } from "./auth";
import { pool } from "./db/client";
import { loadEnv, serverHost, serverPort } from "./env";
import { resolvers } from "./graphql/resolvers";
import { typeDefs } from "./graphql/schema";
import { loadState } from "./state";

loadEnv();

const schema = createSchema({ typeDefs, resolvers });

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  graphiql: true,
  // El frontend manda el JWT en `Authorization: Bearer`; el token identifica al
  // usuario y de aca sale `caller` para las reglas de permisos.
  context: async ({ request }) => {
    const token = bearerFrom(request.headers.get("authorization"));
    const payload = token ? await verifyToken(token) : null;
    const state = await loadState();
    const found = payload ? (state.usersById.get(payload.sub) ?? null) : null;
    return { state, caller: found && found.isActive ? found : null };
  },
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
];

async function readiness(): Promise<{ ok: boolean; missing?: string[]; error?: string }> {
  try {
    await pool.query("select 1");
    const result = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const present = new Set(result.rows.map((r) => r.table_name));
    const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
    return missing.length > 0 ? { ok: false, missing } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const app = new Elysia()
  .get("/health", () => ({ status: "ok" }))
  .get("/ready", async ({ set }) => {
    const result = await readiness();
    if (!result.ok) set.status = 503;
    return { status: result.ok ? "ready" : "not-ready", ...result };
  })
  .all("/graphql", ({ request }) => yoga.fetch(request));

app.listen({ hostname: serverHost(), port: serverPort() });

console.log(`Lux API escuchando en http://${serverHost()}:${serverPort()}/graphql`);
