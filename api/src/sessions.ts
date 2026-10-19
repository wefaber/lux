import { eq, lt } from "drizzle-orm";
import { db } from "./db/client";
import * as t from "./db/schema";

// Revocacion de sesiones: el JWT es sin estado, asi que el logout deja el `jti`
// en `revoked_tokens` hasta que el token venza. Persistido en la base (no en
// memoria) para que sobreviva a reinicios y valga en los dos slots del deploy.

export async function isRevoked(jti: string): Promise<boolean> {
  const [row] = await db
    .select({ jti: t.revokedTokens.jti })
    .from(t.revokedTokens)
    .where(eq(t.revokedTokens.jti, jti))
    .limit(1);
  return row !== undefined;
}

export async function revokeToken(token: { jti: string; exp: number }, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(t.revokedTokens)
    .values({
      jti: token.jti,
      userId,
      expiresAt: new Date(token.exp * 1000).toISOString(),
      revokedAt: now,
    })
    .onConflictDoNothing();
  // Un token vencido ya no autentica, no hace falta recordarlo.
  await db.delete(t.revokedTokens).where(lt(t.revokedTokens.expiresAt, now));
}
