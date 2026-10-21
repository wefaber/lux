import { describe, expect, test } from "bun:test";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";

useMockServer();
const { ADMIN, TECNICO, SOLICITANTE } = USERS;

interface Envelope<T = unknown> {
  status: number;
  message: string;
  data: T | null;
}

interface ReportRow {
  id: string;
  fingerprint: string;
  message: string;
  occurrences: number;
  status: string;
  role: string | null;
}

const LIST = `query GetErrorReports($status: String) { errorReports(status: $status) { id fingerprint message occurrences status role } }`;
const UPDATE = `mutation UpdateErrorReportStatus($id: ID!, $status: String!) { updateErrorReportStatus(id: $id, status: $status) { id status } }`;
const DRAFT = `query GetGithubIssueDraft($id: ID!) { githubIssueDraft(id: $id) }`;
const CREATE_ISSUE = `mutation CreateGithubIssue($id: ID!) { createGithubIssue(id: $id) { url usedLlm alreadyExisted } }`;

async function postReport(payload: Record<string, unknown>): Promise<Envelope<ReportRow>> {
  const response = await fetch("http://localhost/api/v1/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await response.json()) as Envelope<ReportRow>;
}

async function findReport(fingerprint: string): Promise<ReportRow | undefined> {
  const result = await gqlAs<{ errorReports: ReportRow[] }>(ADMIN, LIST);
  return result.data?.errorReports.find((r) => r.fingerprint === fingerprint);
}

describe("POST /api/v1/errors", () => {
  test("crea el reporte y suma ocurrencias por huella", async () => {
    const fingerprint = "feedfacecafe0001";
    const payload = {
      fingerprint,
      message: "TypeError: undefined is not a function",
      stack: "TypeError: undefined is not a function\n    at Pantalla (src/App.tsx:10:2)",
      route: "/dashboard",
      userAgent: "Mozilla/5.0",
      role: "solicitante",
    };
    const first = await postReport(payload);
    expect(first.status).toBe(201);
    expect(first.data?.occurrences).toBe(1);
    expect(first.data?.status).toBe("new");

    const second = await postReport(payload);
    expect(second.status).toBe(201);
    expect(second.data?.id).toBe(first.data?.id);
    expect(second.data?.occurrences).toBe(2);

    const stored = await findReport(fingerprint);
    expect(stored?.occurrences).toBe(2);
  });

  test("sanea credenciales embebidas antes de guardar", async () => {
    const fingerprint = "feedfacecafe0002";
    const result = await postReport({
      fingerprint,
      message: 'Falló el guardado password="secreto123" token=abc987',
      route: "/dashboard/profile",
      role: "solicitante",
    });
    expect(result.data?.message).not.toContain("secreto123");
    expect(result.data?.message).not.toContain("abc987");
    expect(result.data?.message).toContain("<redacted>");
  });

  test("rechaza un reporte sin mensaje o con huella inválida", async () => {
    const invalid = await fetch("http://localhost/api/v1/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint: "corta", message: "" }),
    });
    expect(invalid.status).toBe(422);
  });
});

describe("consultas y triage del tracker", () => {
  test("el técnico y el solicitante no acceden al listado", async () => {
    const results = await Promise.all([TECNICO, SOLICITANTE].map((user) => gqlAs(user, LIST)));
    for (const result of results) expect(result.errors?.[0].message).toBe(FORBIDDEN);
  });

  test("el admin cambia el estado y la lista filtra por estado", async () => {
    const created = await postReport({
      fingerprint: "feedfacecafe0003",
      message: "Error a resolver",
      route: "/dashboard/tickets",
      role: "tecnico",
    });
    const id = created.data!.id;

    const updated = await gqlAs<{ updateErrorReportStatus: ReportRow }>(ADMIN, UPDATE, {
      id,
      status: "resolved",
    });
    expect(updated.data?.updateErrorReportStatus.status).toBe("resolved");

    const resolved = await gqlAs<{ errorReports: ReportRow[] }>(ADMIN, LIST, { status: "resolved" });
    expect(resolved.data?.errorReports.some((r) => r.id === id)).toBe(true);
    const fresh = await gqlAs<{ errorReports: ReportRow[] }>(ADMIN, LIST, { status: "new" });
    expect(fresh.data?.errorReports.some((r) => r.id === id)).toBe(false);
  });

  test("el técnico no puede cambiar el estado", async () => {
    const created = await postReport({
      fingerprint: "feedfacecafe0004",
      message: "Error sin permiso",
      route: "/dashboard",
    });
    const result = await gqlAs(TECNICO, UPDATE, { id: created.data!.id, status: "triaged" });
    expect(result.errors?.[0].message).toBe(FORBIDDEN);
  });

  test("el borrador del issue está disponible y trae el contexto", async () => {
    const created = await postReport({
      fingerprint: "feedfacecafe0005",
      message: "Error con borrador",
      stack: "Error: x\n    at Foo (src/Foo.tsx:1:1)",
      route: "/admin/issues",
      role: "admin",
    });
    const result = await gqlAs<{ githubIssueDraft: string }>(ADMIN, DRAFT, {
      id: created.data!.id,
    });
    expect(result.data?.githubIssueDraft).toContain("feedfacecafe0005");
    expect(result.data?.githubIssueDraft).toContain("/admin/issues");
    expect(result.data?.githubIssueDraft).toContain("src/Foo.tsx:1:1");
    expect((await gqlAs(TECNICO, DRAFT, { id: created.data!.id })).errors?.[0].message).toBe(
      FORBIDDEN,
    );
  });

  test("sin credenciales, crear el issue explica qué configurar", async () => {
    const created = await postReport({
      fingerprint: "feedfacecafe0006",
      message: "Error sin GitHub",
      route: "/dashboard",
    });
    const result = await gqlAs(ADMIN, CREATE_ISSUE, { id: created.data!.id });
    expect(result.errors?.[0].message).toContain("GITHUB_TOKEN");
    expect(result.errors?.[0].message).toContain("GITHUB_REPO");
  });
});
