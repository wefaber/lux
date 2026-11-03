import { describe, expect, test } from "bun:test";
import { mockTickets } from "./data/tickets";
import { mockProducts } from "./data/equipment";
import { mockIncidentTemplates } from "./data/incident-templates";
import { mockEquipmentNotes } from "./data/equipment-notes";
import { mockScanEvents } from "./data/scan-events";
import type { Ticket } from "@/lib/types";
import { gqlAs, useMockServer, USERS, FORBIDDEN } from "@/test/graphql";

useMockServer();

const { ADMIN, TECNICO, SOLICITANTE, OTRO_SOLICITANTE } = USERS;
const TECNICO_2 = "u-tec-2";

const CREATE_TICKET = `mutation CreateTicket($input: TicketInput!) { createTicket(input: $input) { id priority locationId templateId } }`;
const UPDATE_TICKET = `mutation UpdateTicket($id: ID!, $input: TicketUpdateInput!) { updateTicket(id: $id, input: $input) { id priority locationId } }`;
const RECORD_SCAN = `mutation RecordScan($input: ScanInput!) { recordScan(input: $input) { scan { id productId } product { id } } }`;
const MY_NOTES = `query MyEquipmentNotes($productId: ID!) { myEquipmentNotes(productId: $productId) { id body } }`;
const UPSERT_NOTE = `mutation UpsertEquipmentNote($input: EquipmentNoteInput!) { upsertEquipmentNote(input: $input) { id body } }`;
const DELETE_NOTE = `mutation DeleteEquipmentNote($id: ID!) { deleteEquipmentNote(id: $id) }`;
const TEMPLATES = `query IncidentTemplates($status: String) { incidentTemplates(status: $status) { id status } }`;
const TEMPLATE = `query IncidentTemplate($id: ID!) { incidentTemplate(id: $id) { id status } }`;
const CREATE_TPL = `mutation CreateIncidentTemplate($input: IncidentTemplateInput!) { createIncidentTemplate(input: $input) { id status } }`;
const UPDATE_TPL = `mutation UpdateIncidentTemplate($id: ID!, $input: IncidentTemplateInput!) { updateIncidentTemplate(id: $id, input: $input) { id name } }`;
const SUBMIT_TPL = `mutation SubmitIncidentTemplate($id: ID!) { submitIncidentTemplate(id: $id) { id status } }`;
const APPROVE_TPL = `mutation ApproveIncidentTemplate($id: ID!) { approveIncidentTemplate(id: $id) { id status } }`;
const REJECT_TPL = `mutation RejectIncidentTemplate($id: ID!, $reason: String!) { rejectIncidentTemplate(id: $id, reason: $reason) { id status } }`;
const RETIRE_TPL = `mutation RetireIncidentTemplate($id: ID!) { retireIncidentTemplate(id: $id) { id status } }`;

const TICKET_INPUT = {
  title: "Sin imagen",
  description: "El monitor no muestra nada",
  category: "hardware",
};
const TPL_INPUT = {
  name: "Monitor sin imagen",
  category: "hardware",
  priority: "high",
  title: "Monitor sin imagen",
  description: "El monitor queda en negro al encender. Revisar cable y entrada de video.",
};

// Cada test usa su propio clientId para no pisarse con el resto
let seq = 0;
const uniq = (prefix: string) => `${prefix}-${Date.now()}-${++seq}`;

function product(id: string) {
  return mockProducts.find((p) => p.id === id)!;
}

function ticket(id: string): Ticket {
  return mockTickets.find((t) => t.id === id)!;
}

function msg(res: { errors?: Array<{ message: string }> }): string | undefined {
  return res.errors?.[0]?.message;
}

