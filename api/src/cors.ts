import { Elysia } from "elysia";
import { corsOrigins } from "./env";

// CORS con lista de origenes permitidos. No se refleja el origen que llega:
// solo los de `CORS_ORIGINS` reciben `Access-Control-Allow-Origin`. Un origen
// ajeno ve el preflight rechazado (403) y las respuestas sin cabeceras CORS, de
// modo que el navegador no entrega al otro sitio ni la respuesta ni el token.

const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization";
const PREFLIGHT_MAX_AGE = "600";

export function allowedOrigin(origin: string | null, origins = corsOrigins()): string | null {
  return origin !== null && origins.includes(origin) ? origin : null;
}

export function corsPlugin(origins: () => string[] = corsOrigins) {
  return new Elysia({ name: "lux-cors" })
    .onRequest(({ request, set }) => {
      const origin = request.headers.get("origin");
      // Todas las respuestas dependen del Origin: que ningun cache mezcle variantes
      set.headers["vary"] = "Origin";
      if (origin === null) return;
      const allowed = allowedOrigin(origin, origins());
      if (allowed) {
        set.headers["access-control-allow-origin"] = allowed;
        set.headers["access-control-allow-credentials"] = "true";
      }
      if (request.method === "OPTIONS") {
        if (!allowed) return new Response(null, { status: 403, headers: { vary: "Origin" } });
        return new Response(null, {
          status: 204,
          headers: {
            vary: "Origin",
            "access-control-allow-origin": allowed,
            "access-control-allow-credentials": "true",
            "access-control-allow-methods": ALLOWED_METHODS,
            "access-control-allow-headers": ALLOWED_HEADERS,
            "access-control-max-age": PREFLIGHT_MAX_AGE,
          },
        });
      }
    })
    .as("global");
}
