import { describe, expect, test } from "bun:test";
import { mockLocations } from "./data/locations";
import { mockProducts } from "./data/equipment";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";
import type { Location } from "@/lib/types";

useMockServer();

const { TECNICO, SOLICITANTE } = USERS;

const LIST = `query GetLocations { locations { id name code productCount } }`;
const CREATE = `mutation CreateLocation($input: LocationInput!) { createLocation(input: $input) { id name code } }`;
const UPDATE = `mutation UpdateLocation($id: ID!, $input: LocationUpdateInput!) { updateLocation(id: $id, input: $input) { id name code } }`;
const DELETE = `mutation SoftDeleteLocation($id: ID!) { softDeleteLocation(id: $id) }`;
const CREATE_PRODUCT = `mutation CreateProduct($input: ProductInput!) { createProduct(input: $input) { id machineId location } }`;

function location(id: string): Location {
  return mockLocations.find((l) => l.id === id)!;
}

let seq = 0;
// Nombres y codigos unicos por test: los datos semilla se comparten entre tests
async function newLocation(): Promise<{ id: string; code: string }> {
  seq++;
  const code = `Q${String.fromCharCode(64 + seq)}`;
  const res = await gqlAs<{ createLocation: { id: string } }>(TECNICO, CREATE, {
    input: { name: `Aula de prueba ${String.fromCharCode(64 + seq)}`, code },
  });
  expect(res.errors).toBeUndefined();
  return { id: res.data!.createLocation.id, code };
}

describe("#16 consultar ubicaciones", () => {
  test("cualquier usuario las consulta, con la cantidad de equipos de cada una", async () => {
    const res = await gqlAs<{ locations: Array<Location> }>(SOLICITANTE, LIST);
    expect(res.errors).toBeUndefined();
    const lab = res.data!.locations.find((l) => l.id === "loc-1")!;
    expect(lab).toMatchObject({ name: "Laboratorios", code: "L" });
    expect(lab.productCount).toBe(
      mockProducts.filter((p) => p.locationId === "loc-1" && p.deletedAt === null).length,
    );
  });
});

describe("#16 registrar ubicaciones", () => {
  test("el técnico registra una ubicación y ya se le pueden asignar equipos", async () => {
    const { id, code } = await newLocation();
    const res = await gqlAs<{ createProduct: { machineId: string; location: string } }>(
      TECNICO,
      CREATE_PRODUCT,
      {
        input: {
          machineId: `${code}1-PC1`,
          kind: "Desktop",
          locationId: id,
          brand: "Lenovo",
          model: "ThinkCentre M70",
          serialNumber: `SN-LOC-${code}-1`,
          partNumber: `PN-LOC-${code}-1`,
          status: "available",
        },
      },
    );
    expect(res.errors).toBeUndefined();
    expect(res.data!.createProduct.location).toBe(location(id).name);
  });

  test("valida el código y no repite nombre ni código", async () => {
    const bad = await gqlAs(TECNICO, CREATE, { input: { name: "Taller", code: "T1" } });
    expect(bad.errors?.[0].message).toContain("Código");
    const dupName = await gqlAs(TECNICO, CREATE, { input: { name: "laboratorios", code: "ZZ" } });
    expect(dupName.errors?.[0].message).toBe("Ya existe una ubicación llamada laboratorios");
    const dupCode = await gqlAs(TECNICO, CREATE, { input: { name: "Taller nuevo", code: "l" } });
    expect(dupCode.errors?.[0].message).toBe("El código L ya lo usa otra ubicación");
  });

  test("el solicitante no registra ni modifica ubicaciones", async () => {
    const res = await gqlAs(SOLICITANTE, CREATE, { input: { name: "Depósito", code: "DEP" } });
    expect(res.errors?.[0].message).toBe(FORBIDDEN);
    const upd = await gqlAs(SOLICITANTE, UPDATE, { id: "loc-4", input: { name: "Otro" } });
    expect(upd.errors?.[0].message).toBe(FORBIDDEN);
    expect((await gqlAs(SOLICITANTE, DELETE, { id: "loc-4" })).errors?.[0].message).toBe(
      FORBIDDEN,
    );
  });
});

describe("#16 modificar ubicaciones", () => {
  test("renombrar actualiza el nombre que muestran sus equipos", async () => {
    const res = await gqlAs(TECNICO, UPDATE, { id: "loc-2", input: { name: "Salones de clase" } });
    expect(res.errors).toBeUndefined();
    const products = mockProducts.filter((p) => p.locationId === "loc-2");
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) expect(p.location).toBe("Salones de clase");
  });

  test("no cambia el código si hay equipos que lo usan en su ID", async () => {
    const res = await gqlAs(TECNICO, UPDATE, { id: "loc-1", input: { code: "LAB" } });
    expect(res.errors?.[0].message).toContain("No se puede cambiar el código");
    expect(location("loc-1").code).toBe("L");
  });

  test("sin equipos, el código se puede cambiar", async () => {
    const { id } = await newLocation();
    const res = await gqlAs(TECNICO, UPDATE, { id, input: { code: "XYZ" } });
    expect(res.errors).toBeUndefined();
    expect(location(id).code).toBe("XYZ");
  });
});

describe("#16 eliminar ubicaciones", () => {
  test("no se elimina una ubicación con equipos", async () => {
    const res = await gqlAs(TECNICO, DELETE, { id: "loc-1" });
    expect(res.errors?.[0].message).toContain("No se puede eliminar");
    expect(location("loc-1").deletedAt).toBeNull();
  });

  test("una vacía se da de baja, deja de listarse y no recibe equipos", async () => {
    const { id, code } = await newLocation();
    expect((await gqlAs(TECNICO, DELETE, { id })).errors).toBeUndefined();
    expect(location(id).deletedAt).not.toBeNull();

    const list = await gqlAs<{ locations: Array<{ id: string }> }>(TECNICO, LIST);
    expect(list.data!.locations.some((l) => l.id === id)).toBe(false);

    const product = await gqlAs(TECNICO, CREATE_PRODUCT, {
      input: {
        machineId: `${code}1-PC1`,
        kind: "Desktop",
        locationId: id,
        brand: "Lenovo",
        model: "ThinkCentre M70",
        serialNumber: `SN-DEL-${code}-1`,
        partNumber: `PN-DEL-${code}-1`,
        status: "available",
      },
    });
    expect(product.errors?.[0].message).toBe("Ubicación inválida");
  });
});
