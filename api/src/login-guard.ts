// Bloqueo de login por intentos fallidos (RF-AUTH-007).
//
// - Por documento: LOGIN_MAX_ATTEMPTS fallos (5) dentro de la ventana bloquean ese
//   documento. Se cuenta igual exista o no la cuenta, para que el comportamiento
//   no permita enumerar usuarios.
// - Por IP: un umbral mas alto (LOGIN_IP_MAX_ATTEMPTS, 50) frena el rociado de
//   contrasenas sobre muchas cuentas desde un mismo origen.
// - El bloqueo es incremental: el primero dura LOGIN_LOCK_MINUTES (15), el
//   siguiente el doble y asi hasta LOGIN_LOCK_MAX_MINUTES (60). Un login correcto
//   o un dia sin fallos devuelven la cuenta al bloqueo base, para que un error
//   aislado no quede penalizado para siempre.
//
// Limitacion documentada: el estado vive en memoria del proceso. Se pierde al
// reiniciar y no se comparte entre los dos slots del deploy blue/green ni entre
// instancias. Para varias instancias habria que moverlo a la base o a un cache.

export interface GuardConfig {
  /** Fallos por documento antes del bloqueo. */
  maxAttempts: number;
  /** Fallos por IP antes del bloqueo. */
  ipMaxAttempts: number;
  /** Duracion del primer bloqueo y ventana de conteo, en milisegundos. */
  lockMs: number;
  /** Tope del bloqueo incremental, en milisegundos (default 4x `lockMs`). */
  maxLockMs?: number;
  /** Lapso sin fallos tras el cual la escalada vuelve al bloqueo base (default 24 h). */
  escalationResetMs?: number;
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  maxAttempts: 5,
  ipMaxAttempts: 50,
  lockMs: 15 * 60 * 1000,
  maxLockMs: 60 * 60 * 1000,
  escalationResetMs: 24 * 60 * 60 * 1000,
};

interface Entry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
  /** Bloqueos consecutivos: define el multiplicador del proximo. */
  locks: number;
  /** Ultimo fallo, para olvidar la escalada tras un periodo sin actividad. */
  lastActivity: number;
}

export type GuardStatus = { locked: false } | { locked: true; retryAfterSeconds: number };

// Tope de claves en memoria: un atacante que prueba documentos al azar no puede
// hacer crecer el proceso sin limite.
const MAX_KEYS = 20_000;
const MAX_KEY_LENGTH = 64;

class Counter {
  private entries = new Map<string, Entry>();
  private readonly maxLockMs: number;
  private readonly escalationResetMs: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly lockMs: number,
    private readonly now: () => number,
    config: GuardConfig,
  ) {
    // El reset de escalada nunca puede ser menor que el bloqueo mas largo: si no,
    // la entrada se descartaria con el bloqueo aun vigente.
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
    // Sin fallos recientes la escalada se olvida: vuelve a contar desde el bloqueo base.
    if (now - entry.lastActivity >= this.escalationResetMs) {
      this.entries.delete(key);
      return undefined;
    }
    if (entry.lockedUntil > 0) {
      if (entry.lockedUntil > now) return entry;
      // Vencio el bloqueo: se reinicia la cuenta de fallos, no la escalada.
      entry.lockedUntil = 0;
      entry.failures = 0;
      entry.windowStart = now;
      return entry;
    }
    // Los fallos viejos no se acumulan: fuera de la ventana se empieza de cero.
    if (entry.windowStart + this.windowMs <= now) {
      entry.failures = 0;
      entry.windowStart = now;
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

  /** 15 -> 30 -> 60..., con el tope configurado. */
  private lockDuration(locks: number): number {
    const factor = 2 ** Math.min(locks - 1, 30);
    return Math.min(this.lockMs * factor, this.maxLockMs);
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
    this.byDni = new Counter(config.maxAttempts, config.lockMs, config.lockMs, now, config);
    this.byIp = new Counter(config.ipMaxAttempts, config.lockMs, config.lockMs, now, config);
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

  /** Un login correcto limpia los fallos y la escalada de ese documento (no la IP). */
  recordSuccess(dni: string): void {
    this.byDni.clear(LoginGuard.dniKey(dni));
  }

  /** Solo para tests: descarta todo el estado. */
  reset(): void {
    this.byDni.reset();
    this.byIp.reset();
  }
}
