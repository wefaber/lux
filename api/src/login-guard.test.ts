import { describe, expect, test } from "bun:test";
import { LoginGuard } from "./login-guard";

const MIN = 60_000;

function guardWithClock(config = { maxAttempts: 5, ipMaxAttempts: 50, lockMs: 15 * MIN }) {
  let now = 1_000_000;
  const guard = new LoginGuard(config, () => now);
  return { guard, advance: (ms: number) => (now += ms) };
}

describe("LoginGuard", () => {
  test("bloquea el documento al quinto fallo", () => {
    const { guard } = guardWithClock();
    for (let i = 0; i < 4; i++) {
      expect(guard.recordFailure("11111111", "1.1.1.1").dniLocked).toBe(false);
      expect(guard.check("11111111", "1.1.1.1").locked).toBe(false);
    }
    expect(guard.recordFailure("11111111", "1.1.1.1").dniLocked).toBe(true);
    const status = guard.check("11111111", "1.1.1.1");
    expect(status.locked).toBe(true);
    expect(status.locked && status.retryAfterSeconds).toBe(15 * 60);
  });

  test("el bloqueo vence a los 15 minutos", () => {
    const { guard, advance } = guardWithClock();
    for (let i = 0; i < 5; i++) guard.recordFailure("22222222", "2.2.2.2");
    advance(14 * MIN);
    const status = guard.check("22222222", "2.2.2.2");
    expect(status.locked && status.retryAfterSeconds).toBe(60);
    advance(MIN);
    expect(guard.check("22222222", "2.2.2.2").locked).toBe(false);
  });

  test("un fallo mas con el documento ya bloqueado no extiende el bloqueo ni lo vuelve a disparar", () => {
    const { guard, advance } = guardWithClock();
    for (let i = 0; i < 5; i++) guard.recordFailure("33333333", "3.3.3.3");
    advance(5 * MIN);
    expect(guard.recordFailure("33333333", "3.3.3.3").dniLocked).toBe(false);
    const status = guard.check("33333333", "3.3.3.3");
    expect(status.locked && status.retryAfterSeconds).toBe(10 * 60);
  });

  test("un login correcto limpia los fallos de ese documento", () => {
    const { guard } = guardWithClock();
    for (let i = 0; i < 4; i++) guard.recordFailure("44444444", "4.4.4.4");
    guard.recordSuccess("44444444");
    for (let i = 0; i < 4; i++) guard.recordFailure("44444444", "4.4.4.4");
    expect(guard.check("44444444", "4.4.4.4").locked).toBe(false);
  });

  test("los fallos viejos no se acumulan: la ventana es de 15 minutos", () => {
    const { guard, advance } = guardWithClock();
    for (let i = 0; i < 4; i++) guard.recordFailure("55555555", "5.5.5.5");
    advance(16 * MIN);
    guard.recordFailure("55555555", "5.5.5.5");
    expect(guard.check("55555555", "5.5.5.5").locked).toBe(false);
  });

  test("cuenta igual los documentos que no existen (no permite enumerar cuentas)", () => {
    const { guard } = guardWithClock();
    for (let i = 0; i < 5; i++) guard.recordFailure("99999999", "9.9.9.9");
    expect(guard.check("99999999", "9.9.9.9").locked).toBe(true);
  });

  test("la IP se bloquea con su propio umbral, mas alto, aunque cambie el documento", () => {
    const { guard } = guardWithClock({ maxAttempts: 5, ipMaxAttempts: 8, lockMs: 15 * MIN });
    for (let i = 0; i < 7; i++) guard.recordFailure(`doc-${i}`, "6.6.6.6");
    expect(guard.check("doc-nuevo", "6.6.6.6").locked).toBe(false);
    expect(guard.recordFailure("doc-7", "6.6.6.6").ipLocked).toBe(true);
    expect(guard.check("doc-otro", "6.6.6.6").locked).toBe(true);
    expect(guard.check("doc-otro", "7.7.7.7").locked).toBe(false);
  });

  test("normaliza el documento (espacios y mayusculas) y acota su largo", () => {
    const { guard } = guardWithClock();
    for (let i = 0; i < 5; i++) guard.recordFailure(`  ABC${"x".repeat(200)} `, "8.8.8.8");
    expect(guard.check(`abc${"x".repeat(200)}`, "8.8.8.8").locked).toBe(true);
  });
});
