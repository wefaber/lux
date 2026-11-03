// Documentos GraphQL de la vista telefono (#98). Texto plano sin interpolar:
// api/scripts/check-frontend-docs.ts los valida contra el SDL del backend leyendo
// el codigo fuente.

export const RECORD_SCAN_MUTATION = `
  mutation RecordScan($input: ScanInput!) {
    recordScan(input: $input) {
      scan { id machineId productId context createdAt }
      product { id machineId kind brand model serialNumber partNumber status issues locationId location }
    }
  }
`;

export const MY_NOTES_QUERY = `
  query MyEquipmentNotes($productId: ID!) {
    myEquipmentNotes(productId: $productId) { id productId body createdAt updatedAt }
  }
`;

export const UPSERT_NOTE_MUTATION = `
  mutation UpsertEquipmentNote($input: EquipmentNoteInput!) {
    upsertEquipmentNote(input: $input) { id productId body createdAt updatedAt }
  }
`;

export const DELETE_NOTE_MUTATION = `
  mutation DeleteEquipmentNote($id: ID!) { deleteEquipmentNote(id: $id) }
`;

export const RETIRE_PRODUCT_MUTATION = `
  mutation SoftDeleteProduct($id: ID!, $reason: String) { softDeleteProduct(id: $id, reason: $reason) }
`;

export const INCIDENT_TEMPLATES_QUERY = `
  query IncidentTemplates($status: String) {
    incidentTemplates(status: $status) {
      id name category priority title description status
      author { id name }
      approvedBy { id name }
      approvedAt createdAt updatedAt
    }
  }
`;

export const PRODUCT_QUERY = `
  query GetProduct($id: ID!) {
    product(id: $id) { id machineId kind brand model status locationId location }
  }
`;

export const CREATE_TICKET_MUTATION = `
  mutation CreateTicket($input: TicketInput!) {
    createTicket(input: $input) { id title }
  }
`;

export const ATTACH_EQUIPMENT_MUTATION = `
  mutation UpdateTicket($id: ID!, $input: TicketUpdateInput!) {
    updateTicket(id: $id, input: $input) { id equipmentId }
  }
`;

export const MOBILE_TICKETS_QUERY = `
  query GetTickets($submittedById: ID) {
    tickets(submittedById: $submittedById) {
      id title category priority status
      submittedBy { id name }
      assignedTo { id name }
      equipmentId
      equipment { id machineId }
      createdAt updatedAt
    }
  }
`;

export const MOBILE_TICKET_QUERY = `
  query GetTicket($id: ID!) {
    ticket(id: $id) {
      id title description category priority status
      submittedBy { id name }
      assignedTo { id name }
      equipmentId
      equipment { id machineId kind brand model location }
      locationId
      location { id name code }
      diagnosis corrected actionsTaken
      createdAt updatedAt resolvedAt
    }
  }
`;
