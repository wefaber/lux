import { describe, expect, test } from "bun:test";
import {
  buildIssueBody,
  canManageIssues,
  createGithubIssue,
  generateIssueDraft,
  issueTitle,
  normalizeErrorReport,
  sanitizeText,
  SlidingWindowLimiter,
} from "./issue-tracker";
import type { ErrorReport } from "./lib/types";

const report: ErrorReport = {
  id: "err-001",
  fingerprint: "3f9a1c02d4e5b670",
  message: "TypeError: cannot read properties of undefined",
  stack:
    "TypeError: cannot read properties of undefined\n    at InventoryPage (src/features/inventory/InventoryPage.tsx:84:21)",
  route: "/dashboard/inventory",
  userAgent: "Mozilla/5.0 (test)",
  role: "admin",
  firstSeen: "2026-10-18T13:22:10.000Z",
  lastSeen: "2026-10-20T09:14:02.000Z",
  occurrences: 7,
  status: "new",
  githubIssueUrl: null,
  createdAt: "2026-10-18T13:22:10.000Z",
  updatedAt: "2026-10-20T09:14:02.000Z",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("saneo y validacion del reporte", () => {
  test("tapa contrasenas, tokens y correos", () => {
    const text = sanitizeText(
      'Login falló password="secreto123" token=abc123 Bearer eyJhbGciOi.eyJzdWIi.firma ana@escuela.edu.uy',
      500,
    );
    expect(text).not.toContain("secreto123");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("eyJhbGciOi");
    expect(text).not.toContain("ana@escuela.edu.uy");
    expect(text).toContain("<redacted>");
    expect(text).toContain("<token>");
    expect(text).toContain("<email>");
  });

  test("rechaza una huella invalida y normaliza un rol desconocido", () => {
    expect(() =>
      normalizeErrorReport({ fingerprint: "no vale", message: "x", route: "/" }),
    ).toThrow();
    const normalized = normalizeErrorReport({
      fingerprint: "abc12345",
      message: "  boom  ",
      route: "/dashboard",
      role: "inventado",
      stack: "x".repeat(20_000),
    });
    expect(normalized.message).toBe("boom");
    expect(normalized.role).toBe("anonymous");
    expect(normalized.stack?.length).toBe(16_000);
  });
});

describe("limite por IP", () => {
  test("permite hasta el maximo y bloquea con un retry razonable", () => {
    const limiter = new SlidingWindowLimiter(2, 60_000);
    expect(limiter.check("ip", 1_000).allowed).toBe(true);
    expect(limiter.check("ip", 2_000).allowed).toBe(true);
    const blocked = limiter.check("ip", 3_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(limiter.check("otra-ip", 3_000).allowed).toBe(true);
    expect(limiter.check("ip", 61_000).allowed).toBe(true);
  });
});

describe("borrador del issue", () => {
  test("la plantilla local incluye contexto, stack y ocurrencias", () => {
    const body = buildIssueBody(report);
    expect(body).toContain("`/dashboard/inventory`");
    expect(body).toContain(report.fingerprint);
    expect(body).toContain("Ocurrencias:** 7");
    expect(body).toContain("InventoryPage.tsx:84:21");
    expect(issueTitle(report)).toBe("[Lux] TypeError: cannot read properties of undefined");
  });

  test("sin LLM usa la plantilla local", async () => {
    const draft = await generateIssueDraft(report, null, (() => {
      throw new Error("no se debe llamar a fetch");
    }) as unknown as typeof fetch);
    expect(draft.usedLlm).toBe(false);
    expect(draft.body).toBe(buildIssueBody(report));
  });

  test("con LLM usa la respuesta del endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({
        choices: [{ message: { content: "## Resumen\n\nPropuesta de solución." } }],
      });
    }) as unknown as typeof fetch;

    const draft = await generateIssueDraft(
      report,
      { endpoint: "https://llm.local/v1/chat/completions", apiKey: "llave", model: "modelo" },
      fakeFetch,
    );
    expect(draft.usedLlm).toBe(true);
    expect(draft.body).toContain("Propuesta de solución");
    const first = calls[0];
    expect(first?.url).toBe("https://llm.local/v1/chat/completions");
    const headers = (first?.init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer llave");
  });

  test("si el LLM falla vuelve a la plantilla local sin romper", async () => {
    const fakeFetch = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    const draft = await generateIssueDraft(report, { endpoint: "https://llm.local" }, fakeFetch);
    expect(draft.usedLlm).toBe(false);
    expect(draft.body).toBe(buildIssueBody(report));
  });
});

describe("creacion del issue en GitHub", () => {
  test("manda titulo, cuerpo y credenciales a la API de GitHub", async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return jsonResponse({ html_url: "https://github.com/org/repo/issues/12", number: 12 }, 201);
    }) as unknown as typeof fetch;

    const created = await createGithubIssue(
      { title: "Título", body: "Cuerpo", usedLlm: false },
      { token: "ghp_secreto", repo: "org/repo" },
      fakeFetch,
    );
    expect(created).toEqual({ url: "https://github.com/org/repo/issues/12", number: 12 });
    expect(captured!.url).toBe("https://api.github.com/repos/org/repo/issues");
    const headers = captured!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ghp_secreto");
    expect(JSON.parse(String(captured!.init?.body))).toEqual({
      title: "Título",
      body: "Cuerpo",
    });
  });

  test("un fallo de GitHub no filtra el token", async () => {
    const fakeFetch = (async () =>
      jsonResponse({ message: "Bad credentials" }, 401)) as unknown as typeof fetch;
    await expect(
      createGithubIssue(
        { title: "T", body: "B", usedLlm: false },
        { token: "ghp_secreto", repo: "org/repo" },
        fakeFetch,
      ),
    ).rejects.toThrow(/GitHub respondió 401/);
    await expect(
      createGithubIssue(
        { title: "T", body: "B", usedLlm: false },
        { token: "ghp_secreto", repo: "org/repo" },
        fakeFetch,
      ),
    ).rejects.not.toThrow(/ghp_secreto/);
  });
});

describe("permisos del tracker", () => {
  test("solo admin y root_admin gestionan issues", () => {
    expect(canManageIssues("root_admin")).toBe(true);
    expect(canManageIssues("admin")).toBe(true);
    expect(canManageIssues("tecnico")).toBe(false);
    expect(canManageIssues("solicitante")).toBe(false);
    expect(canManageIssues(null)).toBe(false);
  });
});
