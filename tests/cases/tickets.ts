import { check, seedUserId } from "../lib/api";
import type { TestCase } from "./types";

const TICKET = `query QaTicket($id: ID!) { ticket(id: $id) { id status assignedTo { id } diagnosis corrected actionsTaken resolvedAt } }`;
const CREATE = `mutation QaCreateTicket($input: TicketInput!) { createTicket(input: $input) { id status assignedTo { id } } }`;
const CLAIM = `mutation QaClaim($id: ID!) { claimTicket(id: $id) { id status assignedTo { id } } }`;
const STATUS = `mutation QaStatus($id: ID!, $status: String!) { changeTicketStatus(id: $id, status: $status) { id status } }`;
const COMPLETE = `mutation QaComplete($id: ID!, $input: TicketCompleteInput!) { completeTicket(id: $id, input: $input) { id status corrected resolvedAt assignedTo { id } } }`;
const ASSIGN = `mutation QaAssign($id: ID!, $tech: ID!) { assignTicket(id: $id, technicianId: $tech) { id status assignedTo { id } } }`;

type T = { id: string; status: string; assignedTo: { id: string } | null; corrected?: boolean | null; resolvedAt?: string | null };

export const ticketCases: TestCase[] = [
  {
    id: "CP-03-01",
    cu: "CU-03",
    title: "Reportar incidencia sobre un equipo",
    rf: ["RF-TKT-001"],
    rn: ["RN-05", "RN-06"],
    kind: "positivo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Sesión de solicitante; existe un equipo activo.",
    steps: ["Elegir el equipo", "Elegir categoría 'hardware'", "Escribir título y descripción", "Enviar"],
    expected: "La incidencia queda 'pendiente', sin técnico, y el sistema devuelve su identificador (acuse).",
    api: async (t) => {
      const product = await t.newProduct();
      const sol = await t.as("solicitante");
      const d = await sol.ok<{ createTicket: T }>(CREATE, {
        input: { title: t.tag("Equipo no enciende"), description: "No da señal de video desde el lunes en el laboratorio.", category: "hardware", equipmentId: product.id },
      });
      check(d.createTicket.id, "sin identificador de acuse");
      check(d.createTicket.status === "pending", `estado inicial: ${d.createTicket.status}`);
      check(d.createTicket.assignedTo === null, "la incidencia nació con técnico asignado (RN-05)");
    },
    ui: { as: "solicitante", start: "/dashboard/tickets", goal: "Crear un ticket de categoría hardware con título 'Prueba QA' y una descripción de al menos 20 caracteres", success: "Aparece el ticket creado con su identificador y estado Pendiente" },
  },
  {
    id: "CP-03-02",
    cu: "CU-03",
    title: "Descripción por debajo de la extensión mínima",
    rf: ["RF-TKT-001"],
    kind: "limite",
    actor: "solicitante",
    priority: "media",
    precondition: "Sesión de solicitante.",
    steps: ["Enviar una incidencia con título y descripción de 1 carácter"],
    expected: "El sistema rechaza la descripción insuficiente (flujo 6a).",
    knownGap: "La API no valida extensión mínima de título ni descripción; solo el formulario",
    api: async (t) => {
      const sol = await t.as("solicitante");
      await sol.fails(CREATE, { input: { title: "x", description: "y", category: "hardware" } });
    },
  },
  {
    id: "CP-03-03",
    cu: "CU-03",
    title: "Incidencia sin equipo ni ubicación",
    rf: ["RF-TKT-001"],
    rn: ["RN-04"],
    kind: "negativo",
    actor: "solicitante",
    priority: "media",
    precondition: "Sesión de solicitante.",
    steps: ["Enviar una incidencia sin indicar equipo"],
    expected: "Se rechaza: toda incidencia refiere a un equipo o a una ubicación (flujo 1a).",
    knownGap: "TicketInput no tiene ubicación y equipmentId es opcional: RN-04 no se valida",
    api: async (t) => {
      const sol = await t.as("solicitante");
      await sol.fails(CREATE, { input: { title: t.tag("Sin referente"), description: "Descripción suficientemente larga para pasar.", category: "network" } });
    },
  },
  {
    id: "CP-11-01",
    cu: "CU-11",
    title: "Técnico toma una incidencia de la bandeja OOL",
    rf: ["RF-TKT-002", "RF-TKT-006"],
    rn: ["RN-10", "RN-11"],
    kind: "positivo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Existe una incidencia pendiente sin asignar.",
    steps: ["Abrir la bandeja de pendientes", "Elegir la incidencia", "Tomarla"],
    expected: "La incidencia pasa a 'en proceso', queda asignada al técnico y sale de la bandeja.",
    api: async (t) => {
      const id = await t.newTicket();
      const tec = await t.as("tecnico");
      const before = await tec.ok<{ oolTickets: { id: string }[] }>(`query { oolTickets { id } }`);
      check(before.oolTickets.some((x) => x.id === id), "la incidencia nueva no figura en la bandeja OOL");
      const d = await tec.ok<{ claimTicket: T }>(CLAIM, { id });
      check(d.claimTicket.status === "in_progress", `estado: ${d.claimTicket.status}`);
      check(d.claimTicket.assignedTo?.id === seedUserId("tecnico"), "no quedó asignada al técnico");
      const after = await tec.ok<{ oolTickets: { id: string }[] }>(`query { oolTickets { id } }`);
      check(!after.oolTickets.some((x) => x.id === id), "sigue en la bandeja después de tomarla");
    },
    ui: {
      as: "tecnico",
      start: "/dashboard/tickets/ool",
      goal: "Tomar el ticket {id} desde la bandeja de pendientes",
      success: "El ticket {id} muestra estado En progreso y al técnico como responsable",
      setup: async (t) => ({ id: await t.newTicket() }),
      expect: /En progreso/,
    },
  },
  {
    id: "CP-11-02",
    cu: "CU-11",
    title: "Dos técnicos intentan tomar la misma incidencia",
    rf: ["RF-TKT-002"],
    rn: ["RN-10"],
    kind: "negativo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Un técnico ya tomó la incidencia.",
    steps: ["Un segundo técnico intenta tomarla"],
    expected: "Se rechaza: la incidencia admite una sola asignación vigente (flujo 3a).",
    api: async (t) => {
      const id = await t.newTicket();
      await (await t.as("tecnico")).ok(CLAIM, { id });
      const tec2 = await t.asSeed("u-tec-2");
      await tec2.fails(CLAIM, { id });
    },
  },
  {
    id: "CP-11-03",
    cu: "CU-11",
    title: "Solicitante no puede tomar incidencias",
    rf: ["RF-TKT-002", "RF-AUTH-006"],
    kind: "negativo",
    actor: "solicitante",
    priority: "media",
    precondition: "Sesión de solicitante.",
    steps: ["Intentar tomar una incidencia pendiente"],
    expected: "Se rechaza por permisos.",
    api: async (t) => {
      const id = await t.newTicket();
      await (await t.as("solicitante")).fails(CLAIM, { id }, "permisos");
    },
  },
  {
    id: "CP-12-01",
    cu: "CU-12",
    title: "Pasar a 'en resolución' durante el diagnóstico",
    rf: ["RF-TKT-004"],
    kind: "positivo",
    actor: "tecnico",
    priority: "media",
    precondition: "Incidencia en proceso asignada al técnico.",
    steps: ["Cambiar el estado a 'en resolución'"],
    expected: "La incidencia queda 'en resolución'.",
    api: async (t) => {
      const id = await t.newTicket();
      const tec = await t.as("tecnico");
      await tec.ok(CLAIM, { id });
      const d = await tec.ok<{ changeTicketStatus: T }>(STATUS, { id, status: "in_resolution" });
      check(d.changeTicketStatus.status === "in_resolution", `estado: ${d.changeTicketStatus.status}`);
    },
  },
  {
    id: "CP-12-02",
    cu: "CU-12",
    title: "Transición inválida desde 'pendiente'",
    rf: ["RF-TKT-004"],
    kind: "negativo",
    actor: "tecnico",
    priority: "media",
    precondition: "Incidencia pendiente sin asignar.",
    steps: ["Intentar pasarla directo a 'en resolución'"],
    expected: "Se rechaza: de pendiente solo se sale tomando o asignando la incidencia.",
    api: async (t) => {
      const id = await t.newTicket();
      await (await t.as("tecnico")).fails(STATUS, { id, status: "in_resolution" });
    },
  },
  {
    id: "CP-13-01",
    cu: "CU-13",
    title: "Resolver con diagnóstico y acciones",
    rf: ["RF-TKT-004"],
    rn: ["RN-13", "RN-14"],
    kind: "positivo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Incidencia en resolución asignada al técnico.",
    steps: ["Cargar diagnóstico", "Cargar acciones tomadas", "Indicar si quedó corregido", "Resolver"],
    expected: "Queda 'resuelto' con fecha de resolución y el dato 'corregido' registrado.",
    api: async (t) => {
      const id = await t.newTicket();
      const tec = await t.as("tecnico");
      await tec.ok(CLAIM, { id });
      await tec.ok(STATUS, { id, status: "in_resolution" });
      const d = await tec.ok<{ completeTicket: T }>(COMPLETE, {
        id,
        input: { diagnosis: "Fuente de alimentación dañada", corrected: true, actionsTaken: "Reemplazo de la fuente" },
      });
      check(d.completeTicket.status === "resolved", `estado: ${d.completeTicket.status}`);
      check(d.completeTicket.resolvedAt, "sin fecha de resolución (RN-13)");
      check(d.completeTicket.corrected === true, "no registró 'corregido' (RN-14)");
    },
    ui: {
      as: "tecnico",
      start: "/dashboard/tickets/{id}",
      goal: "Resolver este ticket cargando diagnóstico 'Cable flojo', acciones 'Se ajustó el cable' y marcando que se corrigió",
      success: "El ticket figura como Resuelto",
      setup: async (t) => {
        const id = await t.newTicket();
        const tec = await t.as("tecnico");
        await tec.ok(CLAIM, { id });
        await tec.ok(STATUS, { id, status: "in_resolution" });
        return { id };
      },
    },
  },
  {
    id: "CP-13-02",
    cu: "CU-13",
    title: "Resolver sin diagnóstico",
    rf: ["RF-TKT-004"],
    rn: ["RN-12"],
    kind: "negativo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Incidencia en proceso.",
    steps: ["Intentar resolver con el diagnóstico vacío", "Intentar pasar a 'resuelto' con cambio de estado"],
    expected: "Ambos intentos se rechazan: no se cierra sin diagnóstico (flujo 3a).",
    api: async (t) => {
      const id = await t.newTicket();
      const tec = await t.as("tecnico");
      await tec.ok(CLAIM, { id });
      await tec.fails(COMPLETE, { id, input: { diagnosis: "  ", corrected: false, actionsTaken: "Nada" } }, "diagnóstico");
      await tec.fails(STATUS, { id, status: "resolved" }, "diagnóstico");
    },
  },
  {
    id: "CP-13-03",
    cu: "CU-13",
    title: "Cierre con resultado negativo",
    rf: ["RF-TKT-004"],
    rn: ["RN-14"],
    kind: "limite",
    actor: "tecnico",
    priority: "media",
    precondition: "Incidencia en proceso.",
    steps: ["Resolver indicando que el problema NO quedó corregido"],
    expected: "Se cierra igual con 'corregido = no' (resuelto no equivale a corregido, flujo 2a).",
    api: async (t) => {
      const id = await t.newTicket();
      const tec = await t.as("tecnico");
      await tec.ok(CLAIM, { id });
      const d = await tec.ok<{ completeTicket: T }>(COMPLETE, {
        id,
        input: { diagnosis: "Placa madre quemada", corrected: false, actionsTaken: "Se deriva a baja" },
      });
      check(d.completeTicket.status === "resolved" && d.completeTicket.corrected === false, "no distingue resuelto de corregido");
    },
  },
  {
    id: "CP-21-01",
    cu: "CU-21",
    title: "Administrador reasigna una incidencia",
    rf: ["RF-TKT-003"],
    kind: "positivo",
    actor: "admin",
    priority: "media",
    precondition: "Incidencia en proceso con un técnico asignado.",
    steps: ["Elegir otro técnico", "Confirmar la reasignación"],
    expected: "La incidencia queda asignada al nuevo técnico.",
    api: async (t) => {
      const id = await t.newTicket();
      await (await t.as("tecnico")).ok(CLAIM, { id });
      const d = await (await t.as("admin")).ok<{ assignTicket: T }>(ASSIGN, { id, tech: "u-tec-2" });
      check(d.assignTicket.assignedTo?.id === "u-tec-2", "no cambió el responsable");
    },
  },
  {
    id: "CP-21-02",
    cu: "CU-21",
    title: "Reasignar a quien no es personal técnico",
    rf: ["RF-TKT-003"],
    kind: "negativo",
    actor: "admin",
    priority: "media",
    precondition: "Incidencia en proceso.",
    steps: ["Intentar asignarla a un solicitante"],
    expected: "Se rechaza: solo se asigna a personal técnico.",
    api: async (t) => {
      const id = await t.newTicket();
      await (await t.as("admin")).fails(ASSIGN, { id, tech: seedUserId("solicitante") }, "personal técnico");
    },
  },
  {
    id: "CP-21-03",
    cu: "CU-21",
    title: "Reasignar una incidencia resuelta",
    rf: ["RF-TKT-003", "RF-TKT-004"],
    kind: "negativo",
    actor: "admin",
    priority: "baja",
    precondition: "Incidencia resuelta.",
    steps: ["Intentar reasignarla"],
    expected: "Se rechaza.",
    api: async (t) => {
      const id = await t.newTicket();
      const tec = await t.as("tecnico");
      await tec.ok(CLAIM, { id });
      await tec.ok(COMPLETE, { id, input: { diagnosis: "Ok", corrected: true, actionsTaken: "Ok" } });
      await (await t.as("admin")).fails(ASSIGN, { id, tech: "u-tec-2" }, "resuelto");
    },
  },
  {
    id: "CP-04-01",
    cu: "CU-04",
    title: "Solicitante consulta el estado de sus incidencias",
    rf: ["RF-TKT-005"],
    kind: "positivo",
    actor: "solicitante",
    priority: "media",
    precondition: "El solicitante reportó al menos una incidencia.",
    steps: ["Abrir 'Mis pedidos' / tickets"],
    expected: "Ve sus incidencias con estado y técnico asignado.",
    api: async (t) => {
      const id = await t.newTicket();
      const sol = await t.as("solicitante");
      const d = await sol.ok<{ ticket: T }>(TICKET, { id });
      check(d.ticket.status === "pending", "no ve el estado de su incidencia");
    },
  },
  {
    id: "CP-04-02",
    cu: "CU-04",
    title: "Solicitante no ve incidencias de otros",
    rf: ["RF-TKT-005", "RF-AUTH-006"],
    kind: "negativo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Existe una incidencia de otro solicitante.",
    steps: ["Pedir por ID una incidencia ajena"],
    expected: "Se rechaza por permisos.",
    api: async (t) => {
      const otro = await t.asSeed("u-sol-2");
      const d = await otro.ok<{ createTicket: { id: string } }>(CREATE, {
        input: { title: t.tag("Ajena"), description: "Incidencia de otro solicitante para probar aislamiento.", category: "software" },
      });
      await (await t.as("solicitante")).fails(TICKET, { id: d.createTicket.id }, "permisos");
    },
  },
  {
    id: "CP-N-01",
    cu: "CU-N",
    title: "El acuse permite seguir el pedido",
    rf: ["RF-TKT-001", "RF-TKT-005"],
    kind: "positivo",
    actor: "solicitante",
    priority: "media",
    precondition: "Sesión de solicitante.",
    steps: ["Reportar una incidencia", "Consultarla con el identificador recibido"],
    expected: "El identificador del acuse devuelve la incidencia propia en estado 'pendiente'.",
    api: async (t) => {
      const id = await t.newTicket();
      const d = await (await t.as("solicitante")).ok<{ ticket: T }>(TICKET, { id });
      check(d.ticket.id === id, "el identificador del acuse no devuelve la incidencia");
      check(d.ticket.status === "pending", `estado: ${d.ticket.status}`);
    },
  },
];
