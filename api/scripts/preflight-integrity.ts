// Revisa que los datos actuales cumplan las FK y los CHECK de la migracion 0003
// ANTES de aplicarla (en dev/produccion puede haber filas creadas cuando la base
// no validaba nada). No modifica nada: lista cuantas filas violan cada
// restriccion. Uso:  cd api && bun run scripts/preflight-integrity.ts
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { getTableName, sql } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import * as enums from "../src/db/enums";
import * as t from "../src/db/schema";

const tables: PgTable[] = [
  t.users, t.locations, t.products, t.components, t.tickets, t.loans, t.loanComponents,
  t.serviceRequests, t.interventions, t.comments, t.reservations, t.notices, t.pendingSeen,
];

// [tabla, columna, valores permitidos]: los mismos CHECK de schema.ts
const CHECKS: Array<[string, string, readonly string[]]> = [
  ["users", "role", enums.USER_ROLES],
  ["locations", "kind", enums.LOCATION_KINDS],
  ["products", "status", enums.EQUIPMENT_STATUSES],
  ["tickets", "status", enums.TICKET_STATUSES],
  ["tickets", "category", enums.TICKET_CATEGORIES],
  ["loans", "status", enums.LOAN_STATUSES],
  ["service_requests", "type", enums.SERVICE_TYPES],
  ["service_requests", "status", enums.SERVICE_STATUSES],
  ["interventions", "type", enums.INTERVENTION_TYPES],
  ["comments", "entity_type", enums.COMMENT_ENTITIES],
  ["reservations", "resource_type", enums.RESERVATION_RESOURCES],
  ["reservations", "status", enums.RESERVATION_STATUSES],
  ["notices", "entity_type", enums.NOTICE_ENTITIES],
  ["notices", "kind", enums.NOTICE_KINDS],
  ["pending_seen", "section", enums.NOTICE_ENTITIES],
];

const ident = (name: string) => sql.raw(`"${name.replace(/"/g, "")}"`);
let problems = 0;

for (const table of tables) {
  const config = getTableConfig(table);
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    const column = ref.columns[0]!;
    const target = ref.foreignColumns[0]!;
    const targetTable = getTableName(target.table);
    const result = await db.execute(
      sql`select count(*)::int as n from ${ident(config.name)} c
          where c.${ident(column.name)} is not null
            and not exists (select 1 from ${ident(targetTable)} p where p.${ident(target.name)} = c.${ident(column.name)})`,
    );
    const n = (result.rows[0] as { n: number }).n;
    if (n > 0) problems += n;
    console.log(`${n > 0 ? "VIOLA" : "ok   "} FK ${config.name}.${column.name} -> ${targetTable}.${target.name}: ${n}`);
  }
}

for (const [table, column, allowed] of CHECKS) {
  const result = await db.execute(
    sql`select count(*)::int as n from ${ident(table)} where ${ident(column)} not in (${sql.join(allowed.map((v) => sql`${v}`), sql`, `)})`,
  );
  const n = (result.rows[0] as { n: number }).n;
  if (n > 0) problems += n;
  console.log(`${n > 0 ? "VIOLA" : "ok   "} CHECK ${table}.${column}: ${n}`);
}

const shape = await db.execute(
  sql`select count(*)::int as n from reservations
      where not ((resource_type = 'equipment' and equipment_id is not null and location_id is null)
              or (resource_type = 'location' and location_id is not null and equipment_id is null))`,
);
const shapeBad = (shape.rows[0] as { n: number }).n;
problems += shapeBad;
console.log(`${shapeBad > 0 ? "VIOLA" : "ok   "} CHECK reservations_resource_check: ${shapeBad}`);

console.log(problems === 0 ? "\nSin violaciones: la migracion 0003 se puede aplicar." : `\n${problems} filas violan alguna restriccion: corregirlas antes de migrar.`);
await pool.end();
process.exit(problems === 0 ? 0 : 1);
