import { describe, expect, test } from "bun:test";
import { mockComponents, mockProducts } from "./data/equipment";
import { mockServices } from "./data/services";
import { gqlAs, useMockServer, USERS } from "@/test/graphql";

useMockServer();

// La API de prueba es la ultima barrera: lo que manda el cliente se valida con
// las mismas reglas que usan los formularios.

const { ADMIN, TECNICO, SOLICITANTE } = USERS;

const CREATE_TICKET = `mutation CreateTicket($input: TicketInput!) { createTicket(input: $input) { id } }`;
const UPDATE_TICKET = `mutation UpdateTicket($id: ID!, $input: TicketUpdateInput!) { updateTicket(id: $id, input: $input) { id } }`;
const CREATE_SERVICE = `mutation CreateServiceRequest($input: ServiceRequestInput!) { createServiceRequest(input: $input) { id } }`;
const UPDATE_SERVICE = `mutation UpdateServiceRequest($id: ID!, $input: ServiceRequestUpdateInput!) { updateServiceRequest(id: $id, input: $input) { id } }`;
const CREATE_PRODUCT = `mutation CreateProduct($input: ProductInput!) { createProduct(input: $input) { id } }`;
const CREATE_LOAN = `mutation CreateLoan($input: LoanInput!) { createLoan(input: $input) { id } }`;

const errorOf = (res: { errors?: Array<{ message: string }> }) => res.errors?.[0].message;
// Un equipo dado de baja propio del test (la semilla no trae ninguno)
function retired() {
  const base = mockProducts.find((p) => p.deletedAt === null)!;
  const product = {
    ...base,
    id: "prod-int-retired",
    machineId: "INT-RET",
    status: "retired" as const,
    deletedAt: new Date().toISOString(),
  };
  mockProducts.push(product);
  return product;
}

describe("tickets", () => {
  const valid = { title: "No enciende", description: "El equipo no prende", category: "hardware" };

  test("se rechazan los vacíos, la categoría inventada y el equipo dado de baja", async () => {
    expect(
      errorOf(await gqlAs(SOLICITANTE, CREATE_TICKET, { input: { ...valid, title: " " } })),
    ).toBe("Título: mínimo 3 caracteres");
    expect(
      errorOf(await gqlAs(SOLICITANTE, CREATE_TICKET, { input: { ...valid, category: "magia" } })),
    ).toBe("Elegí una categoría");
    expect(
      errorOf(
        await gqlAs(SOLICITANTE, CREATE_TICKET, { input: { ...valid, equipmentId: retired().id } }),
      ),
    ).toBe("Equipo no encontrado");
  });

  test("editar valida igual que crear", async () => {
    const res = await gqlAs<{ createTicket: { id: string } }>(SOLICITANTE, CREATE_TICKET, {
      input: valid,
    });
    const id = res.data!.createTicket.id;
    expect(errorOf(await gqlAs(TECNICO, UPDATE_TICKET, { id, input: { title: "" } }))).toBe(
      "Título: mínimo 3 caracteres",
    );
    expect(
      errorOf(await gqlAs(TECNICO, UPDATE_TICKET, { id, input: { equipmentId: "no-existe" } })),
    ).toBe("Equipo no encontrado");
  });
});

describe("solicitudes de servicio", () => {
  async function newService(): Promise<string> {
    const res = await gqlAs<{ createServiceRequest: { id: string } }>(SOLICITANTE, CREATE_SERVICE, {
      input: { type: "other", description: "Revisar enchufes del aula 3" },
    });
    return res.data!.createServiceRequest.id;
  }

  test("se valida el tipo y la descripción", async () => {
    expect(
      errorOf(
        await gqlAs(SOLICITANTE, CREATE_SERVICE, {
          input: { type: "x", description: "Algo útil" },
        }),
      ),
    ).toBe("Elegí el tipo de solicitud");
    expect(
      errorOf(
        await gqlAs(SOLICITANTE, CREATE_SERVICE, { input: { type: "other", description: "" } }),
      ),
    ).toBe("Descripción: mínimo 5 caracteres");
  });

  test("una cerrada no se reabre", async () => {
    const id = await newService();
    await gqlAs(ADMIN, UPDATE_SERVICE, {
      id,
      input: { status: "completed", resolutionText: "Ok" },
    });
    const res = await gqlAs(ADMIN, UPDATE_SERVICE, { id, input: { status: "pending" } });
    expect(errorOf(res)).toBe('No se puede pasar una solicitud de "Completado" a "Pendiente"');
    expect(mockServices.find((s) => s.id === id)!.status).toBe("completed");
  });
});

describe("equipos y préstamos", () => {
  test("un equipo nuevo no nace en uso ni dado de baja", async () => {
    const res = await gqlAs(TECNICO, CREATE_PRODUCT, {
      input: {
        machineId: "L1-PC290",
        kind: "Desktop",
        locationId: "loc-1",
        brand: "Lenovo",
        model: "ThinkCentre M70",
        serialNumber: "SN-INT-1",
        partNumber: "PN-INT-1",
        status: "retired",
      },
    });
    expect(errorOf(res)).toBe("Estado inicial inválido");
  });

  test("un préstamo solo lleva componentes del equipo prestado", async () => {
    const base = mockProducts.find((p) => p.status === "available" && p.deletedAt === null)!;
    const equipment = { ...base, id: "prod-int-1", machineId: "INT-1", components: [] };
    mockProducts.push(equipment);
    const foreign = mockComponents.find((c) => c.productId !== equipment.id && !c.deletedAt)!;
    const res = await gqlAs(SOLICITANTE, CREATE_LOAN, {
      input: {
        equipmentId: equipment.id,
        issueDate: new Date(Date.now() + 3_600_000).toISOString(),
        returnDate: new Date(Date.now() + 86_400_000).toISOString(),
        componentIds: [foreign.id],
      },
    });
    expect(errorOf(res)).toBe("Algún componente no existe o no pertenece a este equipo");
  });
});
