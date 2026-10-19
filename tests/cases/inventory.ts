import { check } from "../lib/api";
import type { TestCase } from "./types";

const PRODUCT = `query QaProduct($id: ID!) { product(id: $id) { id status brand serialNumber deletedAt } }`;
const CREATE = `mutation QaCreateProduct($input: ProductInput!) { createProduct(input: $input) { id } }`;
const UPDATE = `mutation QaUpdateProduct($id: ID!, $input: ProductUpdateInput!) { updateProduct(id: $id, input: $input) { id brand } }`;
const RETIRE = `mutation QaRetire($id: ID!) { softDeleteProduct(id: $id) }`;
const INTERVENTION = `mutation QaIntervention($input: InterventionInput!) { createIntervention(input: $input) { id type } }`;
const INTERVENTIONS = `query QaInterventions($id: ID!) { interventions(equipmentId: $id) { id type description } }`;

type P = { id: string; status: string; brand: string; serialNumber: string; deletedAt: string | null };

export const inventoryCases: TestCase[] = [
  {
    id: "CP-07-01",
    cu: "CU-07",
    title: "Consultar inventario filtrado por estado",
    rf: ["RF-INV-005", "RF-INV-007", "RF-PRES-006"],
    kind: "positivo",
    actor: "solicitante",
    priority: "media",
    precondition: "Hay equipos en distintos estados.",
    steps: ["Abrir inventario", "Filtrar por 'disponible'"],
    expected: "Solo se listan equipos disponibles.",
    api: async (t) => {
      await t.newProduct();
      const d = await (await t.as("solicitante")).ok<{ products: P[] }>(`query { products(status: "available") { id status } }`);
      check(d.products.length > 0, "el filtro no devolvió equipos");
      check(d.products.every((p) => p.status === "available"), "el filtro devolvió equipos en otro estado");
    },
    ui: { as: "tecnico", start: "/dashboard/inventory", goal: "Filtrar el inventario para ver solo los equipos disponibles", success: "La tabla muestra únicamente equipos con estado Disponible" },
  },
  {
    id: "CP-08-01",
    cu: "CU-08",
    title: "Registrar un equipo nuevo",
    rf: ["RF-INV-001"],
    kind: "positivo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Sesión de técnico; existe la ubicación.",
    steps: ["Completar ID de máquina, tipo, marca, modelo, serie y ubicación", "Guardar"],
    expected: "El equipo queda registrado y 'disponible'.",
    api: async (t) => {
      const p = await t.newProduct();
      const d = await (await t.as("tecnico")).ok<{ product: P }>(PRODUCT, { id: p.id });
      check(d.product.status === "available", `estado: ${d.product.status}`);
    },
  },
  {
    id: "CP-08-02",
    cu: "CU-08",
    title: "Número de serie duplicado",
    rf: ["RF-INV-001"],
    kind: "negativo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Existe un equipo con ese número de serie.",
    steps: ["Registrar otro equipo con el mismo número de serie"],
    expected: "Se rechaza por unicidad del número de serie.",
    api: async (t) => {
      const p = await t.newProduct();
      const tec = await t.as("tecnico");
      const { product } = await tec.ok<{ product: P & { machineId?: string } }>(PRODUCT, { id: p.id });
      const loc = await tec.ok<{ locations: { id: string; code: string }[] }>(`query { locations { id code } }`);
      const location = loc.locations.find((l) => p.machineId.startsWith(`${l.code}-`));
      await tec.fails(CREATE, {
        input: { machineId: `${location?.code}-PC999`, kind: "Laptop", brand: "Dell", model: "Latitude", serialNumber: product.serialNumber, partNumber: "PN-QA-1", status: "available", locationId: location?.id },
      });
    },
  },
  {
    id: "CP-08-03",
    cu: "CU-08",
    title: "ID de máquina con formato inválido",
    rf: ["RF-INV-001"],
    kind: "limite",
    actor: "tecnico",
    priority: "media",
    precondition: "Sesión de técnico.",
    steps: ["Registrar un equipo con ID 'cualquiera'"],
    expected: "Se rechaza indicando el formato esperado.",
    api: async (t) => {
      const tec = await t.as("tecnico");
      const loc = await tec.ok<{ locations: { id: string }[] }>(`query { locations { id } }`);
      await tec.fails(CREATE, {
        input: { machineId: "cualquiera", kind: "Laptop", brand: "Dell", model: "Latitude", serialNumber: `SN${t.runId}9`, partNumber: "PN-QA-2", status: "available", locationId: loc.locations[0]?.id },
      }, "Formato");
    },
  },
  {
    id: "CP-08-04",
    cu: "CU-08",
    title: "Solicitante no registra equipos",
    rf: ["RF-INV-001", "RF-AUTH-006"],
    kind: "negativo",
    actor: "solicitante",
    priority: "media",
    precondition: "Sesión de solicitante.",
    steps: ["Intentar registrar un equipo"],
    expected: "Se rechaza por permisos.",
    api: async (t) => {
      await (await t.as("solicitante")).fails(CREATE, {
        input: { machineId: "X", kind: "Laptop", brand: "Dell", model: "X", serialNumber: "SN1", partNumber: "PN1", status: "available", locationId: "x" },
      }, "permisos");
    },
  },
  {
    id: "CP-08-05",
    cu: "CU-08",
    title: "Modificar datos de un equipo",
    rf: ["RF-INV-002"],
    kind: "positivo",
    actor: "tecnico",
    priority: "media",
    precondition: "Existe el equipo.",
    steps: ["Cambiar la marca", "Guardar"],
    expected: "El cambio queda persistido.",
    api: async (t) => {
      const p = await t.newProduct();
      const d = await (await t.as("tecnico")).ok<{ updateProduct: P }>(UPDATE, { id: p.id, input: { brand: "Lenovo" } });
      check(d.updateProduct.brand === "Lenovo", `marca: ${d.updateProduct.brand}`);
    },
  },
  {
    id: "CP-09-01",
    cu: "CU-09",
    title: "Dar de baja un equipo (baja lógica)",
    rf: ["RF-INV-003"],
    kind: "positivo",
    actor: "tecnico",
    priority: "alta",
    precondition: "Equipo sin préstamos, tickets ni reservas abiertas.",
    steps: ["Dar de baja el equipo"],
    expected: "El equipo queda con fecha de baja y sigue consultable en el historial.",
    api: async (t) => {
      const p = await t.newProduct();
      const tec = await t.as("tecnico");
      await tec.ok(RETIRE, { id: p.id });
      const d = await tec.ok<{ product: P }>(PRODUCT, { id: p.id });
      check(d.product.deletedAt, "no quedó registrada la baja");
    },
  },
  {
    id: "CP-09-02",
    cu: "CU-09",
    title: "Baja de un equipo con incidencias abiertas",
    rf: ["RF-INV-003"],
    kind: "negativo",
    actor: "tecnico",
    priority: "media",
    precondition: "El equipo tiene un ticket abierto.",
    steps: ["Intentar darlo de baja"],
    expected: "Se rechaza indicando el motivo.",
    api: async (t) => {
      const p = await t.newProduct();
      await t.newTicket(p.id);
      await (await t.as("tecnico")).fails(RETIRE, { id: p.id }, "tickets abiertos");
    },
  },
  {
    id: "CP-10-01",
    cu: "CU-10",
    title: "Registrar una reparación correctiva",
    rf: ["RF-INV-004", "RF-MANT-002"],
    kind: "positivo",
    actor: "tecnico",
    priority: "media",
    precondition: "Equipo activo.",
    steps: ["Abrir la ficha del equipo", "Registrar intervención 'reparación correctiva' con descripción"],
    expected: "La intervención aparece en el historial del equipo.",
    api: async (t) => {
      const p = await t.newProduct();
      const tec = await t.as("tecnico");
      await tec.ok(INTERVENTION, { input: { equipmentId: p.id, type: "corrective_repair", description: "Cambio de disco por sectores dañados" } });
      const d = await tec.ok<{ interventions: { type: string }[] }>(INTERVENTIONS, { id: p.id });
      check(d.interventions.some((i) => i.type === "corrective_repair"), "la intervención no figura en el historial");
    },
  },
  {
    id: "CP-14-01",
    cu: "CU-14",
    title: "Registrar nota técnica (mantenimiento preventivo)",
    rf: ["RF-INV-004"],
    kind: "positivo",
    actor: "tecnico",
    priority: "baja",
    precondition: "Equipo activo.",
    steps: ["Registrar intervención 'mantenimiento preventivo'"],
    expected: "Queda en el historial con técnico y fecha.",
    api: async (t) => {
      const p = await t.newProduct();
      const d = await (await t.as("tecnico")).ok<{ createIntervention: { id: string } }>(INTERVENTION, {
        input: { equipmentId: p.id, type: "preventive_maintenance", description: "Limpieza interna y pasta térmica" },
      });
      check(d.createIntervention.id, "no devolvió la intervención");
    },
  },
  {
    id: "CP-14-02",
    cu: "CU-14",
    title: "Intervención sobre un equipo dado de baja",
    rf: ["RF-INV-004", "RF-INV-003"],
    kind: "negativo",
    actor: "tecnico",
    priority: "baja",
    precondition: "Equipo dado de baja.",
    steps: ["Intentar registrar una intervención"],
    expected: "Se rechaza.",
    api: async (t) => {
      const p = await t.newProduct();
      const tec = await t.as("tecnico");
      await tec.ok(RETIRE, { id: p.id });
      await tec.fails(INTERVENTION, { input: { equipmentId: p.id, type: "preventive_maintenance", description: "No debería registrarse" } }, "baja");
    },
  },
  {
    id: "CP-V-01",
    cu: "CU-V",
    title: "Equipo en reparación no es prestable",
    rf: ["RF-PRES-002", "RF-MANT-003"],
    kind: "negativo",
    actor: "solicitante",
    priority: "alta",
    precondition: "El equipo volvió de un préstamo con falla (en reparación).",
    steps: ["Intentar pedirlo en préstamo"],
    expected: "Se informa que no está disponible.",
    api: async (t) => {
      const p = await t.newProduct();
      const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString();
      const sol = await t.as("solicitante");
      const l = await sol.ok<{ createLoan: { id: string } }>(`mutation Q($input: LoanInput!) { createLoan(input: $input) { id } }`, { input: { equipmentId: p.id, issueDate: day(0), returnDate: day(2) } });
      await (await t.as("admin")).ok(`mutation Q($id: ID!) { approveLoan(id: $id) { id } }`, { id: l.createLoan.id });
      const tec = await t.as("tecnico");
      await tec.ok(`mutation Q($id: ID!) { deliverLoan(id: $id) { id } }`, { id: l.createLoan.id });
      await tec.ok(`mutation Q($id: ID!) { returnLoan(id: $id, damaged: true, issues: "No enciende") { id } }`, { id: l.createLoan.id });
      await sol.fails(`mutation Q($input: LoanInput!) { createLoan(input: $input) { id } }`, { input: { equipmentId: p.id, issueDate: day(1), returnDate: day(3) } }, "disponible");
    },
  },
];
