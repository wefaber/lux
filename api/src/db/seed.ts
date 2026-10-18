import { loadEnv } from "../env";
import { pool, db } from "./client";
import {
  activityLogs,
  comments,
  components,
  interventions,
  loanComponents,
  loans,
  locations,
  notices,
  pendingSeen,
  products,
  reservations,
  serviceRequests,
  tickets,
  users,
} from "./schema";

// Carga el dataset de ejemplo del branch dev en PostgreSQL. Las fechas de las
// fixtures (servicios, prestamos vencidos, reservas) son relativas a la corrida,
// asi que el dashboard siempre tiene datos en los periodos de 7/30/90 dias.
import { mockUsers, mockPasswords } from "./fixtures/data/users";
import { mockProducts, mockComponents } from "./fixtures/data/equipment";
import { mockLocations } from "./fixtures/data/locations";
import { mockTickets } from "./fixtures/data/tickets";
import { mockLoans } from "./fixtures/data/loans";
import { mockServices } from "./fixtures/data/services";
import { mockInterventions } from "./fixtures/data/interventions";
import { mockComments } from "./fixtures/data/comments";
import { mockReservations } from "./fixtures/data/reservations";
import { mockNotices } from "./fixtures/data/notices";
import { mockActivityLogs } from "./fixtures/generators";

async function hashUsers() {
  const rows = [];
  for (const user of mockUsers) {
    const password = mockPasswords[user.dni] ?? "root2026";
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    rows.push({
      id: user.id,
      name: user.name,
      dni: user.dni,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      passwordHash,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }
  return rows;
}

async function seed(): Promise<void> {
  loadEnv();

  // Idempotente: se vacia todo antes de recargar. loan_components depende de loans
  // y components, por eso va primero en el truncado.
  await db.delete(loanComponents);
  await db.delete(notices);
  await db.delete(pendingSeen);
  await db.delete(comments);
  await db.delete(interventions);
  await db.delete(reservations);
  await db.delete(loans);
  await db.delete(tickets);
  await db.delete(serviceRequests);
  await db.delete(components);
  await db.delete(products);
  await db.delete(locations);
  await db.delete(activityLogs);
  await db.delete(users);

  await db.insert(users).values(await hashUsers());

  await db.insert(locations).values(
    mockLocations.map((l) => ({
      id: l.id,
      kind: l.kind,
      number: l.number,
      name: l.name,
      code: l.code,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      deletedAt: l.deletedAt,
    })),
  );

  await db.insert(products).values(
    mockProducts.map((p) => ({
      id: p.id,
      machineId: p.machineId,
      kind: p.kind,
      brand: p.brand,
      model: p.model,
      serialNumber: p.serialNumber,
      partNumber: p.partNumber,
      status: p.status,
      issues: p.issues,
      locationId: p.locationId,
      location: p.location,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      deletedAt: p.deletedAt,
    })),
  );

  await db.insert(components).values(
    mockComponents.map((c) => ({
      id: c.id,
      name: c.name,
      model: c.model,
      manufacturer: c.manufacturer,
      serialNumber: c.serialNumber,
      partNumber: c.partNumber,
      isFactory: c.isFactory,
      isWorking: c.isWorking,
      productId: c.productId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      deletedAt: c.deletedAt,
    })),
  );

  await db.insert(tickets).values(
    mockTickets.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      category: t.category,
      status: t.status,
      submittedById: t.submittedBy.id,
      assignedToId: t.assignedTo?.id ?? null,
      equipmentId: t.equipmentId,
      diagnosis: t.diagnosis,
      corrected: t.corrected,
      actionsTaken: t.actionsTaken,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      resolvedAt: t.resolvedAt,
    })),
  );

  await db.insert(loans).values(
    mockLoans.map((l) => ({
      id: l.id,
      equipmentId: l.equipment.id,
      userId: l.user.id,
      status: l.status,
      approvedById: l.approvedBy?.id ?? null,
      deliveredById: l.deliveredBy?.id ?? null,
      deliveredAt: l.deliveredAt,
      issueDate: l.issueDate,
      returnDate: l.returnDate,
      actualReturnDate: l.actualReturnDate,
      rejectionReason: l.rejectionReason,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    })),
  );

  const loanComponentRows = mockLoans.flatMap((l) =>
    l.components.map((c) => ({ loanId: l.id, componentId: c.id })),
  );
  if (loanComponentRows.length > 0) await db.insert(loanComponents).values(loanComponentRows);

  await db.insert(serviceRequests).values(
    mockServices.map((s) => ({
      id: s.id,
      type: s.type,
      status: s.status,
      requestedById: s.requestedBy.id,
      assignedToId: s.assignedTo?.id ?? null,
      description: s.description,
      labNumber: s.labNumber,
      softwareName: s.softwareName,
      equipmentId: s.equipmentId,
      resolutionText: s.resolutionText,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  );

  await db.insert(interventions).values(
    mockInterventions.map((i) => ({
      id: i.id,
      equipmentId: i.equipmentId,
      technicianId: i.technician.id,
      type: i.type,
      description: i.description,
      partsReplaced: i.partsReplaced,
      ticketId: i.ticketId,
      performedAt: i.performedAt,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    })),
  );

  await db.insert(comments).values(
    mockComments.map((c) => ({
      id: c.id,
      entityType: c.entityType,
      entityId: c.entityId,
      authorId: c.author.id,
      body: c.body,
      createdAt: c.createdAt,
    })),
  );

  await db.insert(reservations).values(
    mockReservations.map((r) => ({
      id: r.id,
      resourceType: r.resourceType,
      equipmentId: r.equipment?.id ?? null,
      locationId: r.location?.id ?? null,
      userId: r.user.id,
      purpose: r.purpose,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      status: r.status,
      reviewedById: r.reviewedBy?.id ?? null,
      rejectionReason: r.rejectionReason,
      cancelledById: r.cancelledBy?.id ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  );

  await db.insert(notices).values(
    mockNotices.map((n) => ({
      id: n.id,
      userId: n.userId,
      entityType: n.entityType,
      entityId: n.entityId,
      kind: n.kind,
      byId: n.by?.id ?? null,
      createdAt: n.createdAt,
    })),
  );

  await db.insert(activityLogs).values(
    mockActivityLogs.map((l) => ({
      id: l.id,
      userId: l.userId,
      userName: l.userName,
      operation: l.operation,
      entity: l.entity,
      entityId: l.entityId,
      timestamp: l.timestamp,
      details: l.details,
    })),
  );
}

const counts = async () => {
  const [u, l, p, c, t, ln, s, i, cm, r, n, a] = await Promise.all([
    db.select().from(users),
    db.select().from(locations),
    db.select().from(products),
    db.select().from(components),
    db.select().from(tickets),
    db.select().from(loans),
    db.select().from(serviceRequests),
    db.select().from(interventions),
    db.select().from(comments),
    db.select().from(reservations),
    db.select().from(notices),
    db.select().from(activityLogs),
  ]);
  return `users=${u.length} locations=${l.length} products=${p.length} components=${c.length} tickets=${t.length} loans=${ln.length} services=${s.length} interventions=${i.length} comments=${cm.length} reservations=${r.length} notices=${n.length} activityLogs=${a.length}`;
};

try {
  await seed();
  console.log(`Seed completo: ${await counts()}`);
} catch (error) {
  console.error("Seed falló:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
