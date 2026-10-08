import { describe, expect, test } from "bun:test";
import { mockServices } from "./data/services";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";

useMockServer();

const { TECNICO, SOLICITANTE } = USERS;

const CREATE = `mutation CreateServiceRequest($input: ServiceRequestInput!) { createServiceRequest(input: $input) { id } }`;
const CLAIM = `mutation ClaimServiceRequest($id: ID!) { claimServiceRequest(id: $id) { id } }`;
const ASSIGN = `mutation AssignServiceRequest($id: ID!, $technicianId: ID!) { assignServiceRequest(id: $id, technicianId: $technicianId) { id } }`;
const UPDATE = `mutation UpdateServiceRequest($id: ID!, $input: ServiceRequestUpdateInput!) { updateServiceRequest(id: $id, input: $input) { id } }`;

// Ids de la semilla, tomados antes de que los tests creen solicitudes nuevas
// (las nuevas tienen el mismo formato svc-NNN, asi que no se distinguen por el id)
const SEED_IDS = new Set(mockServices.map((s) => s.id));

function service(id: string) {
  return mockServices.find((s) => s.id === id)!;
}

async function newService(): Promise<string> {
  const res = await gqlAs<{ createServiceRequest: { id: string } }>(SOLICITANTE, CREATE, {
    input: {
      type: "software_installation",
      description: "Instalar Python",
      softwareName: "Python",
    },
  });
  expect(res.errors).toBeUndefined();
  return res.data!.createServiceRequest.id;
}

describe("#25 tomar y asignar solicitudes de servicio", () => {
  test("una solicitud nueva nace sin responsable", async () => {
    expect(service(await newService()).assignedTo).toBeNull();
  });

  test("las solicitudes nuevas siguen la numeración correlativa", async () => {
    const [a, b] = [await newService(), await newService()];
    expect(a).toMatch(/^svc-\d{3}$/);
    expect(Number(b.slice(4))).toBe(Number(a.slice(4)) + 1);
    expect(new Set(mockServices.map((s) => s.id)).size).toBe(mockServices.length);
  });

  test("el técnico la toma y nadie más puede tomarla", async () => {
    const id = await newService();
    expect((await gqlAs(TECNICO, CLAIM, { id })).errors).toBeUndefined();
    expect(service(id).assignedTo?.id).toBe(TECNICO);
    const again = await gqlAs("u-tec-2", CLAIM, { id });
    expect(again.errors?.[0].message).toBe("La solicitud ya la tomó Nicolás Ferreira");
  });

  test("se reasigna a otro técnico pero no a un solicitante", async () => {
    const id = await newService();
    await gqlAs(TECNICO, CLAIM, { id });
    expect((await gqlAs(TECNICO, ASSIGN, { id, technicianId: "u-tec-2" })).errors).toBeUndefined();
    expect(service(id).assignedTo?.id).toBe("u-tec-2");
    const bad = await gqlAs(TECNICO, ASSIGN, { id, technicianId: SOLICITANTE });
    expect(bad.errors?.[0].message).toBe("Solo se puede asignar a personal técnico");
  });

  test("una solicitud cerrada no se toma ni se asigna", async () => {
    const id = await newService();
    await gqlAs(TECNICO, UPDATE, { id, input: { status: "completed", resolutionText: "Listo" } });
    expect((await gqlAs(TECNICO, CLAIM, { id })).errors?.[0].message).toBe(
      "La solicitud ya está cerrada",
    );
    expect((await gqlAs(TECNICO, ASSIGN, { id, technicianId: TECNICO })).errors?.[0].message).toBe(
      "La solicitud ya está cerrada",
    );
  });

  test("el solicitante no toma ni asigna", async () => {
    const id = await newService();
    expect((await gqlAs(SOLICITANTE, CLAIM, { id })).errors?.[0].message).toBe(FORBIDDEN);
    expect(
      (await gqlAs(SOLICITANTE, ASSIGN, { id, technicianId: TECNICO })).errors?.[0].message,
    ).toBe(FORBIDDEN);
  });

  test("avanzar una solicitud sin responsable la asigna a quien la mueve", async () => {
    const id = await newService();
    await gqlAs(TECNICO, UPDATE, { id, input: { status: "in_progress" } });
    expect(service(id).assignedTo?.id).toBe(TECNICO);
  });

  test("la semilla tiene responsable en las solicitudes en curso y no en las pendientes", () => {
    for (const s of mockServices.filter((x) => SEED_IDS.has(x.id))) {
      if (["approved", "in_progress", "completed"].includes(s.status)) {
        expect(s.assignedTo).not.toBeNull();
      }
      if (s.status === "pending") expect(s.assignedTo).toBeNull();
    }
  });
});
