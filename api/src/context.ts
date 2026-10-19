import { eq } from "drizzle-orm";
import { bearerFrom, verifyToken, type VerifiedToken } from "./auth";
import { db } from "./db/client";
import * as t from "./db/schema";
import { isRevoked } from "./sessions";
import { toUser, type State } from "./state";
import type { User } from "@/lib/types";

// Contexto de cada request. `state` (la foto de la base) no se carga aca: lo
// llenan los wrappers de graphql/wrap.ts, las queries una vez por request y las
// mutations dentro de su transaccion, con la foto ya serializada por el lock.
export interface Ctx {
  state: State;
  statePromise?: Promise<State>;
  caller: User | null;
  /** IP del cliente, para el bloqueo de login y la auditoria. */
  ip: string;
  /** Token con el que se autentico el request (si era valido), para el logout. */
  token: VerifiedToken | null;
}

export async function createContext(request: Request, ip: string): Promise<Ctx> {
  const raw = bearerFrom(request.headers.get("authorization"));
  let token = raw ? await verifyToken(raw) : null;
  if (token && (await isRevoked(token.jti))) token = null;
  let caller: User | null = null;
  if (token) {
    const [row] = await db.select().from(t.users).where(eq(t.users.id, token.sub)).limit(1);
    caller = row?.isActive ? toUser(row) : null;
  }
  return { state: undefined as unknown as State, caller, ip, token: caller ? token : null };
}
