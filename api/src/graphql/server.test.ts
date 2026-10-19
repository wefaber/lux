import { describe, expect, spyOn, test } from "bun:test";
import { createSchema } from "graphql-yoga";
import type { Ctx } from "../context";
import { forbidden } from "../errors";
import { createGraphqlServer } from "./server";

const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type Query {
      ok: String!
      denied: String
      boom: String
      duplicate: String
      secret: String
    }
  `,
  resolvers: {
    Query: {
      ok: () => "ok",
      denied: () => {
        throw forbidden();
      },
      boom: () => {
        throw new Error('password authentication failed for user "lux_app" (host db.interno)');
      },
      duplicate: () => {
        throw Object.assign(new Error('duplicate key value violates unique constraint "users_dni_unique"'), { code: "23505" });
      },
    },
  },
});

const ctx = (): Ctx => ({ state: undefined as never, caller: null, ip: "test", token: null });
const server = (production: boolean) => createGraphqlServer({ schema, production, createContext: ctx });

async function run(production: boolean, query: string) {
  const res = await server(production).fetch("http://api/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  }, { ip: "test" });
  return (await res.json()) as { data?: unknown; errors?: Array<{ message: string; extensions: Record<string, unknown> }> };
}

describe("servidor GraphQL", () => {
  test("un error del catalogo conserva mensaje, code y status", async () => {
    const body = await run(true, "{ denied }");
    expect(body.errors?.[0]).toMatchObject({
      message: "No tenés permisos para esta acción",
      extensions: { code: "FORBIDDEN", status: 403 },
    });
  });

  test("un error inesperado sale enmascarado, sin el texto de la base", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const body = await run(true, "{ boom }");
    log.mockRestore();
    expect(body.errors?.[0]?.message).toBe("Error interno del servidor");
    expect(body.errors?.[0]?.extensions).toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
    expect(JSON.stringify(body)).not.toContain("lux_app");
  });

  test("una violacion de UNIQUE se traduce a CONFLICT sin nombrar la restriccion", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    const body = await run(true, "{ duplicate }");
    log.mockRestore();
    expect(body.errors?.[0]?.extensions).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(JSON.stringify(body)).not.toContain("users_dni_unique");
  });

  test("una query invalida lleva BAD_REQUEST y conserva el motivo de graphql-js", async () => {
    const body = await run(false, "{ noExiste }");
    expect(body.errors?.[0]?.extensions).toMatchObject({ code: "BAD_REQUEST", status: 400, reason: "GRAPHQL_VALIDATION_FAILED" });
  });

  test("en produccion no hay GraphiQL ni introspeccion", async () => {
    const html = await server(true).fetch("http://api/graphql", { headers: { accept: "text/html" } }, { ip: "test" });
    expect(html.headers.get("content-type") ?? "").not.toContain("text/html");
    const body = await run(true, "{ __schema { types { name } } }");
    expect(body.errors?.[0]?.message).toContain("introspection has been disabled");
  });

  test("fuera de produccion sirve GraphiQL e introspeccion", async () => {
    const html = await server(false).fetch("http://api/graphql", { headers: { accept: "text/html" } }, { ip: "test" });
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    const body = await run(false, "{ __schema { queryType { name } } }");
    expect(body.errors).toBeUndefined();
  });
});
