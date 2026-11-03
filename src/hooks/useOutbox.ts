import { useSyncExternalStore } from "react";
import {
  clearFailed,
  getOutboxSnapshot,
  retryNow,
  subscribeOutbox,
  type OutboxSnapshot,
} from "@/lib/outbox";

// Pendientes y rechazados de la cola offline (`lux_outbox`)
export function useOutbox(): OutboxSnapshot & {
  retry: () => Promise<number>;
  discardFailed: () => void;
} {
  const snap = useSyncExternalStore(subscribeOutbox, getOutboxSnapshot, getOutboxSnapshot);
  return { ...snap, retry: () => retryNow(), discardFailed: clearFailed };
}
