import { AUTH_STORAGE_KEY } from "@/lib/constants";
import { ApiError, gql } from "@/lib/utils";

// Cola de salida offline (#98). Una operacion GraphQL que no se pudo enviar por
// falta de red queda en localStorage (`lux_outbox`) y se reintenta con espera
// exponencial al volver la conexion, al volver a la pestana o por temporizador.
// Sin service worker: MSW ya ocupa ese lugar.
//
// - Idempotencia: cada item lleva su `clientId`, que quien encola mete en el
//   input de la mutacion; el servidor ignora un reintento ya aplicado.
// - `key`: un item nuevo con la misma clave reemplaza al pendiente (autoguardado
//   de una nota: solo importa la ultima version).
// - Un rechazo del servidor (ApiError) no se reintenta: pasa a `lux_outbox_failed`.

export const OUTBOX_KEY = "lux_outbox";
export const OUTBOX_FAILED_KEY = "lux_outbox_failed";

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;
const MAX_FAILED = 20;

export interface OutboxItem {
  id: string;
  /** Usuario que lo genero: otra cuenta en el mismo equipo no lo envia */
  userId: string | null;
  /** Nombre de la operacion GraphQL, para mostrar y depurar */
  op: string;
  query: string;
  variables: Record<string, unknown>;
  clientId: string;
  key: string | null;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError: string | null;
}

export interface FailedItem extends OutboxItem {
  failedAt: number;
}

export type Sender = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

// ── Almacenamiento: localStorage con respaldo en memoria ────────────────────

const memory = new Map<string, string>();

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

function readList<T>(key: string): T[] {
  const raw = readRaw(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, list: T[]): void {
  writeRaw(key, JSON.stringify(list));
  refresh();
}

// ── Estado observable (para useSyncExternalStore) ───────────────────────────

export interface OutboxSnapshot {
  pending: number;
  failed: number;
}

let snapshot: OutboxSnapshot = { pending: 0, failed: 0 };
const listeners = new Set<() => void>();

function refresh(): void {
  const next = {
    pending: readList<OutboxItem>(OUTBOX_KEY).length,
    failed: readList<FailedItem>(OUTBOX_FAILED_KEY).length,
  };
  if (next.pending === snapshot.pending && next.failed === snapshot.failed) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOutboxSnapshot(): OutboxSnapshot {
  return snapshot;
}

// ── Cola ────────────────────────────────────────────────────────────────────

export function newClientId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function currentUserId(): string | null {
  const raw = readRaw(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const { id } = JSON.parse(raw) as { id?: string };
    return id ?? null;
  } catch {
    return null;
  }
}

export function listOutbox(): OutboxItem[] {
  return readList<OutboxItem>(OUTBOX_KEY);
}

export function listFailed(): FailedItem[] {
  return readList<FailedItem>(OUTBOX_FAILED_KEY);
}

export function clearFailed(): void {
  writeList<FailedItem>(OUTBOX_FAILED_KEY, []);
}

export interface EnqueueInput {
  op: string;
  query: string;
  variables: Record<string, unknown>;
  clientId?: string;
  key?: string;
}

export function enqueue(input: EnqueueInput, now = Date.now()): OutboxItem {
  const item: OutboxItem = {
    id: newClientId(),
    userId: currentUserId(),
    op: input.op,
    query: input.query,
    variables: input.variables,
    clientId: input.clientId ?? newClientId(),
    key: input.key ?? null,
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    lastError: null,
  };
  const rest = item.key
    ? listOutbox().filter((i) => i.key !== item.key || i.userId !== item.userId)
    : listOutbox();
  writeList(OUTBOX_KEY, [...rest, item]);
  return item;
}

/** Espera antes del intento n (1 = el primero que fallo): 2 s, 4 s, 8 s... hasta 5 min */
export function backoffDelay(attempts: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
}

/** El servidor respondio y dijo que no: reintentar no cambia nada (salvo sesion vencida) */
export function isPermanentError(err: unknown): boolean {
  return err instanceof ApiError && err.code !== "UNAUTHENTICATED";
}

export type SendResult<T> = { status: "sent"; data: T } | { status: "queued"; item: OutboxItem };

function dropByKey(key: string): void {
  const uid = currentUserId();
  const list = listOutbox();
  const next = list.filter((i) => i.key !== key || i.userId !== uid);
  if (next.length !== list.length) writeList(OUTBOX_KEY, next);
}

// Envia ya; si no hay red (o el servidor no responde) lo deja en la cola. Un
// rechazo del servidor se propaga: no tiene sentido guardarlo.
export async function sendOrQueue<T>(
  input: EnqueueInput,
  send: Sender = gql,
): Promise<SendResult<T>> {
  const clientId = input.clientId ?? newClientId();
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (!offline) {
    try {
      const data = (await send(input.query, input.variables)) as T;
      // Una version pendiente de la misma clave quedo vieja
      if (input.key) dropByKey(input.key);
      return { status: "sent", data };
    } catch (err) {
      if (isPermanentError(err)) throw err;
    }
  }
  return { status: "queued", item: enqueue({ ...input, clientId }) };
}

function replace(id: string, next: OutboxItem | null): void {
  const list = listOutbox();
  writeList(
    OUTBOX_KEY,
    next ? list.map((i) => (i.id === id ? next : i)) : list.filter((i) => i.id !== id),
  );
}

async function runFlush(send: Sender, now: number): Promise<number> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  const uid = currentUserId();
  if (!uid) return 0;
  let sent = 0;
  for (const item of listOutbox()) {
    if (item.userId !== uid || item.nextAttemptAt > now) continue;
    try {
      // Secuencial a proposito: el orden de las operaciones importa
      // oxlint-disable-next-line no-await-in-loop
      await send(item.query, item.variables);
      replace(item.id, null);
      sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isPermanentError(err)) {
        replace(item.id, null);
        const failed: FailedItem = {
          ...item,
          attempts: item.attempts + 1,
          lastError: message,
          failedAt: now,
        };
        writeList(OUTBOX_FAILED_KEY, [...listFailed(), failed].slice(-MAX_FAILED));
        continue;
      }
      const attempts = item.attempts + 1;
      replace(item.id, {
        ...item,
        attempts,
        nextAttemptAt: now + backoffDelay(attempts),
        lastError: message,
      });
      // Sin red, el resto tampoco va a salir: se corta y se espera
      break;
    }
  }
  return sent;
}

