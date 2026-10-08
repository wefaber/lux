export const schema = `
  type Query {
    login(dni: String!, password: String!): AuthUser
    me: User
    users(role: String, isActive: Boolean): [User!]!
    user(id: ID!): User
    products(status: String, locationId: ID, deletedAt: String, availableForLoan: Boolean): [Product!]!
    product(id: ID!): Product
    productByMachineId(machineId: String!): Product
    components(productId: ID, isWorking: Boolean): [Component!]!
    component(id: ID!): Component
    tickets(status: String, assignedToId: ID, submittedById: ID, equipmentId: ID): [Ticket!]!
    ticket(id: ID!): Ticket
    oolTickets: [Ticket!]!
    loans(status: String, userId: ID, equipmentId: ID): [Loan!]!
    loan(id: ID!): Loan
    serviceRequests(status: String, requestedById: ID): [ServiceRequest!]!
    serviceRequest(id: ID!): ServiceRequest
    dashboardStats(period: String): DashboardStats!
    reports: Reports!
    activityLogs(userId: ID, operation: String, startDate: String, endDate: String): [ActivityLog!]!
    locations: [Location!]!
    interventions(equipmentId: ID!): [Intervention!]!
    comments(entityType: String!, entityId: ID!): [Comment!]!
    reservations(status: String): [Reservation!]!
    reservation(id: ID!): Reservation
  }

  type Mutation {
    createUser(input: UserInput!): User!
    updateUser(id: ID!, input: UserInput!): User!
    deleteUser(id: ID!): Boolean!
    createProduct(input: ProductInput!): Product!
    updateProduct(id: ID!, input: ProductUpdateInput!): Product!
    softDeleteProduct(id: ID!): Boolean!
    createComponent(input: ComponentInput!): Component!
    updateComponent(id: ID!, input: ComponentUpdateInput!): Component!
    softDeleteComponent(id: ID!): Boolean!
    createTicket(input: TicketInput!): Ticket!
    updateTicket(id: ID!, input: TicketUpdateInput!): Ticket!
    assignTicket(id: ID!, technicianId: ID!): Ticket!
    claimTicket(id: ID!): Ticket!
    completeTicket(id: ID!, input: TicketCompleteInput!): Ticket!
    changeTicketStatus(id: ID!, status: String!): Ticket!
    createLoan(input: LoanInput!): Loan!
    approveLoan(id: ID!): Loan!
    rejectLoan(id: ID!, reason: String!): Loan!
    deliverLoan(id: ID!): Loan!
    returnLoan(id: ID!, damaged: Boolean, issues: String): Loan!
    createServiceRequest(input: ServiceRequestInput!): ServiceRequest!
    updateServiceRequest(id: ID!, input: ServiceRequestUpdateInput!): ServiceRequest!
    claimServiceRequest(id: ID!): ServiceRequest!
    assignServiceRequest(id: ID!, technicianId: ID!): ServiceRequest!
    changePassword(currentPassword: String!, newPassword: String!): Boolean!
    createLocation(input: LocationInput!): Location!
    updateLocation(id: ID!, input: LocationUpdateInput!): Location!
    softDeleteLocation(id: ID!): Boolean!
    createIntervention(input: InterventionInput!): Intervention!
    updateIntervention(id: ID!, input: InterventionUpdateInput!): Intervention!
    createComment(input: CommentInput!): Comment!
    createReservation(input: ReservationInput!): Reservation!
    approveReservation(id: ID!): Reservation!
    rejectReservation(id: ID!, reason: String!): Reservation!
    updateReservation(id: ID!, input: ReservationUpdateInput!): Reservation!
    cancelReservation(id: ID!): Reservation!
  }

  type Reservation {
    id: ID!
    resourceType: String!
    equipment: Product
    location: Location
    user: User!
    purpose: String!
    startsAt: String!
    endsAt: String!
    status: String!
    reviewedBy: User
    rejectionReason: String
    cancelledBy: User
    createdAt: String!
    updatedAt: String!
  }

  type Comment {
    id: ID!
    entityType: String!
    entityId: ID!
    author: User!
    body: String!
    createdAt: String!
  }

  type Intervention {
    id: ID!
    equipmentId: ID!
    technician: User!
    type: String!
    description: String!
    partsReplaced: String
    ticketId: ID
    performedAt: String!
    createdAt: String!
    updatedAt: String!
  }

  type Location {
    id: ID!
    # laboratory | classroom | administration | other
    kind: String!
    number: Int!
    name: String!
    # Letra del tipo + numero: L1 = Laboratorio 1
    code: String!
    productCount: Int!
    createdAt: String!
    updatedAt: String!
    deletedAt: String
  }

  type AuthUser {
    id: ID!
    name: String!
    dni: String!
    email: String!
    role: String!
    isActive: Boolean!
    createdAt: String!
    updatedAt: String!
    token: String!
  }

  type User {
    id: ID!
    name: String!
    dni: String!
    email: String!
    role: String!
    isActive: Boolean!
    createdAt: String!
    updatedAt: String!
  }

  type Product {
    id: ID!
    type: String!
    machineId: String!
    kind: String!
    brand: String!
    model: String!
    serialNumber: String!
    partNumber: String!
    status: String!
    issues: String
    locationId: ID!
    location: String!
    components: [Component!]!
    createdAt: String!
    updatedAt: String!
    deletedAt: String
  }

  type Component {
    id: ID!
    type: String!
    name: String!
    model: String!
    manufacturer: String!
    serialNumber: String!
    partNumber: String!
    isFactory: Boolean!
    isWorking: Boolean!
    productId: ID
    createdAt: String!
    updatedAt: String!
    deletedAt: String
  }

  type Ticket {
    id: ID!
    title: String!
    description: String!
    category: String!
    status: String!
    submittedBy: User!
    assignedTo: User
    equipmentId: ID
    equipment: Product
    diagnosis: String
    corrected: Boolean
    actionsTaken: String
    createdAt: String!
    updatedAt: String!
    resolvedAt: String
  }

  type Loan {
    id: ID!
    equipment: Product!
    user: User!
    status: String!
    approvedBy: User
    deliveredBy: User
    deliveredAt: String
    issueDate: String!
    returnDate: String!
    actualReturnDate: String
    rejectionReason: String
    components: [Component!]!
    createdAt: String!
    updatedAt: String!
  }

  type ServiceRequest {
    id: ID!
    type: String!
    status: String!
    requestedBy: User!
    assignedTo: User
    description: String!
    labNumber: String
    softwareName: String
    equipmentId: ID
    resolutionText: String
    createdAt: String!
    updatedAt: String!
  }

  type Reports {
    overdueLoans: [OverdueLoanReport!]!
    resolution: ResolutionReport!
    topIncidentEquipment: [EquipmentIncidentReport!]!
  }

  type OverdueLoanReport {
    loanId: ID!
    machineId: String!
    equipment: String!
    user: String!
    returnDate: String!
    daysOverdue: Int!
  }

  type ResolutionReport {
    resolvedCount: Int!
    averageHours: Float
    byCategory: [CategoryResolution!]!
  }

  type CategoryResolution {
    category: String!
    resolvedCount: Int!
    averageHours: Float
  }

  type EquipmentIncidentReport {
    equipmentId: ID!
    machineId: String!
    equipment: String!
    ticketCount: Int!
    openCount: Int!
  }

  type DashboardStats {
    totalEquipment: Int!
    openTickets: Int!
    activeLoans: Int!
    pendingServices: Int!
    ticketsByStatus: [TicketStatusCount!]!
    servicesByPeriod: [PeriodCount!]!
    # Solo para el staff; null para el solicitante
    workQueue: WorkQueue
  }

  type WorkQueue {
    unassignedTickets: Int!
    ticketsInProgress: Int!
    pendingServices: Int!
    overdueLoans: Int!
    equipmentInRepair: Int!
  }

  type TicketStatusCount {
    status: String!
    count: Int!
  }

  type PeriodCount {
    date: String!
    count: Int!
  }

  type ActivityLog {
    id: ID!
    userId: ID!
    userName: String!
    operation: String!
    entity: String!
    entityId: ID!
    timestamp: String!
    details: String
  }

  input UserInput {
    name: String!
    dni: String!
    email: String!
    password: String
    role: String!
    isActive: Boolean
  }

  input ProductInput {
    machineId: String!
    kind: String!
    brand: String!
    model: String!
    serialNumber: String!
    partNumber: String!
    status: String!
    issues: String
    locationId: ID!
  }

  input ProductUpdateInput {
    machineId: String
    kind: String
    brand: String
    model: String
    serialNumber: String
    partNumber: String
    issues: String
    locationId: ID
  }

  input ReservationInput {
    resourceType: String!
    equipmentId: ID
    locationId: ID
    startsAt: String!
    endsAt: String!
    purpose: String!
  }

  input ReservationUpdateInput {
    startsAt: String
    endsAt: String
    purpose: String
  }

  input CommentInput {
    entityType: String!
    entityId: ID!
    body: String!
  }

  input InterventionInput {
    equipmentId: ID!
    type: String!
    description: String!
    partsReplaced: String
    ticketId: ID
    performedAt: String
  }

  input InterventionUpdateInput {
    type: String
    description: String
    partsReplaced: String
    ticketId: ID
    performedAt: String
  }

  input LocationInput {
    kind: String!
    number: Int!
    name: String!
  }

  input LocationUpdateInput {
    kind: String
    number: Int
    name: String
  }

  input ComponentUpdateInput {
    name: String
    model: String
    manufacturer: String
    serialNumber: String
    partNumber: String
    isFactory: Boolean
    isWorking: Boolean
  }

  input ComponentInput {
    name: String!
    model: String!
    manufacturer: String!
    serialNumber: String!
    partNumber: String!
    isFactory: Boolean!
    isWorking: Boolean!
    productId: ID
  }

  input TicketInput {
    title: String!
    description: String!
    category: String!
    equipmentId: ID
  }

  input TicketUpdateInput {
    title: String
    description: String
    category: String
    equipmentId: ID
  }

  input TicketCompleteInput {
    diagnosis: String!
    corrected: Boolean!
    actionsTaken: String!
  }

  input LoanInput {
    equipmentId: ID!
    userId: ID
    issueDate: String!
    returnDate: String!
    componentIds: [ID!]
  }

  input ServiceRequestInput {
    type: String!
    description: String!
    labNumber: String
    softwareName: String
    equipmentId: ID
  }

  input ServiceRequestUpdateInput {
    status: String
    resolutionText: String
  }
`;
