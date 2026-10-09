import { describe, expect, test } from "bun:test";
import { mockReservations } from "./data/reservations";
import { FORBIDDEN, gqlAs, useMockServer, USERS } from "@/test/graphql";
import type { Reservation } from "@/lib/types";

useMockServer();

const { ADMIN, TECNICO, SOLICITANTE, OTRO_SOLICITANTE } = USERS;

const LIST = `query GetReservations($status: String) { reservations(status: $status) { id status user { id } } }`;
const ONE = `query GetReservation($id: ID!) { reservation(id: $id) { id status } }`;
const CREATE = `mutation CreateReservation($input: ReservationInput!) { createReservation(input: $input) { id status } }`;
const APPROVE = `mutation ApproveReservation($id: ID!) { approveReservation(id: $id) { id status } }`;
const REJECT = `mutation RejectReservation($id: ID!, $reason: String!) { rejectReservation(id: $id, reason: $reason) { id } }`;
const UPDATE = `mutation UpdateReservation($id: ID!, $input: ReservationUpdateInput!) { updateReservation(id: $id, input: $input) { id } }`;
const CANCEL = `mutation CancelReservation($id: ID!) { cancelReservation(id: $id) { id status } }`;

const HOUR = 3_600_000;
// Cada test reserva en su propia franja (dias distintos) para no pisarse
let day = 20;
function slot(hours = 2) {
  day++;
  const start = Date.now() + day * 24 * HOUR;
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + hours * HOUR).toISOString(),
  };
}

function reservation(id: string): Reservation {
  return mockReservations.find((r) => r.id === id)!;
}

async function request(as: string = SOLICITANTE, input: Record<string, unknown> = {}) {
  return gqlAs<{ createReservation: { id: string; status: string } }>(as, CREATE, {
    input: {
      resourceType: "equipment",
      equipmentId: "prod-12",
      purpose: "Evaluación práctica",
      ...slot(),
      ...input,
    },
  });
}

describe("#9 el solicitante pide y sigue sus reservas", () => {
  test("pide una reserva de un equipo y queda pendiente a su nombre", async () => {
    const res = await request();
    expect(res.errors).toBeUndefined();
    const created = reservation(res.data!.createReservation.id);
    expect(created.status).toBe("pending");
    expect(created.user.id).toBe(SOLICITANTE);
    expect(created.equipment?.id).toBe("prod-12");
  });

  test("también puede reservar un espacio", async () => {
    const res = await request(SOLICITANTE, {
      resourceType: "location",
      equipmentId: undefined,
      locationId: "loc-2",
    });
    expect(res.errors).toBeUndefined();
    expect(reservation(res.data!.createReservation.id).location?.id).toBe("loc-2");
  });

  test("ve solo las suyas, con su estado, aunque pida las de otro", async () => {
    await request(OTRO_SOLICITANTE);
    const res = await gqlAs<{ reservations: Array<{ user: { id: string } }> }>(SOLICITANTE, LIST);
    expect(res.data!.reservations.length).toBeGreaterThan(0);
    for (const r of res.data!.reservations) expect(r.user.id).toBe(SOLICITANTE);

    const other = mockReservations.find((r) => r.user.id !== SOLICITANTE)!;
    expect((await gqlAs(SOLICITANTE, ONE, { id: other.id })).errors?.[0].message).toBe(FORBIDDEN);
  });

  test("el staff consulta todas", async () => {
    const res = await gqlAs<{ reservations: Array<{ user: { id: string } }> }>(ADMIN, LIST);
    const owners = new Set(res.data!.reservations.map((r) => r.user.id));
    expect(owners.size).toBeGreaterThan(1);
  });

  test("valida fechas, duración y motivo", async () => {
    const past = new Date(Date.now() - 24 * HOUR).toISOString();
    expect((await request(SOLICITANTE, { startsAt: past })).errors?.[0].message).toBe(
      "La reserva no puede empezar en el pasado",
    );
    const { startsAt } = slot();
    expect((await request(SOLICITANTE, { startsAt, endsAt: startsAt })).errors?.[0].message).toBe(
      "El fin tiene que ser posterior al inicio",
    );
    expect((await request(SOLICITANTE, slot(15 * 24))).errors?.[0].message).toContain(
      "como máximo 14 días",
    );
    expect((await request(SOLICITANTE, { purpose: "x" })).errors?.[0].message).toContain("Motivo");
  });

  test("no se reserva un equipo en reparación ni uno dado de baja", async () => {
    expect((await request(SOLICITANTE, { equipmentId: "prod-2" })).errors?.[0].message).toContain(
      "en reparación",
    );
    expect((await request(SOLICITANTE, { equipmentId: "prod-11" })).errors?.[0].message).toBe(
      "El equipo está dado de baja: no se puede reservar",
    );
  });
});

