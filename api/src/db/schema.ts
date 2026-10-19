import { boolean, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

// Timestamps: se guardan como texto ISO-8601 UTC. El contrato GraphQL los expone
// como String y el frontend los ordena con localeCompare / los parsea con
// new Date(); el texto ISO es ordenable y evita conversiones de zona horaria.
const createdAt = text("created_at").notNull();
const updatedAt = text("updated_at").notNull();

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dni: text("dni").notNull().unique(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  passwordHash: text("password_hash").notNull(),
  createdAt,
  updatedAt,
});

export const locations = pgTable(
  "locations",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    createdAt,
    updatedAt,
    deletedAt: text("deleted_at"),
  },
  (t) => [index("locations_code_idx").on(t.code)],
);

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    machineId: text("machine_id").notNull(),
    kind: text("kind").notNull(),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    serialNumber: text("serial_number").notNull(),
    partNumber: text("part_number").notNull(),
    status: text("status").notNull(),
    issues: text("issues"),
    locationId: text("location_id").notNull(),
    location: text("location").notNull(),
    createdAt,
    updatedAt,
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("products_location_idx").on(t.locationId),
    index("products_status_idx").on(t.status),
  ],
);

export const components = pgTable(
  "components",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    model: text("model").notNull(),
    manufacturer: text("manufacturer").notNull(),
    serialNumber: text("serial_number").notNull(),
    partNumber: text("part_number").notNull(),
    isFactory: boolean("is_factory").notNull(),
    isWorking: boolean("is_working").notNull(),
    productId: text("product_id"),
    createdAt,
    updatedAt,
    deletedAt: text("deleted_at"),
  },
  (t) => [index("components_product_idx").on(t.productId)],
);

export const tickets = pgTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull(),
    submittedById: text("submitted_by_id").notNull(),
    assignedToId: text("assigned_to_id"),
    equipmentId: text("equipment_id"),
    diagnosis: text("diagnosis"),
    corrected: boolean("corrected"),
    actionsTaken: text("actions_taken"),
    createdAt,
    updatedAt,
    resolvedAt: text("resolved_at"),
  },
  (t) => [
    index("tickets_status_idx").on(t.status),
    index("tickets_submitted_by_idx").on(t.submittedById),
    index("tickets_assigned_to_idx").on(t.assignedToId),
  ],
);

export const loans = pgTable(
  "loans",
  {
    id: text("id").primaryKey(),
    equipmentId: text("equipment_id").notNull(),
    userId: text("user_id").notNull(),
    status: text("status").notNull(),
    approvedById: text("approved_by_id"),
    deliveredById: text("delivered_by_id"),
    deliveredAt: text("delivered_at"),
    issueDate: text("issue_date").notNull(),
    returnDate: text("return_date").notNull(),
    actualReturnDate: text("actual_return_date"),
    rejectionReason: text("rejection_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [index("loans_user_idx").on(t.userId), index("loans_status_idx").on(t.status)],
);

export const loanComponents = pgTable(
  "loan_components",
  {
    loanId: text("loan_id").notNull(),
    componentId: text("component_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.loanId, t.componentId] })],
);

export const serviceRequests = pgTable(
  "service_requests",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    requestedById: text("requested_by_id").notNull(),
    assignedToId: text("assigned_to_id"),
    description: text("description").notNull(),
    labNumber: text("lab_number"),
    softwareName: text("software_name"),
    equipmentId: text("equipment_id"),
    resolutionText: text("resolution_text"),
    createdAt,
    updatedAt,
  },
  (t) => [index("services_status_idx").on(t.status)],
);

export const interventions = pgTable(
  "interventions",
  {
    id: text("id").primaryKey(),
    equipmentId: text("equipment_id").notNull(),
    technicianId: text("technician_id").notNull(),
    type: text("type").notNull(),
    description: text("description").notNull(),
    partsReplaced: text("parts_replaced"),
    ticketId: text("ticket_id"),
    performedAt: text("performed_at").notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [index("interventions_equipment_idx").on(t.equipmentId)],
);

export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    createdAt,
  },
  (t) => [index("comments_entity_idx").on(t.entityType, t.entityId)],
);

export const reservations = pgTable(
  "reservations",
  {
    id: text("id").primaryKey(),
    resourceType: text("resource_type").notNull(),
    equipmentId: text("equipment_id"),
    locationId: text("location_id"),
    userId: text("user_id").notNull(),
    purpose: text("purpose").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    status: text("status").notNull(),
    reviewedById: text("reviewed_by_id"),
    rejectionReason: text("rejection_reason"),
    cancelledById: text("cancelled_by_id"),
    createdAt,
    updatedAt,
  },
  (t) => [index("reservations_user_idx").on(t.userId), index("reservations_status_idx").on(t.status)],
);

export const notices = pgTable(
  "notices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    kind: text("kind").notNull(),
    byId: text("by_id"),
    createdAt,
  },
  (t) => [index("notices_user_idx").on(t.userId)],
);

export const pendingSeen = pgTable(
  "pending_seen",
  {
    userId: text("user_id").notNull(),
    section: text("section").notNull(),
    seenAt: text("seen_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.section] })],
);

export const activityLogs = pgTable("activity_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  operation: text("operation").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  timestamp: text("timestamp").notNull(),
  details: text("details"),
});

export type UserRow = typeof users.$inferSelect;
export type LocationRow = typeof locations.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type ComponentRow = typeof components.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
export type LoanRow = typeof loans.$inferSelect;
export type ServiceRow = typeof serviceRequests.$inferSelect;
export type InterventionRow = typeof interventions.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type ReservationRow = typeof reservations.$inferSelect;
export type NoticeRow = typeof notices.$inferSelect;
export type ActivityLogRow = typeof activityLogs.$inferSelect;
