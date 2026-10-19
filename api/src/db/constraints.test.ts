import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

// Prueba de integracion contra una base migrada (DATABASE_URL); sin ella se omite.
const hasDatabase = Boolean(process.env.DATABASE_URL);

async function load() {
  const { db, pool, runInTransaction } = await import("./client");
  const { classifyUnexpected } = await import("../errors");
  return { db, pool, runInTransaction, classifyUnexpected };
}

// Ejecuta un INSERT que la base debe rechazar y devuelve el error crudo y como lo
// ve la API. Corre dentro de una transaccion: al fallar queda abortada y PostgreSQL
// responde ROLLBACK al COMMIT, asi que no persiste nada.
async function rejected(statement: ReturnType<typeof sql>) {
  const { db, runInTransaction, classifyUnexpected } = await load();
  const error = await runInTransaction(async () => {
    try {
      await db.execute(statement);
      return null;
    } catch (e) {
      return e;
    }
  });
  return { raw: error, api: error ? classifyUnexpected(error) : null };
}

describe.skipIf(!hasDatabase)("restricciones de integridad (PostgreSQL)", () => {
  test("hay 26 claves foraneas y 16 CHECK declarados", async () => {
    const { db } = await load();
    const fks = await db.execute(
      sql`select count(*)::int as n from information_schema.table_constraints where constraint_type = 'FOREIGN KEY' and table_schema = 'public'`,
    );
    const checks = await db.execute(
      sql`select count(*)::int as n from information_schema.table_constraints where constraint_type = 'CHECK' and constraint_name like '%\\_check' and table_schema = 'public'`,
    );
    expect((fks.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(26);
    expect((checks.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(16);
  });

  test("un rol fuera de la lista se rechaza (CHECK) y la API lo traduce a 422", async () => {
    const { api } = await rejected(
      sql`insert into users (id, name, dni, email, role, is_active, password_hash, created_at, updated_at)
          values ('u-test-chk', 'T', '00000001', 't@x', 'hacker', true, 'x', 't', 't')`,
    );
    expect(api?.extensions.code).toBe("VALIDATION_ERROR");
    expect(api?.extensions.status).toBe(422);
  });

  test("un ticket de un usuario que no existe se rechaza (FK)", async () => {
    const { raw, api } = await rejected(
      sql`insert into tickets (id, title, description, category, status, submitted_by_id, created_at, updated_at)
          values ('tkt-test-fk', 't', 'd', 'other', 'pending', 'u-no-existe', 't', 't')`,
    );
    expect((raw as { cause?: { code?: string }; code?: string }).code ?? (raw as { cause?: { code?: string } }).cause?.code).toBe("23503");
    expect(api?.extensions.code).toBe("VALIDATION_ERROR");
  });

  test("un documento repetido se rechaza (UNIQUE) y la API lo traduce a 409", async () => {
    const { api } = await rejected(
      sql`insert into users (id, name, dni, email, role, is_active, password_hash, created_at, updated_at)
          select 'u-test-dup', 'T', dni, 't@x', 'admin', true, 'x', 't', 't' from users limit 1`,
    );
    expect(api?.extensions.code).toBe("CONFLICT");
    expect(api?.extensions.status).toBe(409);
  });

  test("una reserva tiene que ser de un equipo o de un espacio, no de ambos", async () => {
    const { api } = await rejected(
      sql`insert into reservations (id, resource_type, user_id, purpose, starts_at, ends_at, status, created_at, updated_at)
          select 'rsv-test-chk', 'equipment', id, 'p', 't', 't', 'pending', 't', 't' from users limit 1`,
    );
    expect(api?.extensions.code).toBe("VALIDATION_ERROR");
  });
});
