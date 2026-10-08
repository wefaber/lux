import { describe, expect, test } from "bun:test";
import { mockLocations } from "./data/locations";
import { mockProducts } from "./data/equipment";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";
import type { Location } from "@/lib/types";

useMockServer();

const { TECNICO, SOLICITANTE } = USERS;

const LIST = `query GetLocations { locations { id kind number name code productCount } }`;
const CREATE = `mutation CreateLocation($input: LocationInput!) { createLocation(input: $input) { id name code } }`;
const UPDATE = `mutation UpdateLocation($id: ID!, $input: LocationUpdateInput!) { updateLocation(id: $id, input: $input) { id name code } }`;
const DELETE = `mutation SoftDeleteLocation($id: ID!) { softDeleteLocation(id: $id) }`;
const CREATE_PRODUCT = `mutation CreateProduct($input: ProductInput!) { createProduct(input: $input) { id machineId location } }`;

function location(id: string): Location {
  return mockLocations.find((l) => l.id === id)!;
}

// Salones nuevos con numeros altos y unicos: los datos semilla se comparten entre tests
let seq = 40;
async function newClassroom(): Promise<{ id: string; code: string }> {
  seq++;
  const res = await gqlAs<{ createLocation: { id: string; code: string } }>(TECNICO, CREATE, {
    input: { kind: "classroom", number: seq, name: `Salón ${seq}` },
  });
  expect(res.errors).toBeUndefined();
  return { id: res.data!.createLocation.id, code: res.data!.createLocation.code };
}

function productInput(locationId: string, code: string) {
  return {
    machineId: `${code}-PC1`,
    kind: "Desktop",
    locationId,
    brand: "Lenovo",
    model: "ThinkCentre M70",
    serialNumber: `SN-LOC-${code}-1`,
    partNumber: `PN-LOC-${code}-1`,
    status: "available",
  };
}

describe("#16 consultar ubicaciones", () => {
  test("cualquier usuario las consulta, con su código y la cantidad de equipos", async () => {
    const res = await gqlAs<{ locations: Location[] }>(SOLICITANTE, LIST);
    expect(res.errors).toBeUndefined();
    const lab1 = res.data!.locations.find((l) => l.id === "loc-1")!;
    expect(lab1).toMatchObject({ kind: "laboratory", number: 1, name: "Laboratorio 1", code: "L1" });
    expect(lab1.productCount).toBe(
      mockProducts.filter((p) => p.locationId === "loc-1" && p.deletedAt === null).length,
    );
  });
});

describe("#16 registrar ubicaciones", () => {
  test("el código sale del tipo y el número, y es como se nombran sus equipos", async () => {
    const res = await gqlAs<{ createLocation: { id: string; code: string } }>(TECNICO, CREATE, {
      input: { kind: "laboratory", number: 3, name: "Laboratorio 3" },
    });
    expect(res.errors).toBeUndefined();
    const { id, code } = res.data!.createLocation;
    expect(code).toBe("L3");

    const product = await gqlAs<{ createProduct: { machineId: string; location: string } }>(
      TECNICO,
      CREATE_PRODUCT,
      { input: productInput(id, code) },
    );
    expect(product.errors).toBeUndefined();
    expect(product.data!.createProduct).toMatchObject({
      machineId: "L3-PC1",
      location: "Laboratorio 3",
    });

    // Un equipo del Laboratorio 3 no puede llamarse L1-...
    const wrong = await gqlAs(TECNICO, CREATE_PRODUCT, {
      input: { ...productInput(id, code), machineId: "L1-PC99", serialNumber: "SN-WRONG-1" },
    });
    expect(wrong.errors?.[0].message).toContain('empieza con "L3-"');
  });

  test("no repite tipo + número ni nombre, y valida el número", async () => {
    const dupCode = await gqlAs(TECNICO, CREATE, {
      input: { kind: "laboratory", number: 1, name: "Laboratorio de redes" },
    });
    expect(dupCode.errors?.[0].message).toBe("Ya existe Laboratorio 1 (L1)");
    const dupName = await gqlAs(TECNICO, CREATE, {
      input: { kind: "classroom", number: 30, name: "laboratorio 1" },
    });
    expect(dupName.errors?.[0].message).toBe("Ya existe una ubicación llamada laboratorio 1");
    const bad = await gqlAs(TECNICO, CREATE, {
      input: { kind: "laboratory", number: 0, name: "Laboratorio 0" },
    });
    expect(bad.errors?.[0].message).toContain("Número");
  });

  test("el solicitante no registra, modifica ni elimina ubicaciones", async () => {
    const res = await gqlAs(SOLICITANTE, CREATE, {
      input: { kind: "other", number: 9, name: "Depósito" },
    });
    expect(res.errors?.[0].message).toBe(FORBIDDEN);
    const upd = await gqlAs(SOLICITANTE, UPDATE, { id: "loc-4", input: { name: "Depósito" } });
    expect(upd.errors?.[0].message).toBe(FORBIDDEN);
    expect((await gqlAs(SOLICITANTE, DELETE, { id: "loc-5" })).errors?.[0].message).toBe(
      FORBIDDEN,
    );
  });
});

describe("#16 modificar ubicaciones", () => {
  test("renombrar actualiza el nombre que muestran sus equipos", async () => {
    const res = await gqlAs(TECNICO, UPDATE, {
      id: "loc-2",
      input: { name: "Salón 1 (planta baja)" },
    });
    expect(res.errors).toBeUndefined();
    const products = mockProducts.filter((p) => p.locationId === "loc-2");
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) expect(p.location).toBe("Salón 1 (planta baja)");
    expect(location("loc-2").code).toBe("S1");
  });

  test("no cambia tipo ni número si hay equipos que usan el código en su ID", async () => {
    const res = await gqlAs(TECNICO, UPDATE, { id: "loc-1", input: { number: 4 } });
    expect(res.errors?.[0].message).toContain("No se puede cambiar el tipo ni el número");
    expect(location("loc-1").code).toBe("L1");
  });

  test("sin equipos, cambiar el número cambia el código", async () => {
    const { id } = await newClassroom();
    const res = await gqlAs(TECNICO, UPDATE, { id, input: { number: 77 } });
    expect(res.errors).toBeUndefined();
    expect(location(id).code).toBe("S77");
  });
});

describe("#16 eliminar ubicaciones", () => {
  test("no se elimina una ubicación con equipos", async () => {
    const res = await gqlAs(TECNICO, DELETE, { id: "loc-1" });
    expect(res.errors?.[0].message).toContain("No se puede eliminar");
    expect(location("loc-1").deletedAt).toBeNull();
  });

  test("una vacía se da de baja, deja de listarse y no recibe equipos", async () => {
    const { id, code } = await newClassroom();
    expect((await gqlAs(TECNICO, DELETE, { id })).errors).toBeUndefined();
    expect(location(id).deletedAt).not.toBeNull();

    const list = await gqlAs<{ locations: Array<{ id: string }> }>(TECNICO, LIST);
    expect(list.data!.locations.some((l) => l.id === id)).toBe(false);

    const product = await gqlAs(TECNICO, CREATE_PRODUCT, { input: productInput(id, code) });
    expect(product.errors?.[0].message).toBe("Ubicación inválida");
  });
});
