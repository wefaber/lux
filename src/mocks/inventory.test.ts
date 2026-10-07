import { describe, expect, test } from "bun:test";
import { mockComponents, mockProducts } from "./data/equipment";
import { mockLoans } from "./data/loans";
import { mockTickets } from "./data/tickets";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";

useMockServer();

const { TECNICO, SOLICITANTE } = USERS;

const CREATE = `mutation CreateProduct($input: ProductInput!) { createProduct(input: $input) { id } }`;
const UPDATE = `mutation UpdateProduct($id: ID!, $input: ProductUpdateInput!) { updateProduct(id: $id, input: $input) { id } }`;
const RETIRE = `mutation SoftDeleteProduct($id: ID!) { softDeleteProduct(id: $id) }`;
const UPDATE_COMP = `mutation UpdateComponent($id: ID!, $input: ComponentUpdateInput!) { updateComponent(id: $id, input: $input) { id } }`;
const RETIRE_COMP = `mutation SoftDeleteComponent($id: ID!) { softDeleteComponent(id: $id) }`;
const PRODUCTS = `query GetProducts { products { id } }`;
const TICKETS = `query GetTickets($equipmentId: ID) { tickets(equipmentId: $equipmentId) { id } }`;
const LOANS = `query GetLoans($equipmentId: ID) { loans(equipmentId: $equipmentId) { id } }`;

let seq = 0;
function validInput(overrides: Record<string, unknown> = {}) {
  seq++;
  return {
    machineId: `L9-PC${seq}`,
    kind: "Desktop",
    location: "Laboratorios",
    brand: "Lenovo",
    model: "ThinkCentre M70",
    serialNumber: `SN-TEST-${seq}`,
    partNumber: `PN-${seq}`,
    status: "available",
    ...overrides,
  };
}

async function create(overrides: Record<string, unknown> = {}) {
  return gqlAs<{ createProduct: { id: string } }>(TECNICO, CREATE, {
    input: validInput(overrides),
  });
}

function product(id: string) {
  return mockProducts.find((p) => p.id === id)!;
}

describe("#2 nomenclatura al crear equipos", () => {
  test("acepta un equipo bien nombrado y normaliza mayúsculas", async () => {
    const res = await create({ machineId: " l9-pc99 ", serialNumber: "sn-low-1" });
    expect(res.errors).toBeUndefined();
    const p = product(res.data!.createProduct.id);
    expect(p.machineId).toBe("L9-PC99");
    expect(p.serialNumber).toBe("SN-LOW-1");
  });

  test.each([
    [{ brand: "JJSJS" }, "Marca: no parece un nombre válido"],
    [{ model: "qwerty" }, "Modelo: no parece un nombre válido"],
    [{ machineId: "PC-1" }, "Formato inválido. Ej: L1-PC1"],
    [{ machineId: "S1-PC1" }, 'Un equipo en Laboratorios empieza con "L". Ej: L1-PC1'],
    [{ machineId: "L1-MON1" }, 'Un Desktop usa el código "PC". Ej: L1-PC1'],
    [{ serialNumber: "ABCDEF" }, "N° de serie: tiene que incluir al menos un número"],
  ])("rechaza %p", async (overrides, message) => {
    const before = mockProducts.length;
    const res = await create(overrides);
    expect(res.errors?.[0].message).toBe(message);
    expect(mockProducts.length).toBe(before);
  });

  test("no repite ID de máquina ni n° de serie", async () => {
    const existing = mockProducts.find((p) => p.deletedAt === null)!;
    const dupId = await create({
      machineId: existing.machineId,
      kind: existing.kind,
      location: existing.location,
    });
    expect(dupId.errors?.[0].message).toBe(`Ya existe un equipo con ID ${existing.machineId}`);
    const dupSerial = await create({ serialNumber: existing.serialNumber });
    expect(dupSerial.errors?.[0].message).toBe(
      `Ya existe un equipo con n° de serie ${existing.serialNumber}`,
    );
  });
});

