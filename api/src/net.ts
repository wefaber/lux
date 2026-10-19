import { trustProxy } from "./env";

interface IpSource {
  requestIP(request: Request): { address: string } | null;
}

/** IP del cliente para el bloqueo de login y la auditoria (ver `trustProxy`). */
export function clientIp(request: Request, server: IpSource | null | undefined): string {
  if (trustProxy()) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
    if (forwarded) return forwarded.slice(0, 64);
  }
  return server?.requestIP(request)?.address ?? "unknown";
}
