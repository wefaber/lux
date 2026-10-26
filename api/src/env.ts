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

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Intentos de login fallidos por documento antes del bloqueo (default 5). */
export function loginMaxAttempts(): number {
  loadEnv();
  return positiveInt("LOGIN_MAX_ATTEMPTS", 5);
}

/** Intentos de login fallidos por IP antes del bloqueo (default 50). */
export function loginIpMaxAttempts(): number {
  loadEnv();
  return positiveInt("LOGIN_IP_MAX_ATTEMPTS", 50);
}

/** Minutos del primer bloqueo, y ventana de conteo de fallos (default 15). */
export function loginLockMinutes(): number {
  loadEnv();
  return positiveInt("LOGIN_LOCK_MINUTES", 15);
}

/** Tope del bloqueo incremental en minutos (default 60). */
export function loginLockMaxMinutes(): number {
  loadEnv();
  return positiveInt("LOGIN_LOCK_MAX_MINUTES", 60);
}

/**
 * IP del cliente. Detras de nginx el socket es siempre el proxy; con
 * TRUST_PROXY=1 se toma la ultima entrada de X-Forwarded-For, la que agrego el
 * proxy (las anteriores las puede escribir el cliente).
 */
export function trustProxy(): boolean {
  loadEnv();
  return process.env.TRUST_PROXY === "1";
}

// Origenes del frontend que el navegador puede usar para llamar a la API. En el
// despliegue normal el frontend y la API comparten origen (nginx), asi que CORS
// solo interviene en desarrollo o si el frontend se sirve desde otro dominio.
const DEFAULT_CORS_ORIGINS = [
  "https://lux.eternum.lat",
  "https://dev.eternum.lat",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

/** Lista de origenes permitidos: `CORS_ORIGINS` (separados por coma) o los conocidos del repo. */
export function corsOrigins(): string[] {
  loadEnv();
  const raw = process.env.CORS_ORIGINS;
  if (raw === undefined) return DEFAULT_CORS_ORIGINS;
  return raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter((origin) => origin !== "" && origin !== "*");
}

/** Tamano maximo del cuerpo de un request en bytes (`MAX_BODY_BYTES`, default 256 KiB). */
export function maxBodyBytes(): number {
  loadEnv();
  return positiveInt("MAX_BODY_BYTES", 256 * 1024);
}

/** Profundidad maxima de una operacion GraphQL (`GRAPHQL_MAX_DEPTH`, default 10). */
export function graphqlMaxDepth(): number {
  loadEnv();
  return positiveInt("GRAPHQL_MAX_DEPTH", 10);
}

/** Campos raiz maximos por operacion, alias incluidos (`GRAPHQL_MAX_ROOT_FIELDS`, default 12). */
export function graphqlMaxRootFields(): number {
  loadEnv();
  return positiveInt("GRAPHQL_MAX_ROOT_FIELDS", 12);
}
