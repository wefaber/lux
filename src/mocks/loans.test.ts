import { describe, expect, test } from "bun:test";
import { mockLoans } from "./data/loans";
import { mockProducts } from "./data/equipment";
import type { Loan } from "@/lib/types";
import { gqlAs, useMockServer, USERS } from "@/test/graphql";

// Cada test arma sus propios préstamos sobre equipos propios para no depender
// del orden de ejecución.
useMockServer();

const { ADMIN, TECNICO, SOLICITANTE, OTRO_SOLICITANTE } = USERS;

const CREATE = `mutation CreateLoan($input: LoanInput!) { createLoan(input: $input) { id } }`;
const APPROVE = `mutation ApproveLoan($id: ID!) { approveLoan(id: $id) { id } }`;
const REJECT = `mutation RejectLoan($id: ID!, $reason: String!) { rejectLoan(id: $id, reason: $reason) { id } }`;
const DELIVER = `mutation DeliverLoan($id: ID!) { deliverLoan(id: $id) { id } }`;
const RETURN = `mutation ReturnLoan($id: ID!, $damaged: Boolean, $issues: String) { returnLoan(id: $id, damaged: $damaged, issues: $issues) { id } }`;
const LIST = `query GetLoans($status: String, $userId: ID) { loans(status: $status, userId: $userId) { id } }`;
const GET = `query GetLoan($id: ID!) { loan(id: $id) { id } }`;

function loan(id: string): Loan {
  const found = mockLoans.find((l) => l.id === id);
  if (!found) throw new Error(`Préstamo ${id} no existe`);
  return found;
}

function product(id: string) {
  const found = mockProducts.find((p) => p.id === id);
  if (!found) throw new Error(`Equipo ${id} no existe`);
  return found;
}

// La semilla tiene pocos equipos libres: cada test usa uno propio.
let fixtureSeq = 0;
function freeProductId(): string {
  const base = mockProducts.find((p) => p.status === "available" && p.deletedAt === null)!;
  const id = `prod-test-${++fixtureSeq}`;
  mockProducts.push({ ...base, id, machineId: `TEST-${fixtureSeq}`, status: "available" });
  return id;
}

function futureDates() {
  const issue = new Date(Date.now() + 60 * 60 * 1000);
  const ret = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  return { issueDate: issue.toISOString(), returnDate: ret.toISOString() };
}

async function createLoan(userId: string, input: Record<string, unknown>): Promise<string> {
  const res = await gqlAs<{ createLoan: { id: string } }>(userId, CREATE, {
    input: { ...futureDates(), ...input },
  });
  expect(res.errors).toBeUndefined();
  return res.data!.createLoan.id;
}

describe("#10 el solicitante pide y consulta sus préstamos", () => {
  test("crea un préstamo a su nombre aunque mande otro userId", async () => {
    const id = await createLoan(SOLICITANTE, {
      equipmentId: freeProductId(),
      userId: OTRO_SOLICITANTE,
    });
    expect(loan(id).user.id).toBe(SOLICITANTE);
    expect(loan(id).status).toBe("pending");
  });

  test("solo ve sus préstamos aunque pida los de otro usuario", async () => {
    const res = await gqlAs<{ loans: Array<{ id: string }> }>(SOLICITANTE, LIST, {
      userId: OTRO_SOLICITANTE,
    });
    expect(res.data!.loans.length).toBeGreaterThan(0);
    for (const { id } of res.data!.loans) expect(loan(id).user.id).toBe(SOLICITANTE);
  });

  test("no puede leer el detalle de un préstamo ajeno", async () => {
    const ajeno = mockLoans.find((l) => l.user.id === OTRO_SOLICITANTE)!;
    const res = await gqlAs(SOLICITANTE, GET, { id: ajeno.id });
    expect(res.errors?.[0].message).toBe("No tenés permisos para esta acción");
  });

  test("no puede aprobar, rechazar, entregar ni devolver", async () => {
    const id = await createLoan(SOLICITANTE, { equipmentId: freeProductId() });
    const results = await Promise.all([
      gqlAs(SOLICITANTE, APPROVE, { id }),
      gqlAs(SOLICITANTE, REJECT, { id, reason: "x" }),
      gqlAs(SOLICITANTE, DELIVER, { id }),
      gqlAs(SOLICITANTE, RETURN, { id }),
    ]);
    for (const res of results) {
      expect(res.errors?.[0].message).toBe("No tenés permisos para esta acción");
    }
    expect(loan(id).status).toBe("pending");
  });

  test("sin token no lista préstamos", async () => {
    const res = await gqlAs(null, LIST);
    expect(res.errors?.[0].message).toBe("No autenticado");
  });
});

