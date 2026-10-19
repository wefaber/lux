import { type ApiCtx, check, seedUserId } from "../lib/api";
import type { TestCase } from "./types";

const CREATE = `mutation QaCreateService($input: ServiceRequestInput!) { createServiceRequest(input: $input) { id status assignedTo { id } } }`;
const GET = `query QaService($id: ID!) { serviceRequest(id: $id) { id status assignedTo { id } resolutionText } }`;
const CLAIM = `mutation QaClaimService($id: ID!) { claimServiceRequest(id: $id) { id status assignedTo { id } } }`;
const UPDATE = `mutation QaUpdateService($id: ID!, $input: ServiceRequestUpdateInput!) { updateServiceRequest(id: $id, input: $input) { id status resolutionText } }`;

type S = { id: string; status: string; assignedTo: { id: string } | null; resolutionText?: string | null };

async function newService(t: ApiCtx): Promise<string> {
  const d = await (await t.as("solicitante")).ok<{ createServiceRequest: S }>(CREATE, {
    input: { type: "software_installation", softwareName: "GeoGebra", labNumber: "2", description: t.tag("Instalar GeoGebra en el laboratorio 2 para el parcial") },
  });
  return d.createServiceRequest.id;
}

export const serviceCases: TestCase[] = [
  {
    id: "CP-06-01",
    cu: "CU-06",
    title: "Solicitar instalación de software",
    rf: ["RF-SERV-001", "RF-SERV-002"],
    kind: "positivo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Sesión de solicitante.",
    steps: ["Elegir tipo 'instalación de software'", "Indicar programa y laboratorio", "Enviar"],
    expected: "La solicitud queda 'pendiente' y se devuelve su identificador (CU-N).",
    api: async (t) => {
      const id = await newService(t);
      const d = await (await t.as("solicitante")).ok<{ serviceRequest: S }>(GET, { id });
      check(d.serviceRequest.status === "pending", `estado: ${d.serviceRequest.status}`);
    },
    ui: { as: "solicitante", start: "/dashboard/service-requests", goal: "Pedir la instalación del programa 'Scratch' en el laboratorio 1", success: "La solicitud aparece con estado Pendiente" },
  },
  {
    id: "CP-06-02",
    cu: "CU-06",
    title: "Solicitante no ve solicitudes ajenas",
    rf: ["RF-SERV-004", "RF-AUTH-006"],
    kind: "negativo",
    actor: "solicitante",
    priority: "media",
    precondition: "Existe una solicitud de otro solicitante.",
    steps: ["Pedir por ID la solicitud ajena"],
    expected: "Se rechaza por permisos.",
    api: async (t) => {
      const d = await (await t.asSeed("u-sol-2")).ok<{ createServiceRequest: S }>(CREATE, {
        input: { type: "equipment_setup", description: t.tag("Configurar proyector del salón 4") },
      });
      await (await t.as("solicitante")).fails(GET, { id: d.createServiceRequest.id }, "permisos");
    },
  },
  {
    id: "CP-17-01",
    cu: "CU-17",
    title: "Técnico toma y completa una solicitud",
    rf: ["RF-SERV-003", "RF-SERV-005"],
    kind: "positivo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Solicitud pendiente.",
    steps: ["Tomar la solicitud", "Pasarla a 'en proceso'", "Completarla con el detalle de lo realizado"],
    expected: "Queda 'completada' con la información del cierre.",
    api: async (t) => {
      const id = await newService(t);
      const tec = await t.as("tecnico");
      const c = await tec.ok<{ claimServiceRequest: S }>(CLAIM, { id });
      check(c.claimServiceRequest.assignedTo?.id === seedUserId("tecnico"), "no quedó asignada");
      await tec.ok(UPDATE, { id, input: { status: "in_progress" } });
      const d = await tec.ok<{ updateServiceRequest: S }>(UPDATE, { id, input: { status: "completed", resolutionText: "Instalado en las 20 PC" } });
      check(d.updateServiceRequest.status === "completed", `estado: ${d.updateServiceRequest.status}`);
    },
  },
  {
    id: "CP-17-02",
    cu: "CU-17",
    title: "Solicitud ya tomada por otro técnico",
    rf: ["RF-SERV-003"],
    kind: "negativo",
    actor: "tecnico",
    priority: "media",
    precondition: "Otro técnico tomó la solicitud.",
    steps: ["Intentar tomarla"],
    expected: "Se informa quién la tomó y no se reasigna.",
    api: async (t) => {
      const id = await newService(t);
      await (await t.as("tecnico")).ok(CLAIM, { id });
      await (await t.asSeed("u-tec-2")).fails(CLAIM, { id }, "ya la tomó");
    },
  },
  {
    id: "CP-20-01",
    cu: "CU-20",
    title: "Administrador rechaza una solicitud",
    rf: ["RF-SERV-003"],
    kind: "positivo",
    actor: "admin",
    priority: "media",
    precondition: "Solicitud pendiente.",
    steps: ["Rechazar la solicitud con un motivo"],
    expected: "Queda 'rechazada' y ya no se puede tomar.",
    api: async (t) => {
      const id = await newService(t);
      const admin = await t.as("admin");
      const d = await admin.ok<{ updateServiceRequest: S }>(UPDATE, { id, input: { status: "rejected", resolutionText: "Licencia no disponible" } });
      check(d.updateServiceRequest.status === "rejected", `estado: ${d.updateServiceRequest.status}`);
      await (await t.as("tecnico")).fails(CLAIM, { id }, "cerrada");
    },
  },
  {
    id: "CP-20-02",
    cu: "CU-20",
    title: "Completar sin responsable asignado",
    rf: ["RF-SERV-003", "RF-SERV-005"],
    kind: "limite",
    actor: "admin",
    priority: "media",
    precondition: "Solicitud pendiente sin técnico.",
    steps: ["Marcarla 'completada' con el detalle del cierre"],
    expected: "Se completa y queda como responsable quien la cerró (nunca una solicitud cerrada sin responsable).",
    api: async (t) => {
      const id = await newService(t);
      const admin = await t.as("admin");
      await admin.ok(UPDATE, { id, input: { status: "completed", resolutionText: "Resuelto en el momento" } });
      const d = await admin.ok<{ serviceRequest: S }>(GET, { id });
      check(d.serviceRequest.assignedTo?.id === seedUserId("admin"), "la solicitud cerrada quedó sin responsable");
    },
  },
  {
    id: "CP-20-03",
    cu: "CU-20",
    title: "El cierre exige información del proceso",
    rf: ["RF-SERV-005"],
    kind: "limite",
    actor: "tecnico",
    priority: "media",
    precondition: "Solicitud en proceso.",
    steps: ["Completarla sin texto de resolución"],
    expected: "Se rechaza: el cierre requiere el detalle de lo realizado.",
    knownGap: "updateServiceRequest acepta 'completed' sin texto de resolución",
    api: async (t) => {
      const id = await newService(t);
      const tec = await t.as("tecnico");
      await tec.ok(CLAIM, { id });
      await tec.fails(UPDATE, { id, input: { status: "completed" } });
    },
  },
  {
    id: "CP-20-04",
    cu: "CU-20",
    title: "Ciclo de vida: no se reabre una solicitud completada",
    rf: ["RF-SERV-003"],
    kind: "negativo",
    actor: "admin",
    priority: "baja",
    precondition: "Solicitud completada.",
    steps: ["Intentar volverla a 'pendiente'"],
    expected: "Se rechaza: las transiciones solo avanzan (Pendiente → Aprobado → En proceso → Completo/Rechazado).",
    knownGap: "updateServiceRequest no valida transiciones: cualquier estado pasa a cualquier otro",
    api: async (t) => {
      const id = await newService(t);
      const tec = await t.as("tecnico");
      await tec.ok(CLAIM, { id });
      await tec.ok(UPDATE, { id, input: { status: "completed", resolutionText: "Hecho" } });
      await (await t.as("admin")).fails(UPDATE, { id, input: { status: "pending" } });
    },
  },
];
