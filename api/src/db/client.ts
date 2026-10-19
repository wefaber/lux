import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseUrl } from "../env";
import * as schema from "./schema";

export const pool = new Pool({ connectionString: databaseUrl(), max: 10 });
const baseDb = drizzle(pool, { schema });
export type Db = typeof baseDb;

// Transaccion activa de la mutacion en curso. `db` es un proxy que apunta a la
// transaccion cuando hay una y al pool cuando no: los resolvers siguen escribiendo
// `db.insert(...)` y toda la mutacion (incluida la fila de auditoria) queda dentro
// de una misma transaccion sin pasar un `tx` por cada funcion.
const transactionStore = new AsyncLocalStorage<Db>();

export const db: Db = new Proxy(baseDb, {
  get(target, property) {
    const active = transactionStore.getStore() ?? target;
    const value = Reflect.get(active, property, active);
    return typeof value === "function" ? value.bind(active) : value;
  },
});

/** Ejecuta `work` dentro de una transaccion: commit si termina, rollback si lanza. */
export function runInTransaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  return baseDb.transaction((tx) => {
    const scoped = tx as unknown as Db;
    return transactionStore.run(scoped, () => work(scoped));
  });
}

/** `true` si el codigo corre dentro de `runInTransaction` (una sola conexion). */
export function inTransaction(): boolean {
  return transactionStore.getStore() !== undefined;
}

/**
 * Corre las lecturas en paralelo sobre el pool, o una detras de otra si hay una
 * transaccion: una conexion no admite consultas simultaneas.
 */
export async function readAll<T extends readonly (() => Promise<unknown>)[]>(
  reads: T,
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  if (!inTransaction()) {
    return (await Promise.all(reads.map((read) => read()))) as never;
  }
  const results: unknown[] = [];
  for (const read of reads) results.push(await read());
  return results as never;
}
