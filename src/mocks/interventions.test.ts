import { describe, expect, test } from "bun:test";
import { mockInterventions } from "./data/interventions";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";
import type { Intervention } from "@/lib/types";

useMockServer();

const { TECNICO, SOLICITANTE } = USERS;

const LIST = `query GetInterventions($equipmentId: ID!) { interventions(equipmentId: $equipmentId) { id type performedAt ticketId technician { id } } }`;
const CREATE = `mutation CreateIntervention($input: InterventionInput!) { createIntervention(input: $input) { id } }`;
const UPDATE = `mutation UpdateIntervention($id: ID!, $input: InterventionUpdateInput!) { updateIntervention(id: $id, input: $input) { id } }`;

function intervention(id: string): Intervention {
  return mockInterventions.find((i) => i.id === id)!;
}

const VALID = {
  equipmentId: "prod-3",
  type: "cleaning",
  description: "Limpieza de filtros y ventiladores del gabinete",
};

async function create(input: Record<string, unknown> = {}) {
  return gqlAs<{ createIntervention: { id: string } }>(TECNICO, CREATE, {
    input: { ...VALID, ...input },
  });
}

describe("#17 registrar intervenciones sobre un equipo", () => {
  test("el técnico registra una intervención sin ticket, a su nombre", async () => {
    const res = await create({ partsReplaced: "Filtro de aire" });
    expect(res.errors).toBeUndefined();
    const created = intervention(res.data!.createIntervention.id);
    expect(created).toMatchObject({
      equipmentId: "prod-3",
      type: "cleaning",
      partsReplaced: "Filtro de aire",
      ticketId: null,
    });
    expect(created.technician.id).toBe(TECNICO);
  });

  test("se puede vincular a un ticket del mismo equipo, no de otro", async () => {
    const ok = await create({ equipmentId: "prod-2", ticketId: "tkt-001" });
    expect(ok.errors).toBeUndefined();
    expect(intervention(ok.data!.createIntervention.id).ticketId).toBe("tkt-001");

    const other = await create({ equipmentId: "prod-3", ticketId: "tkt-001" });
    expect(other.errors?.[0].message).toBe("Ese ticket no corresponde a este equipo");
  });

  test("valida tipo, descripción y fecha", async () => {
    expect((await create({ type: "magia" })).errors?.[0].message).toBe(
      "Elegí el tipo de intervención",
    );
    expect((await create({ description: "corto" })).errors?.[0].message).toContain("mínimo");
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await create({ performedAt: future })).errors?.[0].message).toBe(
      "La fecha no puede ser futura",
    );
  });

  test("el solicitante no registra ni consulta intervenciones", async () => {
    expect((await gqlAs(SOLICITANTE, CREATE, { input: VALID })).errors?.[0].message).toBe(
      FORBIDDEN,
    );
    expect(
      (await gqlAs(SOLICITANTE, LIST, { equipmentId: "prod-1" })).errors?.[0].message,
    ).toBe(FORBIDDEN);
  });
});

describe("#17 consultar y editar intervenciones", () => {
  test("lista las del equipo, de la más reciente a la más vieja", async () => {
    const res = await gqlAs<{ interventions: Intervention[] }>(TECNICO, LIST, {
      equipmentId: "prod-1",
    });
    const dates = res.data!.interventions.map((i) => i.performedAt);
    expect(dates.length).toBeGreaterThanOrEqual(2);
    expect(dates).toEqual(dates.toSorted().toReversed());
  });

  test("la edición cambia lo enviado y conserva equipo y técnico", async () => {
    const id = (await create()).data!.createIntervention.id;
    const res = await gqlAs(TECNICO, UPDATE, {
      id,
      input: { type: "corrective_repair", description: "Se cambió el cooler del procesador" },
    });
    expect(res.errors).toBeUndefined();
    expect(intervention(id)).toMatchObject({
      type: "corrective_repair",
      equipmentId: "prod-3",
      partsReplaced: null,
    });
    expect(intervention(id).technician.id).toBe(TECNICO);
  });
});
