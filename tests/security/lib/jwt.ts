// Helpers minimos para fabricar JWT a mano, sin agregar `jose` como
// dependencia de este paquete de pruebas. Solo HS256 (el algoritmo real del
// sistema, `api/src/auth.ts`) y `none`. Uso exclusivo del runner de
// ciberseguridad (CIB-E3-AT-04) contra una instancia de laboratorio propia.
import { createHmac } from "node:crypto";

function b64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

/** Token con header `alg: none` y sin firma (ataque clasico de confusion de algoritmo). */
export function forgeNoneToken(payload: Record<string, unknown>): string {
  const header = { alg: "none", typ: "JWT" };
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.`;
}

/** Token HS256 valido, firmado con `secret`. Si `secret` es el AUTH_SECRET real
 * del entorno de laboratorio, el servidor lo acepta como legitimo: demuestra el
 * impacto de una filtracion o adivinanza del secreto, no una falla de firma. */
export function signHS256(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${b64url(sig)}`;
}

/** Decodifica el payload de un JWT sin verificar la firma (para manipularlo). */
export function decodePayload(token: string): Record<string, unknown> {
  const [, payloadB64] = token.split(".");
  return JSON.parse(Buffer.from(payloadB64 ?? "", "base64url").toString("utf8"));
}

/** Reconstruye un token con un payload nuevo pero conservando header y firma
 * originales (la firma queda invalida salvo coincidencia, que es el punto). */
export function reencodePayloadKeepingSignature(token: string, payload: Record<string, unknown>): string {
  const [headerB64, , sigB64] = token.split(".");
  return `${headerB64}.${b64url(JSON.stringify(payload))}.${sigB64 ?? ""}`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
