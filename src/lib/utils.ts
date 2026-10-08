import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { AUTH_STORAGE_KEY } from "@/lib/constants";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-UY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
} // Parseo de fechas

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-UY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
} // Parseo de fecha y hora

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

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `hace ${days} día${days !== 1 ? "s" : ""}`;
  if (hours > 0) return `hace ${hours} hora${hours !== 1 ? "s" : ""}`;
  if (minutes > 0) return `hace ${minutes} minuto${minutes !== 1 ? "s" : ""}`;
  return "ahora mismo";
} // Parseo de tiempo relativo

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
    super(`No hay backend detras de /graphql (HTTP ${status})`);
    this.name = "MocksUnavailableError";
  }
}

export function isMocksUnavailable(error: unknown): boolean {
  return error instanceof MocksUnavailableError;
} // Permite distinguir "el servidor de prueba no responde" de "credenciales malas"

// Mismo par de condiciones que arranca MSW en main.tsx, inline por el mismo
// motivo: asi un build sin mocks pliega esta rama y no arrastra nada.
const MOCKS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCKS === "true";

const MOCKS_DOWN_STATUS = [404, 405];

async function request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch("/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    if (MOCKS_ENABLED && MOCKS_DOWN_STATUS.includes(response.status)) {
      // El SW quedo mudo y la peticion se fue a nginx: re-armamos y reintentamos
      // una sola vez, asi el usuario no ve el error.
      const { reArmMocks } = await import("@/lib/mocks-runtime");
      await reArmMocks().catch(() => {});

      const retry = await fetch("/graphql", {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });

      if (retry.ok) return readData<T>(retry);

      throw new MocksUnavailableError(retry.status);
    }

    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return readData<T>(response);
} // Peticion con reintento si los mocks quedaron inactivos

async function readData<T>(response: Response): Promise<T> {
  const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors[0].message);
  }

  if (!json.data) {
    throw new Error("No data returned from API");
  }

  return json.data;
} // Lectura y validacion de la respuesta

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  return request<T>(query, variables);
} // Solicitudes a la API con metodos y gestion de errores

export function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
} // Generacion de ID

export function isOverdue(returnDate: string): boolean {
  return new Date(returnDate) < new Date();
} // Verificacion si esta fuera de fecha

export function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "…" : str;
} // Truncado de datos
