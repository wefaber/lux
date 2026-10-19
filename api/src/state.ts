import type {
  ActivityLog,
  Comment,
  Component,
  Intervention,
  Loan,
  Location,
  Notice,
  Product,
  Reservation,
  ServiceRequest,
  Ticket,
  User,
  UserRole,
} from "@/lib/types";
import { db } from "./db/client";
import * as t from "./db/schema";

export interface PendingSeenRow {
  userId: string;
  section: string;
  seenAt: string;
}

// Estado de la base en objetos del dominio, con las relaciones ya resueltas: los
// resolvers trabajan sobre esta foto igual que los mocks sobre sus arrays.
export interface State {
  users: User[];
  locations: Location[];
  products: Product[];
  components: Component[];
  tickets: Ticket[];
  loans: Loan[];
  services: ServiceRequest[];
  interventions: Intervention[];
  comments: Comment[];
  reservations: Reservation[];
  notices: Notice[];
  activityLogs: ActivityLog[];
  pendingSeen: PendingSeenRow[];
  usersById: Map<string, User>;
  locationsById: Map<string, Location>;
  productsById: Map<string, Product>;
  componentsById: Map<string, Component>;
  ticketsById: Map<string, Ticket>;
  loansById: Map<string, Loan>;
  servicesById: Map<string, ServiceRequest>;
  interventionsById: Map<string, Intervention>;
  commentsById: Map<string, Comment>;
  reservationsById: Map<string, Reservation>;
  noticesById: Map<string, Notice>;
}

