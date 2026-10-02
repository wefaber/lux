import { afterAll, beforeAll } from "bun:test";
import { setupServer } from "msw/node";
import { handlers } from "@/mocks/handlers";

// Levanta los handlers de MSW para el archivo de test que lo llama. Los
// handlers mutan los datos semilla en memoria, igual que en el navegador.
export function useMockServer(): void {
  const server = setupServer(...handlers);
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterAll(() => server.close());
}

export interface GqlResult<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function gqlAs<T = unknown>(
  userId: string | null,
  query: string,
  variables?: Record<string, unknown>,
): Promise<GqlResult<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (userId) headers.Authorization = `Bearer mock-token-${userId}`;
  const res = await fetch("http://localhost/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  return (await res.json()) as GqlResult<T>;
}

export const USERS = {
  ROOT: "u-root",
  ADMIN: "u-admin-1",
  TECNICO: "u-tec-1",
  SOLICITANTE: "u-sol-1",
  OTRO_SOLICITANTE: "u-sol-2",
} as const;

export const FORBIDDEN = "No tenés permisos para esta acción";