describe("#98 escaneo QR: RecordScan", () => {
  test("requiere sesión", async () => {
    const res = await gqlAs(null, RECORD_SCAN, {
      input: { machineId: "L1-PC2", context: "inventory" },
    });
    expect(msg(res)).toBe("No autenticado");
  });

  test("el contexto tiene que ser inventory, incident o loan", async () => {
    const res = await gqlAs(TECNICO, RECORD_SCAN, {
      input: { machineId: "L1-PC2", context: "otro" },
    });
    expect(res.errors).toBeDefined();
  });

  test("el solicitante solo escanea para préstamos", async () => {
    const forbidden = await gqlAs(SOLICITANTE, RECORD_SCAN, {
      input: { machineId: "L1-PC2", context: "inventory" },
    });
    expect(msg(forbidden)).toBe(FORBIDDEN);

    const ok = await gqlAs(SOLICITANTE, RECORD_SCAN, {
      input: { machineId: "L1-PC2", context: "loan" },
    });
    expect(ok.errors).toBeUndefined();
    expect(ok.data).toBeDefined();
  });

  test("encuentra el equipo ignorando espacios y mayúsculas del QR", async () => {
    const res = await gqlAs<{ recordScan: { product: { id: string } | null } }>(
      TECNICO,
      RECORD_SCAN,
      {
        input: { machineId: "  l1-pc2 ", context: "inventory" },
      },
    );
    expect(res.data!.recordScan.product?.id).toBe("prod-2");
  });

  test("un código que no es de ningún equipo vivo devuelve product null y lo registra", async () => {
    const before = mockScanEvents.length;
    const res = await gqlAs<{ recordScan: { scan: { productId: string | null }; product: null } }>(
      TECNICO,
      RECORD_SCAN,
      { input: { machineId: "NO-EXISTE-9", context: "incident" } },
    );
    expect(res.data!.recordScan.product).toBeNull();
    expect(res.data!.recordScan.scan.productId).toBeNull();
    expect(mockScanEvents.length).toBe(before + 1);
  });

  test("con el mismo clientId no registra dos veces", async () => {
    const input = { machineId: "L1-PC3", context: "inventory", clientId: uniq("scan") };
    const first = await gqlAs<{ recordScan: { scan: { id: string } } }>(TECNICO, RECORD_SCAN, {
      input,
    });
    const before = mockScanEvents.length;
    const again = await gqlAs<{ recordScan: { scan: { id: string } } }>(TECNICO, RECORD_SCAN, {
      input,
    });
    expect(again.data!.recordScan.scan.id).toBe(first.data!.recordScan.scan.id);
    expect(mockScanEvents.length).toBe(before);
  });
});

