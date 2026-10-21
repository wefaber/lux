// Bloqueo de login del mock, equivalente a api/src/login-guard.ts. Sin esto la
// demo (MSW) permite intentos infinitos y el issue #53 no se puede comprobar en
// desarrollo. Mantiene la paridad de comportamiento:
//
// - 5 fallos por documento bloquean ese documento; cuentan igual exista o no.
// - El bloqueo es incremental: 15 min, 30, 60 y tope de 60. Un login correcto o
//   un dia sin fallos vuelven al bloqueo base.
// - 50 fallos desde un mismo origen bloquean el origen (el equivalente a la IP).
//
// El navegador no expone la IP del cliente: se usa la primera entrada de
// `X-Forwarded-For` cuando viene (tests o un proxy) y, si no, una clave fija
// ("mock-client"). Todos los intentos de la demo comparten esa clave, igual que
// compartirian la IP de la maquina. El estado vive en memoria: se pierde al
// recargar la pagina, como el de la API al reiniciarse.
//
// Para cambiar la configuracion en la demo alcanza con tocar
// DEFAULT_MOCK_LOGIN_GUARD_CONFIG o instanciar MockLoginGuard con otra config.

export interface MockLoginGuardConfig {
  /** Fallos por documento antes del bloqueo. */
  maxAttempts: number;
  /** Fallos por origen antes del bloqueo. */
  originMaxAttempts: number;
  /** Duracion del primer bloqueo y ventana de conteo, en milisegundos. */
  lockMs: number;
  /** Tope del bloqueo incremental (default 4x `lockMs`). */
  maxLockMs?: number;
  /** Lapso sin fallos tras el cual la escalada vuelve al bloqueo base (default 24 h). */
  escalationResetMs?: number;
}

export const DEFAULT_MOCK_LOGIN_GUARD_CONFIG: MockLoginGuardConfig = {
  maxAttempts: 5,
  originMaxAttempts: 50,
  lockMs: 15 * 60 * 1000,
  maxLockMs: 60 * 60 * 1000,
  escalationResetMs: 24 * 60 * 60 * 1000,
};

/** Mismo texto que la API para un fallo y para un bloqueo: no delata la cuenta. */
export const INVALID_CREDENTIALS_MESSAGE = "Credenciales inválidas";

/** Origen simulado cuando el navegador no manda `X-Forwarded-For`. */
export const MOCK_CLIENT_ORIGIN = "mock-client";

interface Entry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
  locks: number;
  lastActivity: number;
}

// Mismo tope que la API: probar documentos al azar no puede crecer sin limite.
const MAX_KEYS = 20_000;

export type MockLockStatus =
  | { locked: false }
  | { locked: true; retryAfterSeconds: number };

class Counter {
  private readonly entries = new Map<string, Entry>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly lockMs: number;
  private readonly now: () => number;
  private readonly maxLockMs: number;
  private readonly escalationResetMs: number;

  constructor(
    limit: number,
    windowMs: number,
    lockMs: number,
    now: () => number,
    config: MockLoginGuardConfig,
  ) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.lockMs = lockMs;
    this.now = now;
    this.maxLockMs = Math.max(lockMs, config.maxLockMs ?? lockMs * 4);
    this.escalationResetMs = Math.max(
      this.maxLockMs,
      config.escalationResetMs ?? 24 * 60 * 60 * 1000,
    );
  }

  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const now = this.now();
    if (now - entry.lastActivity >= this.escalationResetMs) {
      this.entries.delete(key);
      return undefined;
    }
    if (entry.lockedUntil > 0) {
      if (entry.lockedUntil > now) return entry;
      entry.lockedUntil = 0;
      entry.failures = 0;
      entry.windowStart = now;
      return entry;
    }
    if (entry.windowStart + this.windowMs <= now) {
      entry.failures = 0;
      entry.windowStart = now;
    }
    return entry;
  }

  status(key: string): MockLockStatus {
    const entry = this.live(key);
    if (!entry || entry.lockedUntil === 0) return { locked: false };
    return { locked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - this.now()) / 1000) };
  }

  fail(key: string): boolean {
    const now = this.now();
    let entry = this.live(key);
    if (!entry) {
      this.makeRoom();
      entry = { failures: 0, windowStart: now, lockedUntil: 0, locks: 0, lastActivity: now };
      this.entries.set(key, entry);
    }
    if (entry.lockedUntil > 0) return false;
    entry.failures += 1;
    entry.lastActivity = now;
    if (entry.failures >= this.limit) {
      entry.locks += 1;
      entry.lockedUntil = now + this.lockDuration(entry.locks);
      return true;
    }
    return false;
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  reset(): void {
    this.entries.clear();
  }

  private lockDuration(locks: number): number {
    const factor = 2 ** Math.min(locks - 1, 30);
    return Math.min(this.lockMs * factor, this.maxLockMs);
  }

  private makeRoom(): void {
    if (this.entries.size < MAX_KEYS) return;
    for (const key of this.entries.keys()) this.live(key);
    for (const key of this.entries.keys()) {
      if (this.entries.size < MAX_KEYS) break;
      this.entries.delete(key);
    }
  }
}

export class MockLoginGuard {
  private readonly byDni: Counter;
  private readonly byOrigin: Counter;

  constructor(
    config: MockLoginGuardConfig = DEFAULT_MOCK_LOGIN_GUARD_CONFIG,
    now: () => number = Date.now,
  ) {
    this.byDni = new Counter(config.maxAttempts, config.lockMs, config.lockMs, now, config);
    this.byOrigin = new Counter(
      config.originMaxAttempts,
      config.lockMs,
      config.lockMs,
      now,
      config,
    );
  }

  private static dniKey(dni: string): string {
    return dni.trim().toLowerCase().slice(0, 64);
  }

  check(dni: string, origin: string): MockLockStatus {
    const a = this.byDni.status(MockLoginGuard.dniKey(dni));
    const b = this.byOrigin.status(origin);
    if (a.locked && b.locked) return a.retryAfterSeconds >= b.retryAfterSeconds ? a : b;
    return a.locked ? a : b;
  }

  recordFailure(dni: string, origin: string): { dniLocked: boolean; originLocked: boolean } {
    return {
      dniLocked: this.byDni.fail(MockLoginGuard.dniKey(dni)),
      originLocked: this.byOrigin.fail(origin),
    };
  }

  recordSuccess(dni: string): void {
    this.byDni.clear(MockLoginGuard.dniKey(dni));
  }

  /** Solo para tests: descarta todo el estado. */
  reset(): void {
    this.byDni.reset();
    this.byOrigin.reset();
  }
}

/** Instancia que usan los handlers de MSW. */
export const mockLoginGuard = new MockLoginGuard();

/** Solo para tests: deja el guard del mock como recien cargado. */
export function resetMockLoginGuard(): void {
  mockLoginGuard.reset();
}

/** Origen del request: `X-Forwarded-For` si viene, o la clave fija de la demo. */
export function mockRequestOrigin(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || MOCK_CLIENT_ORIGIN;
}
