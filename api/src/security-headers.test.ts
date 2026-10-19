import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { corsPlugin } from "./cors";
import { securityHeadersPlugin } from "./security-headers";

const build = (production: boolean, hsts: boolean) =>
  new Elysia()
    .use(securityHeadersPlugin(production, () => hsts))
    .use(corsPlugin(() => ["https://lux.eternum.lat"]))
    .all("/graphql", () => new Response("{}", { headers: { "content-type": "application/json" } }))
    .get("/health", () => ({ status: "ok" }));

const get = (app: ReturnType<typeof build>, path: string, method = "GET", extra: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { method, headers: extra }));

describe("cabeceras de seguridad", () => {
  test("toda respuesta lleva nosniff, frame deny, referrer-policy y CSP restrictiva", async () => {
    const app = build(true, false);
    for (const path of ["/graphql", "/health", "/no-existe"]) {
      const res = await get(app, path, "POST");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    }
  });

  test("las respuestas JSON de rutas distintas conservan su content-type", async () => {
    const res = await get(build(true, false), "/graphql", "POST");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("HSTS solo cuando hay proxy delante", async () => {
    expect((await get(build(true, false), "/health")).headers.get("strict-transport-security")).toBeNull();
    expect((await get(build(true, true), "/health")).headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  test("fuera de produccion GraphiQL queda sin CSP, el resto no", async () => {
    const app = build(false, false);
    expect((await get(app, "/graphql", "GET")).headers.get("content-security-policy")).toBeNull();
    expect((await get(app, "/graphql", "POST")).headers.get("content-security-policy")).not.toBeNull();
  });

  test("conviven con CORS en el mismo servidor", async () => {
    const res = await get(build(true, false), "/graphql", "OPTIONS", { origin: "https://lux.eternum.lat" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://lux.eternum.lat");
  });
});
