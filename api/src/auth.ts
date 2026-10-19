import { SignJWT, jwtVerify } from "jose";
import { authSecret } from "./env";

// HS256 con el AUTH_SECRET de la VPS. El token va como `Authorization: Bearer`.
const ALG = "HS256";
const key = () => new TextEncoder().encode(authSecret());

export interface TokenPayload {
  sub: string;
  role: string;
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key());
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG] });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, role: typeof payload.role === "string" ? payload.role : "" };
  } catch {
    return null;
  }
}

export function bearerFrom(header: string | null | undefined): string | null {
  return header?.match(/^Bearer (.+)$/)?.[1] ?? null;
}
