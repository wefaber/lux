import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AUTH_STORAGE_KEY } from "@/lib/constants";
import { ApiError } from "@/lib/utils";
import {
  OUTBOX_FAILED_KEY,
  OUTBOX_KEY,
  backoffDelay,
  clearFailed,
  enqueue,
  flush,
  getOutboxSnapshot,
  listFailed,
  listOutbox,
  retryNow,
  sendOrQueue,
  type Sender,
} from "./outbox";

// bun no tiene localStorage: se simula uno y se deja como estaba
const g = globalThis as Record<string, unknown>;
let original: PropertyDescriptor | undefined;
let store: Map<string, string>;

function stubStorage(broken = false) {
  store = new Map();
  Object.defineProperty(g, "localStorage", {
    configurable: true,
    value: broken
      ? {
          getItem: () => {
            throw new Error("denied");
          },
          setItem: () => {
            throw new Error("denied");
          },
        }
      : {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
  });
}

function login(id: string | null) {
  if (id) store.set(AUTH_STORAGE_KEY, JSON.stringify({ id }));
  else store.delete(AUTH_STORAGE_KEY);
}

const networkDown: Sender = async () => {
  throw new Error("Failed to fetch");
};
const rejected: Sender = async () => {
  throw new ApiError("No tenés permiso", "FORBIDDEN");
};

const item = (extra: Partial<Parameters<typeof enqueue>[0]> = {}) => ({
  op: "RecordScan",
  query: "mutation RecordScan { x }",
  variables: { input: { machineId: "L1-PC1" } },
  ...extra,
});

beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(g, "localStorage");
  stubStorage();
  login("u1");
  clearFailed();
});

afterEach(() => {
  if (original) Object.defineProperty(g, "localStorage", original);
  else delete g.localStorage;
});

describe("cola", () => {
  test("encola con clientId, usuario e intentos en cero", () => {
    const queued = enqueue(item({ clientId: "abc" }), 1000);
    expect(queued).toMatchObject({
      userId: "u1",
      op: "RecordScan",
      clientId: "abc",
      attempts: 0,
      nextAttemptAt: 1000,
    });
    expect(JSON.parse(store.get(OUTBOX_KEY)!)).toHaveLength(1);
    expect(getOutboxSnapshot().pending).toBe(1);
  });

  test("genera un clientId si no se pasa", () => {
    expect(enqueue(item()).clientId.length).toBeGreaterThan(8);
  });

  test("la misma clave reemplaza al pendiente (autoguardado)", () => {
    enqueue(item({ key: "note:1", variables: { body: "a" } }));
    enqueue(item({ key: "note:1", variables: { body: "ab" } }));
    enqueue(item({ key: "note:2", variables: { body: "x" } }));
    const list = listOutbox();
    expect(list).toHaveLength(2);
    expect(list.find((i) => i.key === "note:1")?.variables).toEqual({ body: "ab" });
  });

  test("storage roto: no lanza y sigue funcionando en memoria", () => {
    stubStorage(true);
    expect(() => enqueue(item())).not.toThrow();
    expect(listOutbox().length).toBeGreaterThan(0);
  });

  test("JSON corrupto se ignora", () => {
    store.set(OUTBOX_KEY, "{no es json");
    expect(listOutbox()).toEqual([]);
  });
});

describe("espera exponencial", () => {
  test("duplica por intento y tiene tope", () => {
    expect(backoffDelay(1)).toBe(2_000);
    expect(backoffDelay(2)).toBe(4_000);
    expect(backoffDelay(3)).toBe(8_000);
    expect(backoffDelay(20)).toBe(5 * 60_000);
  });
});

describe("flush", () => {
  test("envia lo vencido y lo saca de la cola", async () => {
    enqueue(item(), 0);
    const calls: unknown[] = [];
    const sent = await flush(async (_q, v) => {
      calls.push(v);
      return {};
    }, 10);
    expect(sent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(listOutbox()).toHaveLength(0);
  });

  test("sin red: queda en la cola con intentos y proximo intento", async () => {
    enqueue(item(), 0);
    enqueue(item(), 0);
    const sent = await flush(networkDown, 1000);
    expect(sent).toBe(0);
    const [first, second] = listOutbox();
    expect(first.attempts).toBe(1);
    expect(first.nextAttemptAt).toBe(1000 + backoffDelay(1));
    expect(first.lastError).toBe("Failed to fetch");
    // se corta en el primer fallo: el segundo ni se intento
    expect(second.attempts).toBe(0);
  });

  test("no reintenta antes de que venza la espera", async () => {
    enqueue(item(), 0);
    await flush(networkDown, 1000);
    let called = false;
    await flush(async () => {
      called = true;
      return {};
    }, 1500);
    expect(called).toBe(false);
    await flush(async () => ({}), 1000 + backoffDelay(1));
    expect(listOutbox()).toHaveLength(0);
  });

  test("rechazo del servidor: sale de la cola y queda en rechazados", async () => {
    enqueue(item(), 0);
    await flush(rejected, 10);
    expect(listOutbox()).toHaveLength(0);
    expect(listFailed()).toHaveLength(1);
    expect(listFailed()[0].lastError).toContain("permiso");
    expect(store.has(OUTBOX_FAILED_KEY)).toBe(true);
    expect(getOutboxSnapshot().failed).toBe(1);
  });

  test("sesion vencida (UNAUTHENTICATED) se reintenta, no se descarta", async () => {
    enqueue(item(), 0);
    await flush(async () => {
      throw new ApiError("Sesión vencida", "UNAUTHENTICATED");
    }, 10);
    expect(listOutbox()).toHaveLength(1);
    expect(listFailed()).toHaveLength(0);
  });

  test("solo envia lo del usuario actual", async () => {
    enqueue(item(), 0);
    login("u2");
    let called = false;
    await flush(async () => {
      called = true;
      return {};
    }, 10);
    expect(called).toBe(false);
    expect(listOutbox()).toHaveLength(1);
    login("u1");
    expect(await flush(async () => ({}), 10)).toBe(1);
  });

  test("sin sesion no envia nada", async () => {
    enqueue(item(), 0);
    login(null);
    expect(await flush(async () => ({}), 10)).toBe(0);
  });

  test("retryNow ignora la espera", async () => {
    enqueue(item(), 0);
    await flush(networkDown, 1000);
    expect(await retryNow(async () => ({}))).toBe(1);
    expect(listOutbox()).toHaveLength(0);
  });
});

describe("sendOrQueue", () => {
  test("con red devuelve el dato y no encola", async () => {
    const result = await sendOrQueue<{ ok: boolean }>(item(), async () => ({ ok: true }));
    expect(result).toEqual({ status: "sent", data: { ok: true } });
    expect(listOutbox()).toHaveLength(0);
  });

  test("sin red encola conservando el clientId", async () => {
    const result = await sendOrQueue(item({ clientId: "k1" }), networkDown);
    expect(result.status).toBe("queued");
    expect(listOutbox()[0].clientId).toBe("k1");
  });

  test("rechazo del servidor se propaga y no se encola", async () => {
    await expect(sendOrQueue(item(), rejected)).rejects.toBeInstanceOf(ApiError);
    expect(listOutbox()).toHaveLength(0);
  });

  test("un envio directo exitoso descarta la version pendiente de su clave", async () => {
    enqueue(item({ key: "note:1" }));
    await sendOrQueue(item({ key: "note:1" }), async () => ({}));
    expect(listOutbox()).toHaveLength(0);
  });
});