let flushing: Promise<number> | null = null;

// Envia los items vencidos del usuario actual, en orden. Devuelve cuantos salieron.
export function flush(send: Sender = gql, now = Date.now()): Promise<number> {
  if (flushing) return flushing;
  flushing = runFlush(send, now).finally(() => {
    flushing = null;
  });
  return flushing;
}

// ── Disparadores del reintento ──────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | undefined;

function schedule(send: Sender): void {
  clearTimeout(timer);
  const uid = currentUserId();
  const due = listOutbox()
    .filter((i) => i.userId === uid)
    .map((i) => i.nextAttemptAt);
  if (due.length === 0) return;
  const wait = Math.max(1_000, Math.min(...due) - Date.now());
  timer = setTimeout(() => void run(send), wait);
}

async function run(send: Sender): Promise<void> {
  await flush(send);
  schedule(send);
}

// Instala los disparadores (conexion, vuelta a la pestana, otra pestana, timer).
// Devuelve la funcion que los quita.
export function startOutbox(send: Sender = gql): () => void {
  if (typeof window === "undefined") return () => {};
  refresh();
  const onOnline = () => void run(send);
  const onVisible = () => {
    if (document.visibilityState === "visible") void run(send);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === OUTBOX_KEY || e.key === OUTBOX_FAILED_KEY) {
      refresh();
      schedule(send);
    }
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("storage", onStorage);
  void run(send);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("storage", onStorage);
  };
}

/** Fuerza un reintento ahora (boton "reintentar"): ignora la espera */
export function retryNow(send: Sender = gql): Promise<number> {
  const uid = currentUserId();
  writeList(
    OUTBOX_KEY,
    listOutbox().map((i) => (i.userId === uid ? { ...i, nextAttemptAt: 0 } : i)),
  );
  return flush(send);
}
