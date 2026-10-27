import { t } from "@/i18n";
import { ApiError, MocksUnavailableError } from "@/lib/utils";

// Funciones puras del issue tracker: huella estable, saneo y decision de que
// errores vale la pena reportar. Las usan el navegador (error-tracker.ts) y los
// handlers del mock, y se prueban sin DOM ni red.

export const MAX_FP_MESSAGE = 500;
export const MAX_FP_STACK = 8000;
export const MAX_FP_ROUTE = 500;
export const MAX_FP_USER_AGENT = 500;

// Credenciales y datos personales que no deben salir del navegador. El servidor
// aplica las mismas reglas por las dudas (api/src/issue-tracker.ts).
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<token>"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <token>"],
  [
    /((?:["']?(?:password|passwd|pwd|token|secret|api[_-]?key|authorization|access[_-]?token|refresh[_-]?token))["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
    "$1<redacted>",
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
];

/** Recorta y tapa credenciales/correos en un texto que viene de un error. */
export function sanitizeErrorText(value: unknown, max: number): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : safeString(value);
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return text.split("\u0000").join("").trim().slice(0, max);
}

function safeString(value: unknown): string {
  try {
    if (typeof value === "object") {
      const withMessage = value as { message?: unknown };
      if (typeof withMessage.message === "string") return withMessage.message;
      return JSON.stringify(value) ?? "";
    }
    return String(value);
  } catch {
    return "";
  }
}

function normalizeStack(stack: string | undefined): string {
  if (!stack) return "";
  return stack
    .replace(/\r\n?/g, "\n")
    // El origen del dev server cambia entre sesiones: no debe cambiar la huella
    .replace(/https?:\/\/[^\s/)]+/g, "")
    .replace(/[?#][^\s)]*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

// Hash no criptografico (FNV-1a de 32 bits, dos semillas) a 16 hex. Alcanza para
// agrupar errores y no necesita `await` ni Web Crypto.
function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function fingerprintOf(message: unknown, stack?: unknown): string {
  const safeMessage = sanitizeErrorText(message, MAX_FP_MESSAGE).replace(/\s+/g, " ").trim();
  const safeStack = normalizeStack(sanitizeErrorText(stack, MAX_FP_STACK));
  const normalized = `${safeMessage}\n${safeStack}`;
  const a = fnv1a(normalized, 0x811c9dc5);
  const b = fnv1a(normalized, 0x9e3779b9);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

// Errores que la app ya muestra al usuario (validacion, permisos, red caida) no
// son defectos y no deben abrir issues. Un INTERNAL_ERROR si se reporta.
const EXPECTED_API_CODES = new Set([
  "BAD_REQUEST",
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "INVALID_CREDENTIALS",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "TOO_MANY_ATTEMPTS",
]);

const NETWORK_MESSAGE = /^(failed to fetch|networkerror|load failed|fetch failed|network request failed)/i;

export function isExpectedError(error: unknown): boolean {
  if (!error) return true;
  if (error instanceof MocksUnavailableError) return true;
  if (error instanceof ApiError) return EXPECTED_API_CODES.has(error.code ?? "");
  const name = (error as { name?: unknown })?.name;
  if (name === "AbortError") return true;
  const message = error instanceof Error ? error.message : safeString(error);
  return NETWORK_MESSAGE.test(message);
}

/** Payload que espera `POST /api/v1/errors`. */
export interface BrowserErrorReport {
  fingerprint: string;
  message: string;
  stack: string | null;
  route: string;
  userAgent: string | null;
  role: string;
}

export function buildBrowserReport(
  error: unknown,
  options: { route: string; role: string; userAgent?: string | null },
): BrowserErrorReport {
  const message =
    sanitizeErrorText(error instanceof Error ? error.message : error, MAX_FP_MESSAGE) ||
    t("common.unknownError");
  const stack = sanitizeErrorText(
    error instanceof Error ? error.stack : undefined,
    MAX_FP_STACK,
  );
  return {
    fingerprint: fingerprintOf(message, stack),
    message,
    stack: stack || null,
    route: sanitizeErrorText(options.route, MAX_FP_ROUTE) || "/",
    userAgent: sanitizeErrorText(options.userAgent, MAX_FP_USER_AGENT) || null,
    role: options.role,
  };
}
