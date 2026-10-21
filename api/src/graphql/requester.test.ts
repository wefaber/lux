import { describe, expect, test } from "bun:test";
import type { Loan, Location, Product, Reservation, Ticket, User } from "@/lib/types";
import { MIN_CATEGORY_SAMPLES, requesterAreas, ticketEstimates } from "./requester";

// Pruebas puras de los calculos de #4: no tocan Postgres, reciben las
// colecciones ya cargadas igual que el resolver.

const user = (id: string): User => ({
  id,
  name: id,
  dni: id,
  email: `${id}@iti.edu.uy`,
  role: "solicitante",
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const location = (id: string): Location => ({
  id,
  kind: "laboratory",
  number: 1,
  name: `Laboratorio ${id}`,
  code: id.toUpperCase(),
  productCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
});

const product = (id: string, locationId: string, status: Product["status"]): Product => ({
  id,
  type: "product",
  machineId: id.toUpperCase(),
  kind: "Desktop",
  brand: "Lenovo",
  model: "ThinkCentre",
  serialNumber: `SN-${id}`,
  partNumber: `PN-${id}`,
  status,
  issues: null,
  locationId,
  location: `Laboratorio ${locationId}`,
  components: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
});

const ticket = (overrides: Partial<Ticket> & Pick<Ticket, "id">): Ticket => ({
  title: overrides.id,
  description: "",
  category: "hardware",
  status: "resolved",
  submittedBy: user("u1"),
  assignedTo: null,
  equipmentId: null,
  equipment: null,
  diagnosis: null,
  corrected: null,
  actionsTaken: null,
  createdAt: "2026-01-01T08:00:00Z",
  updatedAt: "2026-01-02T08:00:00Z",
  resolvedAt: "2026-01-02T08:00:00Z",
  attendedAt: "2026-01-01T10:00:00Z",
  rating: null,
  ratedAt: null,
  ...overrides,
});

describe("promedios historicos del area", () => {
  test("atiende y resuelve con los tickets resueltos que tienen fechas", () => {
    const estimates = ticketEstimates([
      ticket({ id: "a" }), // 2 h de atencion, 24 h de resolucion
      ticket({
        id: "b",
        createdAt: "2026-01-01T08:00:00Z",
        attendedAt: "2026-01-02T08:00:00Z",
        resolvedAt: "2026-01-04T08:00:00Z", // 72 h de resolucion
      }),
      ticket({ id: "c", status: "in_progress", resolvedAt: null }), // no cuenta
    ]);
    expect(estimates.sampleSize).toBe(2);
    expect(estimates.toAttendHours).toBe(13);
    expect(estimates.toResolveHours).toBe(48);
  });

  test("una categoria sin muestra suficiente no lleva promedio propio", () => {
    const tickets = [
      ...Array.from({ length: MIN_CATEGORY_SAMPLES }, (_, i) =>
        ticket({ id: `sw-${i}`, category: "software" }),
      ),
      ticket({ id: "net-1", category: "network" }),
      ticket({ id: "net-2", category: "network" }),
    ];
    const estimates = ticketEstimates(tickets);
    expect(estimates.sampleSize).toBe(tickets.length);
    expect(estimates.byCategory.map((c) => c.category)).toEqual(["software"]);
    expect(estimates.toResolveHours).toBe(24); // el promedio general cubre a las dos
  });

  test("sin tickets resueltos no hay promedio", () => {
    const estimates = ticketEstimates([ticket({ id: "x", status: "pending", resolvedAt: null })]);
    expect(estimates.sampleSize).toBe(0);
    expect(estimates.toAttendHours).toBeNull();
    expect(estimates.toResolveHours).toBeNull();
  });
});

describe("areas que usa el solicitante", () => {
  const locations = [location("l1"), location("l2")];
  const products = [
    product("p1", "l1", "available"),
    product("p2", "l1", "in_repair"),
    product("p3", "l2", "in_use"),
  ];

  test("solo entran los lugares de sus propios pedidos", () => {
    // u1 toco l1 por un ticket; u2 toco l2 por un prestamo
    const tickets = [ticket({ id: "t1", equipment: products[0], equipmentId: "p1" })];
    const loans: Loan[] = [
      {
        id: "lo1",
        equipment: products[2],
        user: user("u2"),
        status: "active",
        approvedBy: null,
        deliveredBy: null,
        deliveredAt: null,
        issueDate: "2026-01-01T00:00:00Z",
        returnDate: "2026-01-05T00:00:00Z",
        actualReturnDate: null,
        rejectionReason: null,
        components: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const reservations: Reservation[] = [];

    const areas = requesterAreas("u1", tickets, loans, reservations, locations, products);
    expect(areas.map((a) => a.location.id)).toEqual(["l1"]);
    expect(areas[0]).toMatchObject({
      available: 1,
      inUse: 0,
      inRepair: 1,
      retired: 0,
      openTickets: 0,
    });
    expect(areas[0].location.productCount).toBe(2);
  });

  test("sin actividad propia no hay areas (nunca el inventario completo)", () => {
    const areas = requesterAreas("u1", [], [], [], locations, products);
    expect(areas).toEqual([]);
  });

  test("una reserva de espacio suma su ubicacion", () => {
    const reservations: Reservation[] = [
      {
        id: "r1",
        resourceType: "location",
        equipment: null,
        location: locations[1],
        user: user("u1"),
        purpose: "Clase",
        startsAt: "2026-01-10T10:00:00Z",
        endsAt: "2026-01-10T12:00:00Z",
        status: "approved",
        reviewedBy: null,
        rejectionReason: null,
        cancelledBy: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    const areas = requesterAreas("u1", [], [], reservations, locations, products);
    expect(areas.map((a) => a.location.id)).toEqual(["l2"]);
    expect(areas[0].inUse).toBe(1);
  });
});
