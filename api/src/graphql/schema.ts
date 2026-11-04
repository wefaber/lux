// SDL identico al contrato que sirven los mocks (src/mocks/schema.ts del frontend)
// mas operaciones aditivas que la app no usa: bajas logicas (softDelete*) y lecturas
// por id (location, intervention, comment). Las 64 operaciones de la app no cambian.
export const typeDefs = /* GraphQL */ `
  type Query {
    login(dni: String!, password: String!): AuthUser
    me: User
    users(
      role: String
      isActive: Boolean
      studentGroup: String
      studentShift: String
      subject: String
      isTeacher: Boolean
    ): [User!]!
    user(id: ID!): User
    products(
      status: String
      locationId: ID
      deletedAt: String
      availableForLoan: Boolean
    ): [Product!]!
    product(id: ID!): Product
    productByMachineId(machineId: String!): Product
    components(productId: ID, isWorking: Boolean): [Component!]!
    component(id: ID!): Component
    tickets(
      status: String
      assignedToId: ID
      submittedById: ID
      equipmentId: ID
      startDate: String
      endDate: String
    ): [Ticket!]!
    ticket(id: ID!): Ticket
    oolTickets: [Ticket!]!
    loans(status: String, userId: ID, equipmentId: ID, startDate: String, endDate: String): [Loan!]!
    loan(id: ID!): Loan
    serviceRequests(
      status: String
      requestedById: ID
      startDate: String
      endDate: String
    ): [ServiceRequest!]!
    serviceRequest(id: ID!): ServiceRequest
    dashboardStats(period: String): DashboardStats!
    reports: Reports!
    activityLogs(userId: ID, operation: String, startDate: String, endDate: String): [ActivityLog!]!
    locations: [Location!]!
    location(id: ID!): Location
    interventions(equipmentId: ID!): [Intervention!]!
    intervention(id: ID!): Intervention
    comments(entityType: String!, entityId: ID!): [Comment!]!
    comment(id: ID!): Comment
    reservations(status: String, startDate: String, endDate: String): [Reservation!]!
    reservation(id: ID!): Reservation
    notices: [Notice!]!
    pendingNews: [String!]!
    # Issue tracker (solo admin/root_admin). reportError es la unica operacion
    # publica y se usa desde POST /api/v1/errors.
    errorReports(status: String, search: String, limit: Int): [ErrorReport!]!
    errorReport(id: ID!): ErrorReport
    errorReportSettings: ErrorReportSettings!
    githubIssueDraft(id: ID!): String!
    # Mobile (#98). Notas: solo las del tecnico que consulta. Plantillas: el staff
    # ve las aprobadas y las propias; admin ve todas.
    myEquipmentNotes(productId: ID!): [EquipmentNote!]!
    incidentTemplates(status: String): [IncidentTemplate!]!
    incidentTemplate(id: ID!): IncidentTemplate
    # Horarios de clase (staff). teacherInCharge: docente a cargo del lugar en un
    # instante (ISO; por defecto ahora), en la zona horaria de la institucion.
    classSchedules(locationId: ID, teacherId: ID): [ClassSchedule!]!
    teacherInCharge(locationId: ID!, at: String): ClassSchedule
  }

  type Mutation {
    createUser(input: UserInput!): User!
    updateUser(id: ID!, input: UserInput!): User!
    deleteUser(id: ID!): Boolean!
    importUsers(rows: [UserImportRow!]!): UserImportResult!
    createProduct(input: ProductInput!): Product!
    updateProduct(id: ID!, input: ProductUpdateInput!): Product!
    # reason: motivo de la baja (queda en la auditoria)
    softDeleteProduct(id: ID!, reason: String): Boolean!
    createComponent(input: ComponentInput!): Component!
    updateComponent(id: ID!, input: ComponentUpdateInput!): Component!
    softDeleteComponent(id: ID!): Boolean!
    createTicket(input: TicketInput!): Ticket!
    updateTicket(id: ID!, input: TicketUpdateInput!): Ticket!
    assignTicket(id: ID!, technicianId: ID!): Ticket!
    claimTicket(id: ID!): Ticket!
    completeTicket(id: ID!, input: TicketCompleteInput!): Ticket!
    changeTicketStatus(id: ID!, status: String!): Ticket!
    # El solicitante puntua un ticket propio ya resuelto (1-5)
    rateTicket(id: ID!, rating: Int!): Ticket!
    createLoan(input: LoanInput!): Loan!
    approveLoan(id: ID!): Loan!
    rejectLoan(id: ID!, reason: String!): Loan!
    deliverLoan(id: ID!): Loan!
    returnLoan(id: ID!, damaged: Boolean, issues: String): Loan!
    createServiceRequest(input: ServiceRequestInput!): ServiceRequest!
    updateServiceRequest(id: ID!, input: ServiceRequestUpdateInput!): ServiceRequest!
    claimServiceRequest(id: ID!): ServiceRequest!
    assignServiceRequest(id: ID!, technicianId: ID!): ServiceRequest!
    softDeleteTicket(id: ID!): Boolean!
    softDeleteLoan(id: ID!): Boolean!
    softDeleteServiceRequest(id: ID!): Boolean!
    softDeleteIntervention(id: ID!): Boolean!
    softDeleteComment(id: ID!): Boolean!
    logout: Boolean!
    changePassword(currentPassword: String!, newPassword: String!): Boolean!
    createLocation(input: LocationInput!): Location!
    updateLocation(id: ID!, input: LocationUpdateInput!): Location!
    softDeleteLocation(id: ID!): Boolean!
    # Mobile (#98). recordScan y upsertEquipmentNote van fuera del lock global
    # (alta frecuencia) y escriben su auditoria a mano. clientId hace idempotentes
    # los reintentos del outbox offline.
    recordScan(input: ScanInput!): ScanResult!
    upsertEquipmentNote(input: EquipmentNoteInput!): EquipmentNote!
    deleteEquipmentNote(id: ID!): Boolean!
    createClassSchedule(input: ClassScheduleInput!): ClassSchedule!
    updateClassSchedule(id: ID!, input: ClassScheduleInput!): ClassSchedule!
    deleteClassSchedule(id: ID!): Boolean!
    createIncidentTemplate(input: IncidentTemplateInput!): IncidentTemplate!
    updateIncidentTemplate(id: ID!, input: IncidentTemplateInput!): IncidentTemplate!
    # draft -> testing (autor o admin)
    submitIncidentTemplate(id: ID!): IncidentTemplate!
    # testing -> approved (admin)
    approveIncidentTemplate(id: ID!): IncidentTemplate!
    # testing -> draft con motivo (admin)
    rejectIncidentTemplate(id: ID!, reason: String!): IncidentTemplate!
    # cualquier estado -> retired (autor si no esta aprobada; admin siempre)
    retireIncidentTemplate(id: ID!): IncidentTemplate!
    createIntervention(input: InterventionInput!): Intervention!
    updateIntervention(id: ID!, input: InterventionUpdateInput!): Intervention!
    createComment(input: CommentInput!): Comment!
    createReservation(input: ReservationInput!): Reservation!
    approveReservation(id: ID!): Reservation!
    rejectReservation(id: ID!, reason: String!): Reservation!
    updateReservation(id: ID!, input: ReservationUpdateInput!): Reservation!
    cancelReservation(id: ID!): Reservation!
    acknowledgeNotice(id: ID!): Boolean!
    markPendingSeen(section: String!): Boolean!
    reportError(input: ErrorReportInput!): ErrorReport!
    updateErrorReportStatus(id: ID!, status: String!): ErrorReport!
    createGithubIssue(id: ID!): GithubIssueResult!
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

  type Notice {
    id: ID!
    userId: ID!
    entityType: String!
    entityId: ID!
    kind: String!
    by: User
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
    kind: String!
    number: Int!
    name: String!
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
    isTeacher: Boolean!
    createdAt: String!
    updatedAt: String!
    token: String!
  }

  type User {
    id: ID!
    name: String!
    # dni y email son null cuando quien consulta no tiene relacion con la persona
    dni: String
    email: String
    role: String!
    isActive: Boolean!
    # Docente: solicitante que puede reservar salones y laboratorios
    isTeacher: Boolean!
    # Solo para solicitantes; null / [] cuando no hay dato
    studentGroup: String
    studentShift: String
    studentSubjects: [String!]!
    createdAt: String!
    updatedAt: String!
  }

  type UserImportRowResult {
    line: Int!
    # created | updated | error
    status: String!
    userId: ID
    error: String
  }

  type UserImportResult {
    created: Int!
    updated: Int!
    failed: Int!
    rows: [UserImportRowResult!]!
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
    priority: String!
    status: String!
    submittedBy: User!
    assignedTo: User
    equipmentId: ID
    equipment: Product
    locationId: ID
    location: Location
    templateId: ID
    diagnosis: String
    corrected: Boolean
    actionsTaken: String
    createdAt: String!
    updatedAt: String!
    resolvedAt: String
    # Primera vez que un tecnico tomo el ticket
    attendedAt: String
    # Valoracion del solicitante sobre la resolucion (1-5)
    rating: Int
    ratedAt: String
  }

  type ScanEvent {
    id: ID!
    user: User!
    machineId: String!
    productId: ID
    context: String!
    userAgent: String
    createdAt: String!
  }

  type ScanResult {
    scan: ScanEvent!
    product: Product
  }

  type EquipmentNote {
    id: ID!
    productId: ID!
    body: String!
    createdAt: String!
    updatedAt: String!
  }

  type ClassSchedule {
    id: ID!
    location: Location!
    teacher: User!
    # 1 = lunes ... 7 = domingo
    weekday: Int!
    # HH:MM, hora local de la institucion
    startTime: String!
    endTime: String!
    subject: String
    studentGroup: String
    createdAt: String!
    updatedAt: String!
  }

  type IncidentTemplate {
    id: ID!
    name: String!
    category: String!
    priority: String!
    title: String!
    description: String!
    status: String!
    author: User!
    approvedBy: User
    approvedAt: String
    createdAt: String!
    updatedAt: String!
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
    # Solo para el solicitante; null para el staff
    requesterOverview: RequesterOverview
  }

  type RequesterOverview {
    # Tickets propios sin resolver, del ultimo movimiento al mas viejo
    activeTickets: [Ticket!]!
    estimates: TicketEstimates!
    satisfaction: SatisfactionSummary!
    areas: [RequesterArea!]!
  }

  type TicketEstimates {
    # Promedio desde que se creo hasta que un tecnico lo tomo
    toAttendHours: Float
    # Promedio desde que se creo hasta que quedo resuelto
    toResolveHours: Float
    # Tickets resueltos usados como muestra del promedio general
    sampleSize: Int!
    # Solo las categorias con al menos 3 tickets resueltos
    byCategory: [CategoryEstimate!]!
  }

  type CategoryEstimate {
    category: String!
    toAttendHours: Float
    toResolveHours: Float
    sampleSize: Int!
  }

  type SatisfactionSummary {
    # Promedio de las valoraciones que dejo el solicitante; null si no puntuo
    average: Float
    count: Int!
  }

  # Un lugar que el solicitante usa, con el estado de los equipos de ese lugar
  type RequesterArea {
    location: Location!
    available: Int!
    inUse: Int!
    inRepair: Int!
    retired: Int!
    # Tickets propios sin resolver en ese lugar
    openTickets: Int!
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

  type ErrorReport {
    id: ID!
    fingerprint: String!
    message: String!
    stack: String
    route: String!
    userAgent: String
    role: String
    firstSeen: String!
    lastSeen: String!
    occurrences: Int!
    # new | triaged | resolved
    status: String!
    githubIssueUrl: String
    createdAt: String!
    updatedAt: String!
  }

  type ErrorReportSettings {
    githubConfigured: Boolean!
    llmConfigured: Boolean!
    # owner/repo cuando hay credenciales; nunca el token
    repository: String
  }

  type GithubIssueResult {
    url: String!
    usedLlm: Boolean!
    alreadyExisted: Boolean!
  }

  input ErrorReportInput {
    fingerprint: String!
    message: String!
    stack: String
    route: String!
    userAgent: String
    role: String
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
    isTeacher: Boolean
    studentGroup: String
    studentShift: String
    studentSubjects: [String!]
  }

  input UserImportRow {
    line: Int!
    name: String!
    dni: String!
    email: String!
    role: String
    password: String
    isActive: Boolean
    studentGroup: String
    studentShift: String
    studentSubjects: [String!]
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
    # default medium
    priority: String
    equipmentId: ID
    # default: la ubicacion del equipo. Solo staff puede pasar otra.
    locationId: ID
    templateId: ID
    clientId: String
  }

  input TicketUpdateInput {
    title: String
    description: String
    category: String
    priority: String
    equipmentId: ID
    locationId: ID
  }

  input ScanInput {
    machineId: String!
    context: String!
    userAgent: String
    clientId: String
  }

  input EquipmentNoteInput {
    # sin id crea; con id edita (solo el autor)
    id: ID
    productId: ID!
    body: String!
    clientId: String
  }

  input ClassScheduleInput {
    locationId: ID!
    teacherId: ID!
    weekday: Int!
    startTime: String!
    endTime: String!
    subject: String
    studentGroup: String
  }

  input IncidentTemplateInput {
    name: String!
    category: String!
    priority: String!
    title: String!
    description: String!
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
