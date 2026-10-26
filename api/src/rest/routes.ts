import type { RouteSpec } from "./adapter";

// Tabla de rutas de /api/v1. Cada fila apunta a una operacion del esquema
// GraphQL; los permisos, validaciones y auditoria son los de esa operacion.
// Convencion: GET lee, POST crea, PUT cambia (incluidas las transiciones de
// estado, como sub-recurso del elemento) y DELETE da de baja (baja logica).

const deleted = (params: Record<string, string>) => ({ id: params.id, deleted: true });

function crud(
  base: string,
  names: { list: string; one: string; create: string; update: string; remove: string },
): RouteSpec[] {
  return [
    { method: "GET", path: `/${base}`, operation: names.list },
    { method: "GET", path: `/${base}/:id`, operation: names.one },
    { method: "POST", path: `/${base}`, operation: names.create, created: true },
    { method: "PUT", path: `/${base}/:id`, operation: names.update },
    { method: "DELETE", path: `/${base}/:id`, operation: names.remove, flagData: deleted },
  ];
}

export const ROUTES: RouteSpec[] = [
  // Autenticacion
  { method: "POST", path: "/auth/login", operation: "login", message: "Sesión iniciada" },
  { method: "POST", path: "/auth/logout", operation: "logout", message: "Sesión cerrada", flagData: () => ({ loggedOut: true }) },
  { method: "GET", path: "/auth/me", operation: "me", nullAs: "UNAUTHENTICATED" },
  { method: "PUT", path: "/auth/password", operation: "changePassword", flagData: () => ({ updated: true }) },

  ...crud("users", { list: "users", one: "user", create: "createUser", update: "updateUser", remove: "deleteUser" }),
  { method: "POST", path: "/users/import", operation: "importUsers", created: true, message: "Importación realizada" },
  ...crud("locations", { list: "locations", one: "location", create: "createLocation", update: "updateLocation", remove: "softDeleteLocation" }),

  { method: "GET", path: "/products", operation: "products" },
  { method: "GET", path: "/products/by-machine-id/:machineId", operation: "productByMachineId" },
  { method: "GET", path: "/products/:id", operation: "product" },
  { method: "POST", path: "/products", operation: "createProduct", created: true },
  { method: "PUT", path: "/products/:id", operation: "updateProduct" },
  { method: "DELETE", path: "/products/:id", operation: "softDeleteProduct", flagData: deleted },

  ...crud("components", { list: "components", one: "component", create: "createComponent", update: "updateComponent", remove: "softDeleteComponent" }),

  { method: "GET", path: "/tickets", operation: "tickets" },
  { method: "GET", path: "/tickets/unassigned", operation: "oolTickets" },
  { method: "GET", path: "/tickets/:id", operation: "ticket" },
  { method: "POST", path: "/tickets", operation: "createTicket", created: true },
  { method: "PUT", path: "/tickets/:id", operation: "updateTicket" },
  { method: "PUT", path: "/tickets/:id/status", operation: "changeTicketStatus" },
  { method: "PUT", path: "/tickets/:id/claim", operation: "claimTicket" },
  { method: "PUT", path: "/tickets/:id/assign", operation: "assignTicket" },
  { method: "PUT", path: "/tickets/:id/complete", operation: "completeTicket" },
  { method: "PUT", path: "/tickets/:id/rating", operation: "rateTicket" },
  { method: "DELETE", path: "/tickets/:id", operation: "softDeleteTicket", flagData: deleted },

  { method: "GET", path: "/loans", operation: "loans" },
  { method: "GET", path: "/loans/:id", operation: "loan" },
  { method: "POST", path: "/loans", operation: "createLoan", created: true },
  { method: "PUT", path: "/loans/:id/approve", operation: "approveLoan" },
  { method: "PUT", path: "/loans/:id/reject", operation: "rejectLoan" },
  { method: "PUT", path: "/loans/:id/deliver", operation: "deliverLoan" },
  { method: "PUT", path: "/loans/:id/return", operation: "returnLoan" },
  { method: "DELETE", path: "/loans/:id", operation: "softDeleteLoan", flagData: deleted },

  { method: "GET", path: "/service-requests", operation: "serviceRequests" },
  { method: "GET", path: "/service-requests/:id", operation: "serviceRequest" },
  { method: "POST", path: "/service-requests", operation: "createServiceRequest", created: true },
  { method: "PUT", path: "/service-requests/:id", operation: "updateServiceRequest" },
  { method: "PUT", path: "/service-requests/:id/claim", operation: "claimServiceRequest" },
  { method: "PUT", path: "/service-requests/:id/assign", operation: "assignServiceRequest" },
  { method: "DELETE", path: "/service-requests/:id", operation: "softDeleteServiceRequest", flagData: deleted },

  { method: "GET", path: "/interventions", operation: "interventions" },
  { method: "GET", path: "/interventions/:id", operation: "intervention" },
  { method: "POST", path: "/interventions", operation: "createIntervention", created: true },
  { method: "PUT", path: "/interventions/:id", operation: "updateIntervention" },
  { method: "DELETE", path: "/interventions/:id", operation: "softDeleteIntervention", flagData: deleted },

  { method: "GET", path: "/comments", operation: "comments" },
  { method: "GET", path: "/comments/:id", operation: "comment" },
  { method: "POST", path: "/comments", operation: "createComment", created: true },
  { method: "DELETE", path: "/comments/:id", operation: "softDeleteComment", flagData: deleted },

  { method: "GET", path: "/reservations", operation: "reservations" },
  { method: "GET", path: "/reservations/:id", operation: "reservation" },
  { method: "POST", path: "/reservations", operation: "createReservation", created: true },
  { method: "PUT", path: "/reservations/:id", operation: "updateReservation" },
  { method: "PUT", path: "/reservations/:id/approve", operation: "approveReservation" },
  { method: "PUT", path: "/reservations/:id/reject", operation: "rejectReservation" },
  { method: "DELETE", path: "/reservations/:id", operation: "cancelReservation", message: "Cancelada" },

  { method: "GET", path: "/notices", operation: "notices" },
  { method: "DELETE", path: "/notices/:id", operation: "acknowledgeNotice", flagData: deleted },
  { method: "GET", path: "/pending-news", operation: "pendingNews" },
  { method: "PUT", path: "/pending-news/:section", operation: "markPendingSeen", flagData: (p) => ({ section: p.section, seen: true }) },

  { method: "GET", path: "/activity-logs", operation: "activityLogs" },
  { method: "GET", path: "/dashboard/stats", operation: "dashboardStats" },
  { method: "GET", path: "/reports", operation: "reports" },
];
