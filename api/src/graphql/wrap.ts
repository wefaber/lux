import { sql } from "drizzle-orm";
import { operationName, writeAudit } from "../audit";
import type { Ctx } from "../context";
import { runInTransaction } from "../db/client";
import { codeOf } from "../errors";
import { loadState } from "../state";

// Todos los resolvers pasan por uno de estos dos wrappers, asi la carga del
// estado, la transaccion y la auditoria viven en un solo lugar y las reglas de
// negocio de resolvers.ts no las repiten.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Resolver = (parent: unknown, args: any, ctx: Ctx, info?: unknown) => unknown;

/** Que fila de auditoria deja una mutacion. */
export interface AuditSpec {
  /** Entidad afectada, en PascalCase como el dataset de ejemplo (`Ticket`, `Session`). */
  entity: string;
  /** Id de la entidad; por defecto `result.id` o `args.id`. */
  id?: (args: any, result: any, ctx: Ctx) => string;
  /** Texto corto sin datos sensibles; por defecto, los nombres de los campos de `input`. */
  details?: (args: any, result: any) => string | null;
}

// Clave del lock de asesoramiento que serializa las mutaciones (ver docs/BACKEND.md).
const MUTATION_LOCK_KEY = 7_450_001;

function defaultId(args: any, result: any): string {
  if (result && typeof result === "object" && typeof result.id === "string") return result.id;
  return typeof args?.id === "string" ? args.id : "-";
}

function defaultDetails(args: any): string | null {
  const input = args?.input;
  if (input && typeof input === "object") return `Campos: ${Object.keys(input).join(", ")}`;
  return null;
}

/** Queries: cargan la foto de la base una sola vez por request. */
export function withState(fn: Resolver): Resolver {
  return async (parent, args, ctx, info) => {
    ctx.statePromise ??= loadState();
    ctx.state = await ctx.statePromise;
    return fn(parent, args, ctx, info);
  };
}

/**
 * Mutations: una transaccion por operacion. El lock de asesoramiento las
 * serializa (un solo escritor a la vez) y el estado se recarga adentro, ya con el
 * lock tomado, de modo que las validaciones y los ids correlativos (`nextId`)
 * ven los cambios de la mutacion anterior. Si algo falla, rollback de todo,
 * incluida la fila de auditoria.
 */
export function withTransaction(mutation: string, fn: Resolver, spec: AuditSpec): Resolver {
  const operation = operationName(mutation);
  return async (parent, args, ctx, info) => {
    try {
      return await runInTransaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${MUTATION_LOCK_KEY})`);
        ctx.state = await loadState();
        const result = await fn(parent, args, ctx, info);
        const caller = ctx.caller;
        await writeAudit({
          userId: caller?.id ?? "anonymous",
          userName: caller?.name ?? "Anónimo",
          operation,
          entity: spec.entity,
          entityId: (spec.id ?? defaultId)(args, result, ctx),
          details: (spec.details ?? defaultDetails)(args, result),
        });
        return result;
      });
    } catch (error) {
      // Un intento sin permiso hace rollback, pero igual queda registrado: es la
      // traza que necesita el procedimiento de incidentes.
      if (codeOf(error) === "FORBIDDEN" && ctx.caller) {
        await writeAudit({
          userId: ctx.caller.id,
          userName: ctx.caller.name,
          operation: `${operation}_DENIED`,
          entity: spec.entity,
          entityId: typeof args?.id === "string" ? args.id : "-",
          details: (error as Error).message,
        }).catch((auditError) => console.error("[audit] no se pudo registrar el rechazo:", auditError));
      }
      throw error;
    }
  };
}