describe("#98 notas privadas de técnicos", () => {
  test("solo el personal las usa", async () => {
    const res = await gqlAs(SOLICITANTE, MY_NOTES, { productId: "prod-2" });
    expect(msg(res)).toBe(FORBIDDEN);
  });

  test("cada técnico ve solo las suyas, y el admin no ve ninguna ajena", async () => {
    const mine = await gqlAs<{ myEquipmentNotes: Array<{ body: string }> }>(TECNICO, MY_NOTES, {
      productId: "prod-2",
    });
    expect(mine.data!.myEquipmentNotes.length).toBeGreaterThan(0);
    expect(
      mine.data!.myEquipmentNotes.every((n) =>
        mockEquipmentNotes.some((m) => m.body === n.body && m.author.id === TECNICO),
      ),
    ).toBe(true);

    const other = await gqlAs<{ myEquipmentNotes: unknown[] }>(TECNICO_2, MY_NOTES, {
      productId: "prod-2",
    });
    expect(other.data!.myEquipmentNotes).toEqual([]);

    const admin = await gqlAs<{ myEquipmentNotes: unknown[] }>(ADMIN, MY_NOTES, {
      productId: "prod-2",
    });
    expect(admin.data!.myEquipmentNotes).toEqual([]);
  });

  test("se listan por fecha de edición, la más reciente primero", async () => {
    const res = await gqlAs<{ myEquipmentNotes: Array<{ id: string }> }>(TECNICO, MY_NOTES, {
      productId: "prod-2",
    });
    const updated = res.data!.myEquipmentNotes.map(
      (n) => mockEquipmentNotes.find((m) => m.id === n.id)!.updatedAt,
    );
    expect(updated.toSorted().toReversed()).toEqual(updated);
  });

  test("crea, valida el largo y no crea nada si el body está vacío o es muy largo", async () => {
    const created = await gqlAs(TECNICO, UPSERT_NOTE, {
      input: { productId: "prod-5", body: "  Revisar la fuente  " },
    });
    expect(created.errors).toBeUndefined();
    expect(mockEquipmentNotes.find((n) => n.body === "Revisar la fuente")).toBeDefined();

    expect(
      msg(await gqlAs(TECNICO, UPSERT_NOTE, { input: { productId: "prod-5", body: "   " } })),
    ).toBeDefined();
    const long = "x".repeat(2001);
    expect(
      msg(await gqlAs(TECNICO, UPSERT_NOTE, { input: { productId: "prod-5", body: long } })),
    ).toBeDefined();
  });

  test("solo el autor edita su nota", async () => {
    const note = mockEquipmentNotes.find((n) => n.author.id === TECNICO && n.deletedAt === null)!;
    const denied = await gqlAs(TECNICO_2, UPSERT_NOTE, {
      input: { id: note.id, productId: note.productId, body: "intruso" },
    });
    expect(msg(denied)).toBe(FORBIDDEN);
    expect(note.body).not.toBe("intruso");

    const ok = await gqlAs(TECNICO, UPSERT_NOTE, {
      input: { id: note.id, productId: note.productId, body: "Editada por el autor" },
    });
    expect(ok.errors).toBeUndefined();
    expect(note.body).toBe("Editada por el autor");
  });

  test("la baja es lógica y solo del autor", async () => {
    const created = await gqlAs<{ upsertEquipmentNote: { id: string } }>(TECNICO, UPSERT_NOTE, {
      input: { productId: "prod-5", body: "Para borrar" },
    });
    const id = created.data!.upsertEquipmentNote.id;

    expect(msg(await gqlAs(ADMIN, DELETE_NOTE, { id }))).toBe(FORBIDDEN);
    expect(msg(await gqlAs(TECNICO_2, DELETE_NOTE, { id }))).toBe(FORBIDDEN);

    expect((await gqlAs(TECNICO, DELETE_NOTE, { id })).errors).toBeUndefined();
    expect(mockEquipmentNotes.find((n) => n.id === id)!.deletedAt).not.toBeNull();

    const mine = await gqlAs<{ myEquipmentNotes: Array<{ id: string }> }>(TECNICO, MY_NOTES, {
      productId: "prod-5",
    });
    expect(mine.data!.myEquipmentNotes.some((n) => n.id === id)).toBe(false);
  });

  test("con el mismo clientId no crea dos notas", async () => {
    const input = { productId: "prod-2", body: "Reintento offline", clientId: uniq("note") };
    const first = await gqlAs<{ upsertEquipmentNote: { id: string } }>(TECNICO, UPSERT_NOTE, {
      input,
    });
    const before = mockEquipmentNotes.length;
    const again = await gqlAs<{ upsertEquipmentNote: { id: string } }>(TECNICO, UPSERT_NOTE, {
      input,
    });
    expect(again.data!.upsertEquipmentNote.id).toBe(first.data!.upsertEquipmentNote.id);
    expect(mockEquipmentNotes.length).toBe(before);
  });
});

