import { Elysia } from "elysia";
import { trustProxy } from "./env";

// Cabeceras de seguridad de toda respuesta de la API (JSON, no paginas). La CSP
// es la mas cerrada posible porque la API no sirve HTML ni carga recursos: si una
// respuesta llegara a interpretarse como documento, no ejecuta ni incrusta nada.
// Fuera de produccion GraphiQL (GET /graphql) es una pagina con scripts de CDN y
// queda sin CSP para poder usarse.

const CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const HSTS = "max-age=31536000; includeSubDomains";

export function securityHeaders(options: { production: boolean; hsts: boolean; path: string; method: string }) {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  };
  const graphiql = !options.production && options.method === "GET" && options.path === "/graphql";
  if (!graphiql) headers["content-security-policy"] = CSP;
  // HSTS solo tiene sentido si el navegador llega por HTTPS; TRUST_PROXY indica que
  // hay nginx adelante (que termina TLS). Sobre HTTP plano el navegador lo ignora.
  if (options.hsts) headers["strict-transport-security"] = HSTS;
  return headers;
}

export function securityHeadersPlugin(production: boolean, hsts: () => boolean = trustProxy) {
  return new Elysia({ name: "lux-security-headers" })
    .onRequest(({ request, set }) => {
      const path = new URL(request.url).pathname;
      Object.assign(set.headers, securityHeaders({ production, hsts: hsts(), path, method: request.method }));
    })
    .as("global");
}
