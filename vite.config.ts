import { rm } from "node:fs/promises";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// public/mockServiceWorker.js se copia a dist en todo build. Sin mocks no tiene
// que publicarse: un worker de MSW servido por produccion es una puerta a
// interceptar /graphql con datos falsos.
function dropMockWorker(enabled: boolean): Plugin {
  let outDir = "dist";
  return {
    name: "lux:drop-mock-worker",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      if (!enabled) await rm(path.join(outDir, "mockServiceWorker.js"), { force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const mocks = env.VITE_ENABLE_MOCKS === "true";
  const api = env.LUX_API_URL || "http://127.0.0.1:4111";
  // Con mocks MSW atiende /graphql en el navegador; sin mocks `bun dev` reenvia
  // a la API real, igual que el nginx de los deploys.
  const proxy = mocks
    ? undefined
    : Object.fromEntries(
        ["/graphql", "/api", "/health", "/ready"].map((p) => [
          p,
          { target: api, changeOrigin: true },
        ]),
      );

  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
      dropMockWorker(mocks),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: { proxy },
  };
});
