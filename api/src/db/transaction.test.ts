import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

// Prueba de integracion: necesita una base migrada (DATABASE_URL). Sin ella se
// omite, asi `bun test` sigue corriendo en una maquina sin PostgreSQL.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("runInTransaction (PostgreSQL)", () => {
  const rollbackId = `loc-tx-rollback-${crypto.randomUUID().slice(0, 8)}`;
  const commitId = `loc-tx-commit-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const row = (id: string) => ({
    id,
    kind: "other",
    number: 999,
    name: `Prueba ${id}`,
    code: "TX",
    createdAt: now,
    updatedAt: now,
  });

  afterAll(async () => {
    const { db } = await import("./client");
    const { locations } = await import("./schema");
    await db.delete(locations).where(eq(locations.id, commitId));
    await db.delete(locations).where(eq(locations.id, rollbackId));
  });

  test("si el trabajo lanza, no queda ninguna de las escrituras", async () => {
    const { db, runInTransaction } = await import("./client");
    const { locations } = await import("./schema");
    await expect(
      runInTransaction(async () => {
        await db.insert(locations).values(row(rollbackId));
        throw new Error("falla a mitad de la mutacion");
      }),
    ).rejects.toThrow("falla a mitad");
    const found = await db.select().from(locations).where(eq(locations.id, rollbackId));
    expect(found).toHaveLength(0);
  });

  test("si el trabajo termina, la escritura se confirma", async () => {
    const { db, runInTransaction } = await import("./client");
    const { locations } = await import("./schema");
    await runInTransaction(async () => {
      await db.insert(locations).values(row(commitId));
    });
    const found = await db.select().from(locations).where(eq(locations.id, commitId));
    expect(found).toHaveLength(1);
  });

  test("fuera de la transaccion el proxy usa el pool y adentro la conexion de la transaccion", async () => {
    const { inTransaction, runInTransaction } = await import("./client");
    expect(inTransaction()).toBe(false);
    await runInTransaction(async () => {
      expect(inTransaction()).toBe(true);
    });
    expect(inTransaction()).toBe(false);
  });
});
