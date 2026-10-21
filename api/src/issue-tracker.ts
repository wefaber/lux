import { invalid } from "./errors";
import type { ErrorReport, UserRole } from "./lib/types";

// Logica pura del issue tracker: validacion/saneo del reporte que manda el
// frontend, limite de frecuencia, armado del Markdown para GitHub y los dos
// pasos opcionales (LLM y API de GitHub). Nada de esto toca la base ni el
// contexto del request, asi se puede probar sin Postgres.

export const MAX_FINGERPRINT_LENGTH = 64;
export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_STACK_LENGTH = 16_000;
export const MAX_ROUTE_LENGTH = 500;
export const MAX_USER_AGENT_LENGTH = 500;

const ROLES = new Set<string>(["root_admin", "admin", "tecnico", "solicitante", "anonymous"]);

export interface ErrorReportInput {
  fingerprint: string;
  message: string;
  stack?: string | null;
  route: string;
  userAgent?: string | null;
  role?: string | null;
}

export interface NormalizedErrorReport {
  fingerprint: string;
  message: string;
  stack: string | null;
  route: string;
  userAgent: string | null;
  role: string;
}

// Mismas reglas que el saneo del cliente (src/lib/error-fingerprint.ts): el
// servidor no confia en que el navegador las haya aplicado. Cubre credenciales
// embebidas en mensajes o stacks y direcciones de correo.
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<token>"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <token>"],
  [
    /((?:["']?(?:password|passwd|pwd|token|secret|api[_-]?key|authorization|access[_-]?token|refresh[_-]?token))["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
    "$1<redacted>",
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
];

export function sanitizeText(value: string | null | undefined, max: number): string {
  if (!value) return "";
  let text = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return text.split("\u0000").join("").trim().slice(0, max);
}

/** Valida y recorta el cuerpo de `POST /errors` (o de la mutacion equivalente). */
export function normalizeErrorReport(input: ErrorReportInput): NormalizedErrorReport {
  const fingerprint = (input.fingerprint ?? "").trim();
  if (!/^[a-z0-9]{8,64}$/i.test(fingerprint) || fingerprint.length > MAX_FINGERPRINT_LENGTH) {
    throw invalid("La huella del error no es válida");
  }
  const message = sanitizeText(input.message, MAX_MESSAGE_LENGTH);
  if (!message) throw invalid("El mensaje del error es obligatorio");
  const route = sanitizeText(input.route, MAX_ROUTE_LENGTH) || "/";
  const stack = sanitizeText(input.stack, MAX_STACK_LENGTH) || null;
  const userAgent = sanitizeText(input.userAgent, MAX_USER_AGENT_LENGTH) || null;
  const role = (input.role ?? "anonymous").trim();
  return {
    fingerprint,
    message,
    stack,
    route,
    userAgent,
    // Un rol desconocido se guarda como anonimo: el dato es informativo y no
    // debe poder inyectar texto arbitrario en la UI.
    role: ROLES.has(role) ? role : "anonymous",
  };
}

export interface LimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Ventana deslizante por clave (IP), en memoria. No necesita dependencias. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): LimitDecision {
    this.sweep(now);
    const from = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > from);
    if (recent.length >= this.max) {
      const oldest = recent[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // Las claves sin actividad no se acumulan para siempre (una IP por cliente).
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, hits] of this.hits) {
      if (hits.every((at) => at <= now - this.windowMs)) this.hits.delete(key);
    }
  }
}

export interface IssueDraft {
  title: string;
  body: string;
  usedLlm: boolean;
}