describe("#9 el staff gestiona las reservas", () => {
  test("aprueba y rechaza (con motivo) las pendientes", async () => {
    const a = (await request()).data!.createReservation.id;
    const approved = await gqlAs(TECNICO, APPROVE, { id: a });
    expect(approved.errors).toBeUndefined();
    expect(reservation(a).status).toBe("approved");
    expect(reservation(a).reviewedBy?.id).toBe(TECNICO);

    const b = (await request()).data!.createReservation.id;
    expect((await gqlAs(TECNICO, REJECT, { id: b, reason: "" })).errors?.[0].message).toContain(
      "motivo",
    );
    await gqlAs(TECNICO, REJECT, { id: b, reason: "Equipo reservado para exámenes" });
    expect(reservation(b)).toMatchObject({
      status: "rejected",
      rejectionReason: "Equipo reservado para exámenes",
    });
    // Una rechazada no se aprueba
    expect((await gqlAs(TECNICO, APPROVE, { id: b })).errors?.[0].message).toContain(
      "No se puede aprobar",
    );
  });

  test("el solicitante no aprueba, no rechaza ni modifica", async () => {
    const id = (await request()).data!.createReservation.id;
    expect((await gqlAs(SOLICITANTE, APPROVE, { id })).errors?.[0].message).toBe(FORBIDDEN);
    expect((await gqlAs(SOLICITANTE, REJECT, { id, reason: "Porque sí" })).errors?.[0].message).toBe(
      FORBIDDEN,
    );
    expect(
      (await gqlAs(SOLICITANTE, UPDATE, { id, input: { purpose: "Otro motivo" } })).errors?.[0]
        .message,
    ).toBe(FORBIDDEN);
  });

  test("modifica fechas y motivo de una pendiente o aprobada", async () => {
    const id = (await request()).data!.createReservation.id;
    const next = slot(3);
    const res = await gqlAs(TECNICO, UPDATE, { id, input: { ...next, purpose: "Clase de repaso" } });
    expect(res.errors).toBeUndefined();
    expect(reservation(id)).toMatchObject({ ...next, purpose: "Clase de repaso" });
  });

  test("no aprueba dos reservas superpuestas del mismo recurso", async () => {
    const range = slot(4);
    const first = (await request(SOLICITANTE, range)).data!.createReservation.id;
    const second = (await request(OTRO_SOLICITANTE, range)).data!.createReservation.id;
    expect((await gqlAs(TECNICO, APPROVE, { id: first })).errors).toBeUndefined();
    const clash = await gqlAs(TECNICO, APPROVE, { id: second });
    expect(clash.errors?.[0].message).toBe(
      `Se superpone con la reserva ${first}, ya aprobada para ese horario`,
    );
    // Y un pedido nuevo en ese horario ya ni se acepta
    expect((await request(SOLICITANTE, range)).errors?.[0].message).toContain("Se superpone");
    // Otro equipo en el mismo horario no choca
    expect((await request(SOLICITANTE, { ...range, equipmentId: "prod-10" })).errors).toBeUndefined();
  });

  test("cancela: el solicitante las suyas antes de empezar; el staff también las en curso", async () => {
    const own = (await request()).data!.createReservation.id;
    expect((await gqlAs(OTRO_SOLICITANTE, CANCEL, { id: own })).errors?.[0].message).toBe(
      FORBIDDEN,
    );
    expect((await gqlAs(SOLICITANTE, CANCEL, { id: own })).errors).toBeUndefined();
    expect(reservation(own)).toMatchObject({ status: "cancelled" });
    expect(reservation(own).cancelledBy?.id).toBe(SOLICITANTE);

    // rsv-001 de la semilla esta en curso
    const active = "rsv-001";
    await gqlAs(ADMIN, LIST);
    expect(reservation(active).status).toBe("active");
    const owner = reservation(active).user.id;
    expect((await gqlAs(owner, CANCEL, { id: active })).errors?.[0].message).toContain(
      "No se puede cancelar",
    );
    expect((await gqlAs(TECNICO, CANCEL, { id: active })).errors).toBeUndefined();
  });
});

describe("#9 el estado avanza durante el ciclo de vida", () => {
  test("aprobada pasa a en curso al empezar y a finalizada al terminar", async () => {
    // rsv-005 de la semilla: aprobada y ya terminada
    await gqlAs(ADMIN, LIST);
    expect(reservation("rsv-005").status).toBe("completed");

    const id = (await request()).data!.createReservation.id;
    await gqlAs(TECNICO, APPROVE, { id });
    const r = reservation(id);
    // Simula el paso del tiempo moviendo la reserva al presente y luego al pasado
    r.startsAt = new Date(Date.now() - HOUR).toISOString();
    r.endsAt = new Date(Date.now() + HOUR).toISOString();
    await gqlAs(ADMIN, LIST);
    expect(r.status).toBe("active");
    r.endsAt = new Date(Date.now() - 1000).toISOString();
    await gqlAs(ADMIN, LIST);
    expect(r.status).toBe("completed");
  });
});