describe("#98 plantillas de incidencia", () => {
  test("el técnico ve las aprobadas y las propias; el admin, todas", async () => {
    const tec = await gqlAs<{ incidentTemplates: Array<{ id: string }> }>(TECNICO, TEMPLATES, {});
    const tecIds = tec.data!.incidentTemplates.map((t) => t.id);
    expect(tecIds).toContain("tpl-001");
    expect(tecIds).toContain("tpl-003");
    expect(tecIds).not.toContain("tpl-004");

    const admin = await gqlAs<{ incidentTemplates: Array<{ id: string }> }>(ADMIN, TEMPLATES, {});
    expect(admin.data!.incidentTemplates.map((t) => t.id)).toContain("tpl-004");
  });

  test("el filtro por status se aplica", async () => {
    const res = await gqlAs<{ incidentTemplates: Array<{ status: string }> }>(ADMIN, TEMPLATES, {
      status: "draft",
    });
    expect(res.data!.incidentTemplates.every((t) => t.status === "draft")).toBe(true);
  });

  test("una plantilla ajena no visible da FORBIDDEN por id", async () => {
    expect(msg(await gqlAs(TECNICO, TEMPLATE, { id: "tpl-004" }))).toBe(FORBIDDEN);
    expect(msg(await gqlAs(SOLICITANTE, TEMPLATE, { id: "tpl-001" }))).toBe(FORBIDDEN);
  });

  test("crear: nace en borrador, valida campos y es solo para personal", async () => {
    const created = await gqlAs<{ createIncidentTemplate: { id: string; status: string } }>(
      TECNICO,
      CREATE_TPL,
      { input: TPL_INPUT },
    );
    expect(created.data!.createIncidentTemplate.status).toBe("draft");

    expect(
      msg(await gqlAs(TECNICO, CREATE_TPL, { input: { ...TPL_INPUT, name: "x" } })),
    ).toBeDefined();
    expect(
      msg(await gqlAs(TECNICO, CREATE_TPL, { input: { ...TPL_INPUT, priority: "urgente" } })),
    ).toBeDefined();
    expect(msg(await gqlAs(SOLICITANTE, CREATE_TPL, { input: TPL_INPUT }))).toBe(FORBIDDEN);
  });

  test("editar: el autor solo en borrador o prueba; el admin en todo salvo retirada", async () => {
    const draft = mockIncidentTemplates.find((t) => t.id === "tpl-004")!;
    expect(
      (await gqlAs(TECNICO_2, UPDATE_TPL, { id: draft.id, input: TPL_INPUT })).errors,
    ).toBeUndefined();

    const approved = mockIncidentTemplates.find((t) => t.id === "tpl-001")!;
    expect(msg(await gqlAs(TECNICO_2, UPDATE_TPL, { id: approved.id, input: TPL_INPUT }))).toBe(
      FORBIDDEN,
    );
    expect(
      (await gqlAs(ADMIN, UPDATE_TPL, { id: approved.id, input: TPL_INPUT })).errors,
    ).toBeUndefined();

    const retired = await gqlAs<{ createIncidentTemplate: { id: string } }>(TECNICO, CREATE_TPL, {
      input: TPL_INPUT,
    });
    const retiredId = retired.data!.createIncidentTemplate.id;
    await gqlAs(TECNICO, RETIRE_TPL, { id: retiredId });
    expect(msg(await gqlAs(ADMIN, UPDATE_TPL, { id: retiredId, input: TPL_INPUT }))).toBe(
      FORBIDDEN,
    );
  });

  test("enviar a prueba: borrador -> prueba, solo autor o admin", async () => {
    const created = await gqlAs<{ createIncidentTemplate: { id: string } }>(TECNICO, CREATE_TPL, {
      input: TPL_INPUT,
    });
    const id = created.data!.createIncidentTemplate.id;
    expect(msg(await gqlAs(TECNICO_2, SUBMIT_TPL, { id }))).toBe(FORBIDDEN);

    const ok = await gqlAs<{ submitIncidentTemplate: { status: string } }>(TECNICO, SUBMIT_TPL, {
      id,
    });
    expect(ok.data!.submitIncidentTemplate.status).toBe("testing");

    // Ya no esta en borrador: transicion invalida
    expect(msg(await gqlAs(TECNICO, SUBMIT_TPL, { id }))).toContain("No se puede pasar");
  });

  test("aprobar: prueba -> aprobada, solo admin, guarda quién y cuándo", async () => {
    const testing = mockIncidentTemplates.find((t) => t.id === "tpl-003")!;
    expect(msg(await gqlAs(TECNICO, APPROVE_TPL, { id: testing.id }))).toBe(FORBIDDEN);

    const ok = await gqlAs<{ approveIncidentTemplate: { status: string } }>(ADMIN, APPROVE_TPL, {
      id: testing.id,
    });
    expect(ok.data!.approveIncidentTemplate.status).toBe("approved");
    expect(testing.approvedBy?.id).toBe(ADMIN);
    expect(testing.approvedAt).not.toBeNull();

    const draft = mockIncidentTemplates.find((t) => t.id === "tpl-004")!;
    expect(msg(await gqlAs(ADMIN, APPROVE_TPL, { id: draft.id }))).toContain("No se puede pasar");
  });

  test("rechazar: prueba -> borrador, con motivo obligatorio", async () => {
    const created = await gqlAs<{ createIncidentTemplate: { id: string } }>(TECNICO, CREATE_TPL, {
      input: TPL_INPUT,
    });
    const id = created.data!.createIncidentTemplate.id;
    await gqlAs(TECNICO, SUBMIT_TPL, { id });

    expect(msg(await gqlAs(TECNICO, REJECT_TPL, { id, reason: "no" }))).toBe(FORBIDDEN);
    expect(msg(await gqlAs(ADMIN, REJECT_TPL, { id, reason: "   " }))).toBeDefined();

    const ok = await gqlAs<{ rejectIncidentTemplate: { status: string } }>(ADMIN, REJECT_TPL, {
      id,
      reason: "Falta el paso de cables",
    });
    expect(ok.data!.rejectIncidentTemplate.status).toBe("draft");
  });

  test("retirar: el autor si no está aprobada; el admin siempre; retirada no vuelve a retirarse", async () => {
    const created = await gqlAs<{ createIncidentTemplate: { id: string } }>(TECNICO, CREATE_TPL, {
      input: TPL_INPUT,
    });
    const draftId = created.data!.createIncidentTemplate.id;
    expect((await gqlAs(TECNICO, RETIRE_TPL, { id: draftId })).errors).toBeUndefined();
    expect(msg(await gqlAs(TECNICO, RETIRE_TPL, { id: draftId }))).toContain("No se puede pasar");

    const approved = mockIncidentTemplates.find((t) => t.id === "tpl-002")!;
    expect(msg(await gqlAs(TECNICO, RETIRE_TPL, { id: approved.id }))).toBe(FORBIDDEN);
    expect((await gqlAs(ADMIN, RETIRE_TPL, { id: approved.id })).errors).toBeUndefined();
    expect(approved.status).toBe("retired");
  });
});