export interface LlmConfig {
  endpoint: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export interface GithubConfig {
  token: string;
  repo: string;
}

function shortMessage(message: string): string {
  const text = message.replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export function issueTitle(report: Pick<ErrorReport, "message">): string {
  return `[Lux] ${shortMessage(report.message)}`;
}

function codeBlock(value: string | null): string {
  // ~~~ evita que un ``` dentro del stack cierre el bloque antes de tiempo
  return ["~~~text", value ?? "(sin stack)", "~~~"].join("\n");
}

/** Plantilla local: siempre disponible, incluso sin LLM ni GitHub. */
export function buildIssueBody(report: ErrorReport): string {
  return [
    "## Contexto",
    "",
    `- **Ruta:** \`${report.route}\``,
    `- **Rol:** ${report.role ?? "anonymous"}`,
    `- **Navegador:** ${report.userAgent ?? "no informado"}`,
    `- **Huella:** \`${report.fingerprint}\``,
    `- **Ocurrencias:** ${report.occurrences}`,
    `- **Primera vez:** ${report.firstSeen}`,
    `- **Última vez:** ${report.lastSeen}`,
    `- **Estado en Lux:** ${report.status}`,
    "",
    "## Pasos para reproducir",
    "",
    `1. Abrir \`${report.route}\` con una sesión del rol indicado.`,
    "2. Repetir la acción que disparó el error.",
    "3. Revisar la consola del navegador y el stack de abajo.",
    "",
    "## Error",
    "",
    "~~~text",
    report.message,
    "~~~",
    "",
    "## Stack",
    "",
    codeBlock(report.stack),
    "",
    "## Entorno",
    "",
    "- Aplicación: Lux (SGRSI)",
    "- Reportado automáticamente por el issue tracker interno.",
    "",
    "_Generado por Lux Issue Tracker._",
  ].join("\n");
}

export function localIssueDraft(report: ErrorReport): IssueDraft {
  return { title: issueTitle(report), body: buildIssueBody(report), usedLlm: false };
}

function llmPrompt(report: ErrorReport, base: IssueDraft): string {
  return [
    "Sos un ingeniero de software senior. A partir del error reportado por un usuario,",
    "redactá un issue de GitHub en Markdown, en español, claro y accionable.",
    "Incluí: resumen, impacto, pasos para reproducir, análisis técnico del stack,",
    "una propuesta de solución concreta (archivos/zonas probables y mitigación) y",
    "una lista de verificación para el arreglo. No inventes datos que no estén abajo.",
    "Respondé SOLO con el Markdown del cuerpo, sin bloques alrededor ni comentarios.",
    "",
    "Datos del reporte:",
    JSON.stringify(
      {
        message: report.message,
        route: report.route,
        role: report.role,
        userAgent: report.userAgent,
        stack: report.stack,
        fingerprint: report.fingerprint,
        occurrences: report.occurrences,
        firstSeen: report.firstSeen,
        lastSeen: report.lastSeen,
        status: report.status,
      },
      null,
      2,
    ),
    "",
    "Borrador base (podés mejorarlo):",
    base.body,
  ].join("\n");
}

function contentFromResponse(raw: string): string | null {
  try {
    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      text?: unknown;
      output_text?: unknown;
      content?: unknown;
    };
    const content =
      json.choices?.[0]?.message?.content ?? json.text ?? json.output_text ?? json.content;
    return typeof content === "string" && content.trim() ? content.trim() : null;
  } catch {
    return raw.trim() || null;
  }
}

/**
 * Pide un borrador mas detallado a un endpoint compatible con chat completions.
 * Cualquier falla (sin configurar, timeout, respuesta rara) devuelve null y el
 * llamador sigue con la plantilla local: el tracker nunca se cae por el LLM.
 */
export async function draftWithLlm(
  report: ErrorReport,
  config: LlmConfig | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!config) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 6000);
  try {
    const response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model ?? "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: "Sos un asistente que redacta issues técnicos." },
          { role: "user", content: llmPrompt(report, localIssueDraft(report)) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      // El status alcanza para diagnosticar; el cuerpo puede traer detalles del
      // proveedor y no se registra.
      console.warn(`[issue-tracker] el LLM respondió ${response.status}; se usa la plantilla local`);
      return null;
    }
    return contentFromResponse(await response.text());
  } catch {
    console.warn("[issue-tracker] el LLM no respondió; se usa la plantilla local");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateIssueDraft(
  report: ErrorReport,
  llm: LlmConfig | null,
  fetchImpl: typeof fetch = fetch,
): Promise<IssueDraft> {
  const base = localIssueDraft(report);
  const body = await draftWithLlm(report, llm, fetchImpl);
  return body ? { ...base, body, usedLlm: true } : base;
}

export interface CreatedIssue {
  url: string;
  number: number;
}

/** Crea el issue con la API REST de GitHub. Los errores no incluyen el token. */
export async function createGithubIssue(
  draft: IssueDraft,
  config: GithubConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedIssue> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${config.repo}/issues`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        "user-agent": "lux-issue-tracker",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ title: draft.title, body: draft.body }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub respondió ${response.status}`);
    const json = (await response.json()) as { html_url?: unknown; number?: unknown };
    if (typeof json.html_url !== "string") throw new Error("GitHub no devolvió el issue creado");
    return {
      url: json.html_url,
      number: typeof json.number === "number" ? json.number : 0,
    };
  } catch (error) {
    // Se conserva solo el motivo corto: nada del request ni de las credenciales.
    const message = error instanceof Error ? error.message : "Error desconocido";
    throw new Error(`No se pudo crear el issue en GitHub: ${message.slice(0, 120)}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Roles que pueden ver y operar el tracker. */
export function canManageIssues(role: string | null | undefined): boolean {
  return role === "admin" || role === "root_admin";
}

export const TRACKER_ROLES: UserRole[] = ["root_admin", "admin"];