describe("#11 rechazar una solicitud", () => {
  test("el técnico rechaza con motivo y queda registrado", async () => {
    const id = await createLoan(SOLICITANTE, { equipmentId: freeProductId() });
    const res = await gqlAs(TECNICO, REJECT, { id, reason: "  Equipo reservado para examen  " });
    expect(res.errors).toBeUndefined();
    expect(loan(id).status).toBe("rejected");
    expect(loan(id).rejectionReason).toBe("Equipo reservado para examen");
  });

  test("exige motivo", async () => {
    const id = await createLoan(SOLICITANTE, { equipmentId: freeProductId() });
    const res = await gqlAs(TECNICO, REJECT, { id, reason: "   " });
    expect(res.errors?.[0].message).toBe("Indicá el motivo del rechazo");
    expect(loan(id).status).toBe("pending");
  });

  test("no rechaza un préstamo ya aprobado", async () => {
    const id = await createLoan(SOLICITANTE, { equipmentId: freeProductId() });
    await gqlAs(TECNICO, APPROVE, { id });
    const res = await gqlAs(TECNICO, REJECT, { id, reason: "tarde" });
    expect(res.errors?.[0].message).toBe('No se puede rechazar un préstamo en estado "Aprobado"');
    expect(loan(id).status).toBe("approved");
  });
});

describe("#12 el técnico aprueba", () => {
  test("aprueba un préstamo pendiente", async () => {
    const id = await createLoan(SOLICITANTE, { equipmentId: freeProductId() });
    const res = await gqlAs(TECNICO, APPROVE, { id });
    expect(res.errors).toBeUndefined();
    expect(loan(id).status).toBe("approved");
  });

  test("no aprueba dos préstamos sobre el mismo equipo", async () => {
    const equipmentId = freeProductId();
    const first = await createLoan(SOLICITANTE, { equipmentId });
    const second = await createLoan(OTRO_SOLICITANTE, { equipmentId });
    await gqlAs(TECNICO, APPROVE, { id: first });
    const res = await gqlAs(TECNICO, APPROVE, { id: second });
    expect(res.errors?.[0].message).toBe("El equipo ya está comprometido en otro préstamo");
    expect(loan(second).status).toBe("pending");
  });
});

describe("#13 ciclo de vida completo", () => {
  test("pending → approved → active → returned", async () => {
    const equipmentId = freeProductId();
    const id = await createLoan(SOLICITANTE, { equipmentId });

    expect((await gqlAs(TECNICO, APPROVE, { id })).errors).toBeUndefined();
    expect((await gqlAs(TECNICO, DELIVER, { id })).errors).toBeUndefined();
    expect(loan(id).status).toBe("active");
    expect(loan(id).deliveredBy?.id).toBe(TECNICO);
    expect(loan(id).deliveredAt).not.toBeNull();

    expect((await gqlAs(TECNICO, RETURN, { id })).errors).toBeUndefined();
    expect(loan(id).status).toBe("returned");
    expect(loan(id).actualReturnDate).not.toBeNull();
  });

  test("no se puede devolver lo que nunca se entregó", async () => {
    const id = await createLoan(SOLICITANTE, { equipmentId: freeProductId() });
    await gqlAs(TECNICO, APPROVE, { id });
    const res = await gqlAs(TECNICO, RETURN, { id });
    expect(res.errors?.[0].message).toBe('No se puede devolver un préstamo en estado "Aprobado"');
    expect(loan(id).status).toBe("approved");
  });

  test("no se puede entregar un préstamo sin aprobar", async () => {
    const id = await createLoan(SOLICITANTE, { equipmentId: freeProductId() });
    const res = await gqlAs(TECNICO, DELIVER, { id });
    expect(res.errors?.[0].message).toBe('No se puede entregar un préstamo en estado "Pendiente"');
  });

  test("un préstamo entregado con fecha vencida pasa a overdue y se puede devolver", async () => {
    const equipmentId = freeProductId();
    const id = await createLoan(SOLICITANTE, { equipmentId });
    await gqlAs(TECNICO, APPROVE, { id });
    await gqlAs(TECNICO, DELIVER, { id });
    loan(id).returnDate = new Date(Date.now() - 60_000).toISOString();

    const res = await gqlAs<{ loans: Array<{ id: string }> }>(TECNICO, LIST, {
      status: "overdue",
    });
    expect(res.data!.loans.map((l) => l.id)).toContain(id);

    expect((await gqlAs(TECNICO, RETURN, { id })).errors).toBeUndefined();
    expect(loan(id).status).toBe("returned");
  });

  test("rechaza fechas invertidas", async () => {
    const { issueDate, returnDate } = futureDates();
    const res = await gqlAs(SOLICITANTE, CREATE, {
      input: { equipmentId: freeProductId(), issueDate: returnDate, returnDate: issueDate },
    });
    expect(res.errors?.[0].message).toBe(
      "La fecha de devolución debe ser posterior a la de entrega",
    );
  });
});

