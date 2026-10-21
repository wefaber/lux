import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { allowedOrigin, corsPlugin } from "./cors";

const ALLOWED = "https://lux.eternum.lat";
const FOREIGN = "https://sitio-ajeno.example";

// La ruta devuelve un Response, igual que /graphql y /api/v1: asi se comprueba que
// las cabeceras del plugin llegan tambien a ese tipo de respuesta.
const app = new Elysia()
  .use(corsPlugin(() => [ALLOWED, "http://localhost:5173"]))
  .all("/graphql", () => new Response(JSON.stringify({ data: {} }), { headers: { "content-type": "application/json" } }));

const call = (method: string, origin?: string) =>
  app.handle(new Request("http://localhost/graphql", { method, headers: origin ? { origin } : {} }));

describe("CORS con lista de origenes", () => {
  test("preflight de un origen permitido", async () => {
    const res = await call("OPTIONS", ALLOWED);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(res.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  test("preflight de un origen ajeno: rechazado y sin cabeceras CORS", async () => {
    const res = await call("OPTIONS", FOREIGN);
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("la respuesta a un origen permitido lleva Allow-Origin", async () => {
    const res = await call("POST", ALLOWED);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  });

  test("la respuesta a un origen ajeno no se comparte", async () => {
    const res = await call("POST", FOREIGN);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  test("sin Origin (curl, servidor a servidor) no se agregan cabeceras CORS", async () => {
    const res = await call("POST");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("allowedOrigin no acepta comodines ni subdominios parecidos", () => {
    expect(allowedOrigin("*", [ALLOWED])).toBeNull();
    expect(allowedOrigin("https://lux.eternum.lat.evil.example", [ALLOWED])).toBeNull();
    expect(allowedOrigin("null", [ALLOWED])).toBeNull();
    expect(allowedOrigin(ALLOWED, [ALLOWED])).toBe(ALLOWED);
  });
});
