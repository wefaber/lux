import { Elysia } from "elysia";
import { GraphQLError, type GraphQLSchema } from "graphql";
import type { Ctx } from "../context";
import { badRequest, notFound } from "../errors";
import { clientIp } from "../net";
import { compileRoutes, errorResult, rawError, runRoute, type CompiledRoute, type RestResult } from "./adapter";
import { ROUTES } from "./routes";

export const REST_PREFIX = "/api/v1";

function toResponse(result: RestResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...result.headers,
    },
  });
}

async function readBody(request: Request): Promise<{ body?: unknown; error?: GraphQLError }> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { error: badRequest("El cuerpo debe ser un objeto JSON") };
    }
    return { body: parsed };
  } catch {
    return { error: badRequest("El cuerpo no es JSON válido") };
  }
}

function matches(pattern: string, path: string): boolean {
  const a = pattern.split("/");
  const b = path.split("/");
  return a.length === b.length && a.every((seg, i) => seg.startsWith(":") || seg === b[i]);
}

export function restPlugin(options: {
  schema: GraphQLSchema;
  createContext: (request: Request, ip: string) => Promise<Ctx>;
}) {
  const compiled: CompiledRoute[] = compileRoutes(options.schema, ROUTES);
  const app = new Elysia({ prefix: REST_PREFIX });

  for (const route of compiled) {
    app.route(route.spec.method, route.spec.path, async ({ request, params, server }) => {
      try {
        let body: unknown;
        if (route.spec.method !== "GET") {
          const read = await readBody(request);
          if (read.error) return toResponse(errorResult(read.error));
          body = read.body;
        }
        const context = await options.createContext(request, clientIp(request, server));
        const result = await runRoute(
          options.schema,
          route,
          { params: (params ?? {}) as Record<string, string>, query: new URL(request.url).searchParams, body },
          context,
        );
        return toResponse(result);
      } catch (error) {
        // Fuera del catalogo (caida de la base al armar el contexto): 500 enmascarado
        return toResponse(errorResult(new GraphQLError("Error", { originalError: error as Error })));
      }
    });
  }

  // Ruta inexistente (404) o metodo que esa ruta no admite (405 + Allow)
  app.all("/*", ({ request }) => {
    const path = new URL(request.url).pathname.slice(REST_PREFIX.length) || "/";
    const allowed = compiled.filter((r) => matches(r.spec.path, path)).map((r) => r.spec.method);
    if (allowed.length > 0) {
      return toResponse(
        rawError(405, "BAD_REQUEST", `Método no permitido: ${request.method}`, {
          Allow: [...new Set(allowed)].join(", "),
        }),
      );
    }
    return toResponse(errorResult(notFound("La ruta no existe")));
  });

  return app;
}
