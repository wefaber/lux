// Crea el primer root_admin en una base sin datos de ejemplo (produccion: el
// seed de fixtures no se corre ahi porque trae cuentas con claves conocidas).
// Idempotente: si ya hay un root_admin activo no hace nada.
//
// Uso (las variables van por entorno para que la clave no quede en el historial
// del shell ni en la lista de procesos):
//   LUX_ADMIN_DNI=... LUX_ADMIN_NAME=... LUX_ADMIN_EMAIL=... LUX_ADMIN_PASSWORD=... \
//     bun run scripts/create-admin.ts
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import * as t from "../src/db/schema";
import { validatePassword } from "../src/lib/validation";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Falta ${name}`);
    process.exit(2);
  }
  return value;
}

const dni = required("LUX_ADMIN_DNI");
const name = required("LUX_ADMIN_NAME");
const email = required("LUX_ADMIN_EMAIL");
const password = required("LUX_ADMIN_PASSWORD");

const weak = validatePassword(password);
if (weak) {
  console.error(weak);
  process.exit(2);
}

try {
  const [existing] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(and(eq(t.users.role, "root_admin"), eq(t.users.isActive, true)))
    .limit(1);

  if (existing) {
    console.log(`Ya existe un root_admin activo (${existing.id}): no se crea otro.`);
  } else {
    const now = new Date().toISOString();
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    await db.insert(t.users).values({
      id: "u-root",
      name,
      dni,
      email,
      role: "root_admin",
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    console.log("root_admin creado (u-root).");
  }
} finally {
  await pool.end();
}
