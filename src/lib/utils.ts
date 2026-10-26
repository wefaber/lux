import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { AUTH_STORAGE_KEY } from "@/lib/constants";
import { t } from "@/i18n";
import { translateError } from "@/i18n/errors";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Fechas y horas siguen el idioma activo (src/i18n): dd/mm/aaaa en los dos
export { formatDate, formatDateTime, formatNumber, formatRelativeTime } from "@/i18n";

// <input type="datetime-local"> trabaja en hora local y sin zona ("2026-10-08T14:30");
// la API, en ISO UTC. Estas dos funciones pasan de uno a otro.
export function toDateTimeInput(iso: string | Date = new Date()): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function fromDateTimeInput(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function getAuthToken(): string | null {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;
    const { token } = JSON.parse(stored) as { token?: string };
    return token ?? null;
  } catch {
    return null;
  }
} // Lee el token de la sesion guardada para adjuntarlo en cada request

// Un /graphql que responde 404/405 solo puede venir del nginx que sirve el SPA:
// significa que el service worker de MSW no intercepto (ver mocks-runtime.ts).
export class MocksUnavailableError extends Error {
  constructor(status: number) {
    super(t("error.mocksUnavailable", { status }));
    this.name = "MocksUnavailableError";
  }
}

// Error de la API: `message` ya viene traducido al idioma activo; `original` es
// el texto que mando el servidor, `code` su extensions.code y `retryAfterSeconds`
// los segundos de espera cuando la cuenta esta bloqueada
export class ApiError extends Error {
  readonly code: string | undefined;
  readonly original: string;
  readonly retryAfterSeconds: number | undefined;
  constructor(original: string, code?: string, retryAfterSeconds?: number) {
    super(translateError(original, code));
    this.name = "ApiError";
    this.code = code;
    this.original = original;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isMocksUnavailable(error: unknown): boolean {
  return error instanceof MocksUnavailableError;
} // Permite distinguir "el servidor de prueba no responde" de "credenciales malas"

// Mismo par de condiciones que arranca MSW en main.tsx, inline por el mismo
// motivo: asi un build sin mocks pliega esta rama y no arrastra nada.
const MOCKS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCKS === "true";

const MOCKS_DOWN_STATUS = new Set([404, 405]);

// Sin red, fetch falla con un TypeError del navegador ("Failed to fetch") que no
// se entiende ni se traduce: se cambia por un mensaje propio
function post(headers: Record<string, string>, query: string, variables?: Record<string, unknown>) {
  return fetch("/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  }).catch(() => {
    throw new Error(t("error.network"));
  });
}

async function request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await post(headers, query, variables);

  if (!response.ok) {
    if (MOCKS_ENABLED && MOCKS_DOWN_STATUS.has(response.status)) {
      // El SW quedo mudo y la peticion se fue a nginx: re-armamos y reintentamos
      // una sola vez, asi el usuario no ve el error.
      const { reArmMocks } = await import("@/lib/mocks-runtime");
      await reArmMocks().catch(() => {});

      const retry = await post(headers, query, variables);

      if (retry.ok) return readData<T>(retry);

      throw new MocksUnavailableError(retry.status);
    }

    throw new Error(t("error.http", { status: response.status, text: response.statusText }));
  }

  return readData<T>(response);
} // Peticion con reintento si los mocks quedaron inactivos

async function readData<T>(response: Response): Promise<T> {
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{
      message: string;
      extensions?: { code?: string; retryAfterSeconds?: number };
    }>;
  };

  if (json.errors && json.errors.length > 0) {
    throw new ApiError(
      json.errors[0].message,
      json.errors[0].extensions?.code,
      json.errors[0].extensions?.retryAfterSeconds,
    );
  }

  if (!json.data) {
    throw new Error(t("error.noData"));
  }

  return json.data;
} // Lectura y validacion de la respuesta

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  return request<T>(query, variables);
} // Solicitudes a la API con metodos y gestion de errores

export function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "…" : str;
} // Truncado de datos

export function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
} // Iniciales del nombre para el avatar

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
} // Mensaje para mostrar de un error atrapado en un catch
