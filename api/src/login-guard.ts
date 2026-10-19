// Bloqueo de login por intentos fallidos (RF-AUTH-007).
//
// - Por documento: LOGIN_MAX_ATTEMPTS fallos (5) dentro de la ventana bloquean ese
//   documento LOGIN_LOCK_MINUTES (15). Se cuenta igual exista o no la cuenta, para
//   que el comportamiento no permita enumerar usuarios.
// - Por IP: un umbral mas alto (LOGIN_IP_MAX_ATTEMPTS, 50) frena el rociado de
//   contrasenas sobre muchas cuentas desde un mismo origen.
//
// Limitacion documentada: el estado vive en memoria del proceso. Se pierde al
// reiniciar y no se comparte entre los dos slots del deploy blue/green ni entre
// instancias. Para varias instancias habria que moverlo a la base o a un cache.

export interface GuardConfig {
  /** Fallos por documento antes del bloqueo. */
  maxAttempts: number;
  /** Fallos por IP antes del bloqueo. */
  ipMaxAttempts: number;
  /** Duracion del bloqueo y ventana de conteo, en milisegundos. */
  lockMs: number;
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  maxAttempts: 5,
  ipMaxAttempts: 50,
  lockMs: 15 * 60 * 1000,
};

interface Entry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

export type GuardStatus = { locked: false } | { locked: true; retryAfterSeconds: number };

// Tope de claves en memoria: un atacante que prueba documentos al azar no puede
// hacer crecer el proceso sin limite.
const MAX_KEYS = 20_000;
const MAX_KEY_LENGTH = 64;

class Counter {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly limit: number,
    private readonly lockMs: number,
    private readonly now: () => number,
  ) {}

  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const now = this.now();
    const expired = entry.lockedUntil > 0 ? entry.lockedUntil <= now : entry.windowStart + this.lockMs <= now;
    if (expired) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  status(key: string): GuardStatus {
    const entry = this.live(key);
    if (!entry || entry.lockedUntil === 0) return { locked: false };
    return { locked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - this.now()) / 1000) };
  }

  /** Devuelve `true` si este fallo es el que dispara el bloqueo. */
  fail(key: string): boolean {
    const now = this.now();
    let entry = this.live(key);
    if (!entry) {
      this.makeRoom();
      entry = { failures: 0, windowStart: now, lockedUntil: 0 };
      this.entries.set(key, entry);
    }
    if (entry.lockedUntil > 0) return false;
    entry.failures += 1;
    if (entry.failures >= this.limit) {
      entry.lockedUntil = now + this.lockMs;
      return true;
    }
    return false;
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  private makeRoom(): void {
    if (this.entries.size < MAX_KEYS) return;
    for (const key of this.entries.keys()) this.live(key);
    // Sigue lleno: se descartan las mas viejas (el Map conserva el orden de insercion).
    for (const key of this.entries.keys()) {
      if (this.entries.size < MAX_KEYS) break;
      this.entries.delete(key);
    }
  }
}

export class LoginGuard {
  private readonly byDni: Counter;
  private readonly byIp: Counter;

  constructor(
    config: GuardConfig = DEFAULT_GUARD_CONFIG,
    now: () => number = Date.now,
  ) {
    this.byDni = new Counter(config.maxAttempts, config.lockMs, now);
    this.byIp = new Counter(config.ipMaxAttempts, config.lockMs, now);
  }

  private static dniKey(dni: string): string {
    return dni.trim().toLowerCase().slice(0, MAX_KEY_LENGTH);
  }

  /** Antes de verificar la contrasena: si el documento o la IP estan bloqueados, se corta. */
  check(dni: string, ip: string): GuardStatus {
    const a = this.byDni.status(LoginGuard.dniKey(dni));
    const b = this.byIp.status(ip);
    if (a.locked && b.locked) return a.retryAfterSeconds >= b.retryAfterSeconds ? a : b;
    return a.locked ? a : b;
  }

  /** Registra un fallo. Devuelve que bloqueo se acaba de activar, si alguno. */
  recordFailure(dni: string, ip: string): { dniLocked: boolean; ipLocked: boolean } {
    return {
      dniLocked: this.byDni.fail(LoginGuard.dniKey(dni)),
      ipLocked: this.byIp.fail(ip),
    };
  }

  /** Un login correcto limpia el contador de ese documento (no el de la IP). */
  recordSuccess(dni: string): void {
    this.byDni.clear(LoginGuard.dniKey(dni));
  }
}
