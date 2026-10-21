import { AUTH_STORAGE_KEY } from "@/lib/constants";
import { buildBrowserReport, isExpectedError, type BrowserErrorReport } from "./error-fingerprint";

// Captura de errores del navegador hacia el issue tracker interno. Nunca manda
// cuerpos de formulario ni credenciales: solo mensaje/stack/route/rol/agente,
// ya saneados y agrupados por huella.

export const ERROR_REPORT_ENDPOINT = "/api/v1/errors";

// Tope por sesion (pestaña) y enfriamiento por huella: un error en un bucle no
// puede inundar la API. El servidor ademas limita por IP.
export const MAX_REPORTS_PER_SESSION = 20;
export const FINGERPRINT_COOLDOWN_MS = 30_000;

// Ruido conocido que no es un defecto de la app
const IGNORED_MESSAGES =
  /^(ResizeObserver loop|Script error\.?$|The play\(\) request was interrupted)/i;

interface TrackerState {
  installed: boolean;
  sent: number;
  lastSent: Map<string, number>;
}

// El estado vive en `window` para sobrevivir a un HMR y no duplicar listeners.
const STATE_KEY = "__luxErrorTracker";
type WindowWithTracker = Window & Record<string, TrackerState | undefined>;

function state(): TrackerState {
  const w = window as unknown as WindowWithTracker;
  w[STATE_KEY] ??= { installed: false, sent: 0, lastSent: new Map() };
  return w[STATE_KEY]!;
}

function readRole(): string {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return "anonymous";
    const parsed = JSON.parse(raw) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : "anonymous";
  } catch {
    return "anonymous";
  }
}

function authHeader(): Record<string, string> {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return {};
    const { token } = JSON.parse(raw) as { token?: unknown };
    return typeof token === "string" && token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function reportPath(): string {
  try {
    // Solo el path: los parametros de la URL pueden llevar datos personales
    return window.location.pathname || "/";
  } catch {
    return "/";
  }
}

function shouldSend(fingerprint: string, now: number): boolean {
  const current = state();
  if (current.sent >= MAX_REPORTS_PER_SESSION) return false;
  const previous = current.lastSent.get(fingerprint);
  if (previous !== undefined && now - previous < FINGERPRINT_COOLDOWN_MS) return false;
  current.lastSent.set(fingerprint, now);
  current.sent += 1;
  return true;
}

function send(payload: BrowserErrorReport): void {
  try {
    void fetch(ERROR_REPORT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify(payload),
      // keepalive deja terminar el POST si la pestaña se cierra o navega
      keepalive: true,
    }).catch(() => {
      // Sin API o sin red: el tracker no interrumpe la app
    });
  } catch {
    // fetch no disponible (tests, entorno raro)
  }
}

/**
 * Registra un error. Es la unica puerta de entrada: el ErrorBoundary, los
 * handlers globales y cualquier catch que quiera reportar usan esta funcion.
 */
export function captureError(error: unknown): void {
  if (typeof window === "undefined") return;
  if (isExpectedError(error)) return;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (IGNORED_MESSAGES.test(message)) return;

  const payload = buildBrowserReport(error, {
    route: reportPath(),
    role: readRole(),
    userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
  });
  if (!shouldSend(payload.fingerprint, Date.now())) return;
  send(payload);
}

function onError(event: ErrorEvent): void {
  // Los errores de carga de recursos (img/script) llegan sin `error`
  if (!event.error) return;
  captureError(event.error);
}

function onRejection(event: PromiseRejectionEvent): void {
  captureError(event.reason);
}

/** Instala los handlers globales una sola vez (idempotente). */
export function installGlobalErrorTracking(): void {
  if (typeof window === "undefined") return;
  const current = state();
  if (current.installed) return;
  current.installed = true;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
}

/** Solo para tests: vuelve a cero el contador y el enfriamiento. */
export function resetErrorTrackerForTests(): void {
  if (typeof window === "undefined") return;
  const current = state();
  current.sent = 0;
  current.lastSent.clear();
}