export function toUser(row: t.UserRow): User {
  return {
    id: row.id,
    name: row.name,
    dni: row.dni,
    email: row.email,
    role: row.role as UserRole,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toLocation(row: t.LocationRow): Location {
  return {
    id: row.id,
    kind: row.kind as Location["kind"],
    number: row.number,
    name: row.name,
    code: row.code,
    productCount: 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function toComponent(row: t.ComponentRow): Component {
  return {
    id: row.id,
    type: "component",
    name: row.name,
    model: row.model,
    manufacturer: row.manufacturer,
    serialNumber: row.serialNumber,
    partNumber: row.partNumber,
    isFactory: row.isFactory,
    isWorking: row.isWorking,
    productId: row.productId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function toProduct(row: t.ProductRow): Product {
  return {
    id: row.id,
    type: "product",
    machineId: row.machineId,
    kind: row.kind,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serialNumber,
    partNumber: row.partNumber,
    status: row.status as Product["status"],
    issues: row.issues,
    locationId: row.locationId,
    location: row.location,
    components: [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function index<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

export async function loadState(): Promise<State> {
  const [
    userRows,
    locationRows,
    productRows,
    componentRows,
    ticketRows,
    loanRows,
    loanComponentRows,
    serviceRows,
    interventionRows,
    commentRows,
    reservationRows,
    noticeRows,
    logRows,
    pendingRows,
  ] = await Promise.all([
    db.select().from(t.users),
    db.select().from(t.locations),
    db.select().from(t.products),
    db.select().from(t.components),
    db.select().from(t.tickets),
    db.select().from(t.loans),
    db.select().from(t.loanComponents),
    db.select().from(t.serviceRequests),
    db.select().from(t.interventions),
    db.select().from(t.comments),
    db.select().from(t.reservations),
    db.select().from(t.notices),
    db.select().from(t.activityLogs),
    db.select().from(t.pendingSeen),
  ]);

  const users = userRows.map(toUser);
  const locations = locationRows.map(toLocation);
  const components = componentRows.map(toComponent);
  const usersById = index(users);
  const locationsById = index(locations);
  const componentsById = index(components);

  const componentsByProduct = new Map<string, Component[]>();
  for (const c of components) {
    if (!c.productId || c.deletedAt) continue;
    const list = componentsByProduct.get(c.productId);
    if (list) list.push(c);
    else componentsByProduct.set(c.productId, [c]);
  }

  const products = productRows.map((row) => {
    const product = toProduct(row);
    product.components = componentsByProduct.get(product.id) ?? [];
    return product;
  });
  const productsById = index(products);

  const ticketEquipment = (id: string | null): Product | null =>
    id ? (productsById.get(id) ?? null) : null;
  const userById = (id: string | null): User | null => (id ? (usersById.get(id) ?? null) : null);

  const tickets: Ticket[] = ticketRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category as Ticket["category"],
    status: row.status as Ticket["status"],
    submittedBy: userById(row.submittedById)!,
    assignedTo: userById(row.assignedToId),
    equipmentId: row.equipmentId,
    equipment: ticketEquipment(row.equipmentId),
    diagnosis: row.diagnosis,
    corrected: row.corrected,
    actionsTaken: row.actionsTaken,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  }));

  const loanComponentsByLoan = new Map<string, Component[]>();
  for (const link of loanComponentRows) {
    const component = componentsById.get(link.componentId);
    if (!component) continue;
    const list = loanComponentsByLoan.get(link.loanId);
    if (list) list.push(component);
    else loanComponentsByLoan.set(link.loanId, [component]);
  }

  const loans: Loan[] = loanRows.map((row) => ({
    id: row.id,
    equipment: productsById.get(row.equipmentId)!,
    user: usersById.get(row.userId)!,
    status: row.status as Loan["status"],
    approvedBy: userById(row.approvedById),
    deliveredBy: userById(row.deliveredById),
    deliveredAt: row.deliveredAt,
    issueDate: row.issueDate,
    returnDate: row.returnDate,
    actualReturnDate: row.actualReturnDate,
    rejectionReason: row.rejectionReason,
    components: loanComponentsByLoan.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  const services: ServiceRequest[] = serviceRows.map((row) => ({
    id: row.id,
    type: row.type as ServiceRequest["type"],
    status: row.status as ServiceRequest["status"],
    requestedBy: usersById.get(row.requestedById)!,
    assignedTo: userById(row.assignedToId),
    description: row.description,
    labNumber: row.labNumber,
    softwareName: row.softwareName,
    equipmentId: row.equipmentId,
    resolutionText: row.resolutionText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  const interventions: Intervention[] = interventionRows.map((row) => ({
    id: row.id,
    equipmentId: row.equipmentId,
    technician: usersById.get(row.technicianId)!,
    type: row.type as Intervention["type"],
    description: row.description,
    partsReplaced: row.partsReplaced,
    ticketId: row.ticketId,
    performedAt: row.performedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  const comments: Comment[] = commentRows.map((row) => ({
    id: row.id,
    entityType: row.entityType as Comment["entityType"],
    entityId: row.entityId,
    author: usersById.get(row.authorId)!,
    body: row.body,
    createdAt: row.createdAt,
  }));

  const reservations: Reservation[] = reservationRows.map((row) => ({
    id: row.id,
    resourceType: row.resourceType as Reservation["resourceType"],
    equipment: row.equipmentId ? (productsById.get(row.equipmentId) ?? null) : null,
    location: row.locationId ? (locationsById.get(row.locationId) ?? null) : null,
    user: usersById.get(row.userId)!,
    purpose: row.purpose,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status as Reservation["status"],
    reviewedBy: userById(row.reviewedById),
    rejectionReason: row.rejectionReason,
    cancelledBy: userById(row.cancelledById),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  const notices: Notice[] = noticeRows.map((row) => ({
    id: row.id,
    userId: row.userId,
    entityType: row.entityType as Notice["entityType"],
    entityId: row.entityId,
    kind: row.kind as Notice["kind"],
    by: userById(row.byId),
    createdAt: row.createdAt,
  }));

  const activityLogs: ActivityLog[] = logRows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    operation: row.operation,
    entity: row.entity,
    entityId: row.entityId,
    timestamp: row.timestamp,
    details: row.details,
  }));

  return {
    users,
    locations,
    products,
    components,
    tickets,
    loans,
    services,
    interventions,
    comments,
    reservations,
    notices,
    activityLogs,
    pendingSeen: pendingRows.map((r) => ({ userId: r.userId, section: r.section, seenAt: r.seenAt })),
    usersById,
    locationsById,
    productsById,
    componentsById,
    ticketsById: index(tickets),
    loansById: index(loans),
    servicesById: index(services),
    interventionsById: index(interventions),
    commentsById: index(comments),
    reservationsById: index(reservations),
    noticesById: index(notices),
  };
}