describe("#98 tickets: prioridad, ubicación, plantilla y clientId", () => {
  test("sin prioridad el ticket nace en media; prioridad inválida se rechaza", async () => {
    const res = await gqlAs<{ createTicket: { priority: string } }>(SOLICITANTE, CREATE_TICKET, {
      input: TICKET_INPUT,
    });
    expect(res.data!.createTicket.priority).toBe("medium");

    expect(
      msg(
        await gqlAs(SOLICITANTE, CREATE_TICKET, {
          input: { ...TICKET_INPUT, priority: "urgente" },
        }),
      ),
    ).toBeDefined();
  });

  test("la ubicación es la del equipo; el solicitante no puede cambiarla", async () => {
    const res = await gqlAs<{ createTicket: { locationId: string | null } }>(
      SOLICITANTE,
      CREATE_TICKET,
      {
        input: { ...TICKET_INPUT, equipmentId: "prod-2", locationId: "loc-5" },
      },
    );
    expect(res.data!.createTicket.locationId).toBe(product("prod-2").locationId);
  });

  test("el personal puede pasar otra ubicación; una inexistente se rechaza", async () => {
    const ok = await gqlAs<{ createTicket: { locationId: string | null } }>(
      TECNICO,
      CREATE_TICKET,
      {
        input: { ...TICKET_INPUT, equipmentId: "prod-2", locationId: "loc-5" },
      },
    );
    expect(ok.data!.createTicket.locationId).toBe("loc-5");

    expect(
      msg(
        await gqlAs(TECNICO, CREATE_TICKET, { input: { ...TICKET_INPUT, locationId: "loc-999" } }),
      ),
    ).toBeDefined();
  });

  test("sin equipo, la ubicación queda vacía", async () => {
    const res = await gqlAs<{ createTicket: { locationId: string | null } }>(
      SOLICITANTE,
      CREATE_TICKET,
      {
        input: TICKET_INPUT,
      },
    );
    expect(res.data!.createTicket.locationId).toBeNull();
  });

  test("plantilla: solo personal; aprobada sirve a cualquiera del personal", async () => {
    expect(
      msg(
        await gqlAs(SOLICITANTE, CREATE_TICKET, {
          input: { ...TICKET_INPUT, templateId: "tpl-001" },
        }),
      ),
    ).toBe(FORBIDDEN);

    const ok = await gqlAs<{ createTicket: { templateId: string | null } }>(
      TECNICO_2,
      CREATE_TICKET,
      {
        input: { ...TICKET_INPUT, templateId: "tpl-001" },
      },
    );
    expect(ok.data!.createTicket.templateId).toBe("tpl-001");
  });

  test("plantilla en prueba: solo la usan su autor o un admin; borrador no sirve", async () => {
    // tpl-003 la aprueba otro test: aca se crea una propia y se envia a prueba
    const created = await gqlAs<{ createIncidentTemplate: { id: string } }>(TECNICO, CREATE_TPL, {
      input: TPL_INPUT,
    });
    const testingId = created.data!.createIncidentTemplate.id;
    await gqlAs(TECNICO, SUBMIT_TPL, { id: testingId });

    const byOther = await gqlAs(TECNICO_2, CREATE_TICKET, {
      input: { ...TICKET_INPUT, templateId: testingId },
    });
    expect(msg(byOther)).toBeDefined();

    const byAuthor = await gqlAs<{ createTicket: { templateId: string | null } }>(
      TECNICO,
      CREATE_TICKET,
      {
        input: { ...TICKET_INPUT, templateId: testingId },
      },
    );
    expect(byAuthor.data!.createTicket.templateId).toBe(testingId);

    const draft = await gqlAs(ADMIN, CREATE_TICKET, {
      input: { ...TICKET_INPUT, templateId: "tpl-004" },
    });
    expect(msg(draft)).toBeDefined();
  });

  test("con el mismo clientId del mismo autor devuelve el ticket sin duplicar", async () => {
    const input = { ...TICKET_INPUT, clientId: uniq("tkt") };
    const first = await gqlAs<{ createTicket: { id: string } }>(SOLICITANTE, CREATE_TICKET, {
      input,
    });
    const before = mockTickets.length;
    const again = await gqlAs<{ createTicket: { id: string } }>(SOLICITANTE, CREATE_TICKET, {
      input,
    });
    expect(again.data!.createTicket.id).toBe(first.data!.createTicket.id);
    expect(mockTickets.length).toBe(before);

    // Otro autor con el mismo clientId es otro ticket
    const other = await gqlAs<{ createTicket: { id: string } }>(OTRO_SOLICITANTE, CREATE_TICKET, {
      input,
    });
    expect(other.data!.createTicket.id).not.toBe(first.data!.createTicket.id);
  });

  test("los tickets de la semilla traen prioridad, ubicación y sin plantilla", () => {
    // Solo la semilla (tkt-001 a tkt-015): los tickets de los tests de arriba traen otras ubicaciones
    for (const t of mockTickets.filter((x) => Number(x.id.slice(4)) <= 15)) {
      expect(["low", "medium", "high", "critical"]).toContain(t.priority);
      expect(t.templateId).toBeNull();
      expect(t.locationId).toBe(t.equipment?.locationId ?? null);
    }
  });

  test("UpdateTicket cambia prioridad y ubicación; una ubicación inexistente no cambia nada", async () => {
    const id = "tkt-003";
    const res = await gqlAs<{ updateTicket: { priority: string; locationId: string | null } }>(
      TECNICO,
      UPDATE_TICKET,
      { id, input: { priority: "critical", locationId: "loc-4" } },
    );
    expect(res.data!.updateTicket.priority).toBe("critical");
    expect(res.data!.updateTicket.locationId).toBe("loc-4");
    expect(ticket(id).location?.id).toBe("loc-4");

    expect(
      msg(await gqlAs(TECNICO, UPDATE_TICKET, { id, input: { priority: "urgente" } })),
    ).toBeDefined();
    expect(
      msg(await gqlAs(TECNICO, UPDATE_TICKET, { id, input: { locationId: "loc-999" } })),
    ).toBeDefined();
    expect(ticket(id).priority).toBe("critical");
    expect(ticket(id).locationId).toBe("loc-4");

    const cleared = await gqlAs<{ updateTicket: { locationId: string | null } }>(
      TECNICO,
      UPDATE_TICKET,
      {
        id,
        input: { locationId: "" },
      },
    );
    expect(cleared.data!.updateTicket.locationId).toBeNull();
  });
});
