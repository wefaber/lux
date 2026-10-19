import { SignJWT, jwtVerify } from "jose";
import { authSecret } from "./env";

// HS256 con el AUTH_SECRET de la VPS. El token va como `Authorization: Bearer`.
const ALG = "HS256";

/** Duracion absoluta de la sesion (Autenticacion.md de E2: 8 h). */
export const TOKEN_TTL = "8h";
export const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const key = () => new TextEncoder().encode(authSecret());

export interface TokenPayload {
  sub: string;
  role: string;
}

/** Token ya verificado: ademas del usuario trae su id (`jti`) y vencimiento (`exp`, segundos). */
export interface VerifiedToken extends TokenPayload {
  jti: string;
  exp: number;
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(TOKEN_TTL)
    .sign(key());
}

export async function verifyToken(token: string): Promise<VerifiedToken | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG] });
    if (typeof payload.sub !== "string" || typeof payload.jti !== "string") return null;
    if (typeof payload.exp !== "number") return null;
    return {
      sub: payload.sub,
      role: typeof payload.role === "string" ? payload.role : "",
      jti: payload.jti,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function bearerFrom(header: string | null | undefined): string | null {
  return header?.match(/^Bearer (.+)$/)?.[1] ?? null;
}