describe("#14 trazabilidad de la aprobación", () => {
  test("crear no asigna approvedBy; aprobar registra a quien aprueba", async () => {
    const id = await createLoan(ADMIN, { equipmentId: freeProductId(), userId: SOLICITANTE });
    expect(loan(id).approvedBy).toBeNull();
    expect(loan(id).user.id).toBe(SOLICITANTE);

    await gqlAs(ADMIN, APPROVE, { id });
    expect(loan(id).approvedBy?.id).toBe(ADMIN);
  });

  test("ningún préstamo pendiente de la semilla figura como aprobado", () => {
    for (const l of mockLoans.filter((x) => x.status === "pending")) {
      expect(l.approvedBy).toBeNull();
    }
  });
});

describe("#15 disponibilidad del equipo sincronizada", () => {
  test("entregar pasa el equipo a in_use y devolver lo libera", async () => {
    const equipmentId = freeProductId();
    const id = await createLoan(SOLICITANTE, { equipmentId });
    await gqlAs(TECNICO, APPROVE, { id });
    expect(product(equipmentId).status).toBe("available");

    await gqlAs(TECNICO, DELIVER, { id });
    expect(product(equipmentId).status).toBe("in_use");

    await gqlAs(TECNICO, RETURN, { id });
    expect(product(equipmentId).status).toBe("available");
  });

  test("devolver con falla manda el equipo a reparación con el detalle", async () => {
    const equipmentId = freeProductId();
    const id = await createLoan(SOLICITANTE, { equipmentId });
    await gqlAs(TECNICO, APPROVE, { id });
    await gqlAs(TECNICO, DELIVER, { id });
    await gqlAs(TECNICO, RETURN, { id, damaged: true, issues: "Pantalla rota" });
    expect(product(equipmentId).status).toBe("in_repair");
    expect(product(equipmentId).issues).toBe("Pantalla rota");
  });

  test("no se puede pedir un equipo que no está disponible", async () => {
    const enUso = mockProducts.find((p) => p.status === "in_use" && p.deletedAt === null)!;
    const res = await gqlAs(SOLICITANTE, CREATE, {
      input: { equipmentId: enUso.id, ...futureDates() },
    });
    expect(res.errors?.[0].message).toBe("El equipo no está disponible para préstamo");
  });

  test("availableForLoan excluye equipos ya aprobados para otro préstamo", async () => {
    const equipmentId = freeProductId();
    const query = `query GetProducts($availableForLoan: Boolean) { products(availableForLoan: $availableForLoan) { id } }`;
    const ids = async () =>
      (
        await gqlAs<{ products: Array<{ id: string }> }>(SOLICITANTE, query, {
          availableForLoan: true,
        })
      ).data!.products.map((p) => p.id);

    expect(await ids()).toContain(equipmentId);
    const id = await createLoan(SOLICITANTE, { equipmentId });
    expect(await ids()).toContain(equipmentId);
    await gqlAs(TECNICO, APPROVE, { id });
    expect(await ids()).not.toContain(equipmentId);
  });

  test("la semilla es coherente: todo préstamo entregado tiene su equipo en uso", () => {
    for (const l of mockLoans.filter((x) => x.status === "active" || x.status === "overdue")) {
      expect(l.equipment.status).toBe("in_use");
    }
  });
});
