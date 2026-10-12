import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Credenciales de Postgres y el secret de JWT viven fuera del repo, en los
// archivos de entorno de la VPS. El unit de systemd ya los exporta; esto cubre
// las corridas manuales (`bun run db:seed`, `drizzle-kit migrate`) sin obligar a
// source-ear a mano. Nunca se commitean aca.
const ENV_DIR = process.env.LUX_ENV_DIR ?? "/home/hermes/deploy/env";
const ENV_FILES = ["lux-dev.env", "lux-api.env"];

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const file of ENV_FILES) {
    const path = join(ENV_DIR, file);
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line
        .slice(eq + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2");
      // Lo ya exportado (systemd, shell) gana sobre el archivo
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function required(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export function databaseUrl(): string {
  loadEnv();
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = required("DB_HOST");
  const port = required("DB_PORT");
  const name = required("DB_NAME");
  const user = required("DB_USER");
  const password = required("DB_PASSWORD");
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

export function authSecret(): string {
  return required("AUTH_SECRET");
}

export function serverHost(): string {
  return process.env.HOST ?? "127.0.0.1";
}

export function serverPort(): number {
  return Number(process.env.PORT ?? 4111);
}