describe("#19 editar equipos", () => {
  test("actualiza solo lo enviado y no pisa el resto", async () => {
    const id = (await create()).data!.createProduct.id;
    const before = { ...product(id) };
    const res = await gqlAs(TECNICO, UPDATE, { id, input: { brand: "HP" } });
    expect(res.errors).toBeUndefined();
    expect(product(id).brand).toBe("HP");
    expect(product(id).model).toBe(before.model);
    expect(product(id).machineId).toBe(before.machineId);
  });

  test("ignora campos que no son editables", async () => {
    const id = (await create()).data!.createProduct.id;
    await gqlAs(TECNICO, UPDATE, {
      id,
      input: { model: "ThinkCentre M90", status: "retired", deletedAt: "2026-01-01", id: "x" },
    });
    expect(product(id).model).toBe("ThinkCentre M90");
    expect(product(id).status).toBe("available");
    expect(product(id).deletedAt).toBeNull();
    expect(product(id).id).toBe(id);
  });

  test("valida la edición igual que el alta", async () => {
    const id = (await create()).data!.createProduct.id;
    const res = await gqlAs(TECNICO, UPDATE, { id, input: { location: "Salones" } });
    expect(res.errors?.[0].message).toContain('Un equipo en Salones empieza con "S"');
  });

  test("el solicitante no edita", async () => {
    const id = (await create()).data!.createProduct.id;
    expect(
      (await gqlAs(SOLICITANTE, UPDATE, { id, input: { brand: "HP" } })).errors?.[0].message,
    ).toBe(FORBIDDEN);
  });

  test("edita componentes", async () => {
    const comp =
      mockComponents.find((c) => c.deletedAt === null && c.productId === null) ?? mockComponents[0];
    const res = await gqlAs(TECNICO, UPDATE_COMP, { id: comp.id, input: { isWorking: false } });
    expect(res.errors).toBeUndefined();
    expect(comp.isWorking).toBe(false);
    const bad = await gqlAs(TECNICO, UPDATE_COMP, { id: comp.id, input: { manufacturer: "aaaa" } });
    expect(bad.errors?.[0].message).toBe("Fabricante: no parece un nombre válido");
  });
});

describe("#20 dar de baja", () => {
  test("da de baja un equipo libre: queda retirado y sale del listado", async () => {
    const id = (await create()).data!.createProduct.id;
    expect((await gqlAs(TECNICO, RETIRE, { id })).errors).toBeUndefined();
    expect(product(id).status).toBe("retired");
    expect(product(id).deletedAt).not.toBeNull();
    const list = await gqlAs<{ products: Array<{ id: string }> }>(TECNICO, PRODUCTS);
    expect(list.data!.products.map((p) => p.id)).not.toContain(id);
  });

  test("bloquea la baja con préstamos en curso", async () => {
    const loan = mockLoans.find((l) => ["active", "overdue"].includes(l.status))!;
    const res = await gqlAs(TECNICO, RETIRE, { id: loan.equipment.id });
    expect(res.errors?.[0].message).toBe(
      "No se puede dar de baja: el equipo tiene préstamos en curso",
    );
    expect(product(loan.equipment.id).deletedAt).toBeNull();
  });

  test("bloquea la baja con tickets abiertos", async () => {
    const busy = new Set(
      mockLoans
        .filter((l) => ["pending", "approved", "active", "overdue"].includes(l.status))
        .map((l) => l.equipment.id),
    );
    const ticket = mockTickets.find(
      (t) => t.status !== "resolved" && t.equipmentId && !busy.has(t.equipmentId),
    )!;
    const res = await gqlAs(TECNICO, RETIRE, { id: ticket.equipmentId });
    expect(res.errors?.[0].message).toBe(
      "No se puede dar de baja: el equipo tiene tickets abiertos",
    );
  });

  test("da de baja un componente y el equipo deja de listarlo", async () => {
    const owner = mockProducts.find(
      (p) =>
        p.components.length > 0 &&
        !mockLoans.some((l) => l.components.some((c) => p.components.some((pc) => pc.id === c.id))),
    )!;
    const comp = owner.components[0];
    expect((await gqlAs(TECNICO, RETIRE_COMP, { id: comp.id })).errors).toBeUndefined();
    expect(comp.deletedAt).not.toBeNull();
    expect(owner.components.map((c) => c.id)).not.toContain(comp.id);
  });

  test("bloquea la baja de un componente prestado", async () => {
    const loan = mockLoans.find(
      (l) =>
        ["pending", "approved", "active", "overdue"].includes(l.status) && l.components.length > 0,
    )!;
    const res = await gqlAs(TECNICO, RETIRE_COMP, { id: loan.components[0].id });
    expect(res.errors?.[0].message).toBe(
      "No se puede dar de baja: el componente está en un préstamo en curso",
    );
  });
});

describe("#18 historial del equipo filtrado en el servidor", () => {
  test("tickets y préstamos de un solo equipo", async () => {
    const id = "prod-1";
    const [ticketsRes, loansRes] = await Promise.all([
      gqlAs<{ tickets: Array<{ id: string }> }>(TECNICO, TICKETS, { equipmentId: id }),
      gqlAs<{ loans: Array<{ id: string }> }>(TECNICO, LOANS, { equipmentId: id }),
    ]);
    const tickets = ticketsRes.data!.tickets.map((x) => x.id);
    const loans = loansRes.data!.loans.map((x) => x.id);
    expect(tickets.toSorted()).toEqual(
      mockTickets
        .filter((t) => t.equipmentId === id)
        .map((t) => t.id)
        .toSorted(),
    );
    expect(loans.toSorted()).toEqual(
      mockLoans
        .filter((l) => l.equipment.id === id)
        .map((l) => l.id)
        .toSorted(),
    );
    expect(loans.length).toBeGreaterThan(0);
  });
});
