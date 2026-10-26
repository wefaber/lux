import { beforeEach, describe, expect, test } from "bun:test";
import { MockLoginGuard, resetMockLoginGuard } from "./login-guard";
import { mockPasswords } from "./data/users";
import { useMockServer } from "@/test/graphql";

const MIN = 60_000;

function guardWithClock(
  config = { maxAttempts: 5, originMaxAttempts: 50, lockMs: 15 * MIN },
) {
  let now = 1_000_000;
  const guard = new MockLoginGuard(config, () => now);
  return { guard, advance: (ms: number) => (now += ms) };
}

describe("MockLoginGuard", () => {
  test("bloquea el documento al quinto fallo con el mismo texto que la API", () => {
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

  test("un login correcto limpia el contador de ese documento", () => {
    const { guard } = guardWithClock();
    for (let i = 0; i < 4; i++) guard.recordFailure("33333333", "3.3.3.3");
    guard.recordSuccess("33333333");
    for (let i = 0; i < 4; i++) guard.recordFailure("33333333", "3.3.3.3");
    expect(guard.check("33333333", "3.3.3.3").locked).toBe(false);
  });

  test("la escalada es 15 -> 30 -> 60 y se queda en el tope", () => {
    const { guard, advance } = guardWithClock();
    const failFive = () => {
      for (let i = 0; i < 5; i++) guard.recordFailure("44444444", "4.4.4.4");
    };

    failFive();
    let status = guard.check("44444444", "4.4.4.4");
    expect(status.locked && status.retryAfterSeconds).toBe(15 * 60);

    advance(15 * MIN);
    failFive();
    status = guard.check("44444444", "4.4.4.4");
    expect(status.locked && status.retryAfterSeconds).toBe(30 * 60);

    advance(30 * MIN);
    failFive();
    status = guard.check("44444444", "4.4.4.4");
    expect(status.locked && status.retryAfterSeconds).toBe(60 * 60);

    advance(60 * MIN);
    failFive();
    status = guard.check("44444444", "4.4.4.4");
    expect(status.locked && status.retryAfterSeconds).toBe(60 * 60);
  });

  test("cuenta igual los documentos que no existen", () => {
    const { guard } = guardWithClock();
    for (let i = 0; i < 5; i++) guard.recordFailure("99999999", "9.9.9.9");
    expect(guard.check("99999999", "9.9.9.9").locked).toBe(true);
  });

  test("el origen se bloquea con su propio umbral, mas alto", () => {
    const { guard } = guardWithClock({ maxAttempts: 5, originMaxAttempts: 8, lockMs: 15 * MIN });
    for (let i = 0; i < 7; i++) guard.recordFailure(`doc-${i}`, "6.6.6.6");
    expect(guard.check("doc-nuevo", "6.6.6.6").locked).toBe(false);
    expect(guard.recordFailure("doc-7", "6.6.6.6").originLocked).toBe(true);
    expect(guard.check("doc-otro", "6.6.6.6").locked).toBe(true);
    expect(guard.check("doc-otro", "7.7.7.7").locked).toBe(false);
  });
});

useMockServer();

const LOGIN = `query Login($dni: String!, $password: String!) { login(dni: $dni, password: $password) { id } }`;

interface LoginResult {
  data?: { login: { id: string } };
  errors?: Array<{
    message: string;
    extensions?: { code?: string; status?: number; retryAfterSeconds?: number };
  }>;
}

// El handler toma el origen de X-Forwarded-For (en el navegador no hay IP real)
function login(dni: string, password: string, origin: string): Promise<LoginResult> {
  return fetch("http://localhost/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": origin },
    body: JSON.stringify({ query: LOGIN, variables: { dni, password } }),
  }).then((res) => res.json() as Promise<LoginResult>);
}

describe("handler Login con bloqueo", () => {
  beforeEach(() => resetMockLoginGuard());

  test("tras cinco fallos responde TOO_MANY_ATTEMPTS con el tiempo restante", async () => {
    const dni = "70000001";
    for (let i = 0; i < 5; i++) {
      const failed = await login(dni, `mal-${i}`, "10.0.0.1");
      expect(failed.errors?.[0].message).toBe("Credenciales inválidas");
      expect(failed.errors?.[0].extensions?.code).toBe("INVALID_CREDENTIALS");
    }
    const blocked = await login(dni, "mal-final", "10.0.0.1");
    expect(blocked.errors?.[0].message).toBe("Credenciales inválidas");
    expect(blocked.errors?.[0].extensions?.code).toBe("TOO_MANY_ATTEMPTS");
    expect(blocked.errors?.[0].extensions?.status).toBe(429);
    expect(blocked.errors?.[0].extensions?.retryAfterSeconds).toBe(15 * 60);
  });

  test("un login correcto limpia los fallos acumulados del documento", async () => {
    const dni = "55667788";
    const password = mockPasswords[dni];
    for (let i = 0; i < 4; i++) {
      expect((await login(dni, `mal-${i}`, "10.0.0.2")).errors).toBeDefined();
    }
    expect((await login(dni, password, "10.0.0.2")).data?.login.id).toBe("u-sol-10");
    // Sin el clear, estos cuatro se sumarian a los anteriores y el proximo ya estaria bloqueado
    for (let i = 0; i < 4; i++) {
      expect((await login(dni, `otra-mal-${i}`, "10.0.0.2")).errors).toBeDefined();
    }
    expect((await login(dni, password, "10.0.0.2")).data?.login.id).toBe("u-sol-10");
  });
});
