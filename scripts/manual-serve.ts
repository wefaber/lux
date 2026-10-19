// Sirve dist/ (build SIN mocks) y reenvia /graphql, /api/v1, /health y /ready a la API real.
// Es el patron del nivel 2 de tests/README.md: SPA y API bajo el mismo origen, como hace el
// nginx del contenedor `web` (ops/containers/web/default.conf.template).
//
//   VITE_ENABLE_MOCKS=false bunx vite build
//   bun scripts/manual-serve.ts --port 4128 --api http://127.0.0.1:4118
//
// Solo para generar las capturas del manual; en servidores reales se usa nginx.
import { existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg("port", "4128"));
const API = arg("api", "http://127.0.0.1:4118").replace(/\/$/, "");
const DIST = join(import.meta.dir, "..", arg("dist", "dist"));
const PROXIED = ["/graphql", "/api/v1", "/health", "/ready"];

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (PROXIED.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) {
      const headers = new Headers(req.headers);
      headers.delete("host");
      return fetch(`${API}${url.pathname}${url.search}`, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
        redirect: "manual",
      });
    }
    const safe = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(DIST, safe);
    if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) return new Response(Bun.file(file));
    return new Response(Bun.file(join(DIST, "index.html"))); // fallback del SPA
  },
});
console.log(`manual-serve en http://127.0.0.1:${PORT} -> API ${API}`);
