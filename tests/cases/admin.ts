import { check, seedUserId } from "../lib/api";
import type { TestCase } from "./types";

const CREATE_USER = `mutation QaCreateUser($input: UserInput!) { createUser(input: $input) { id role isActive } }`;
const UPDATE_USER = `mutation QaUpdateUser($id: ID!, $input: UserInput!) { updateUser(id: $id, input: $input) { id role } }`;
const LOGS = `query QaLogs($startDate: String, $endDate: String) { activityLogs(startDate: $startDate, endDate: $endDate) { id entity entityId operation timestamp } }`;

export const adminCases: TestCase[] = [
  {
    id: "CP-18-01",
    cu: "CU-18",
    title: "Alta de usuario con rol",
    rf: ["RF-USR-001", "RF-AUTH-002"],
    kind: "positivo",
    actor: "admin",
    priority: "alta",
    precondition: "Sesión de administrador.",
    steps: ["Completar nombre, documento, correo, contraseña y rol", "Guardar", "Iniciar sesión con la cuenta nueva"],
    expected: "La cuenta queda activa y puede ingresar con su rol.",
    api: async (t) => {
      const u = await t.newUser("tecnico");
      const me = await (await t.login(u.dni, u.password)).ok<{ me: { role: string } }>(`query { me { role } }`);
      check(me.me.role === "tecnico", `rol: ${me.me.role}`);
    },
    ui: {
      as: "admin",
      start: "/admin/users",
      goal: "Dar de alta un usuario solicitante llamado 'Ana Prueba' con documento {dni} y correo ana.{dni}@iti.edu.uy",
      success: "El usuario aparece en la lista como activo",
      // Documento nuevo en cada corrida: la base de dev es persistente y el documento es único.
      setup: async () => ({ dni: String(40000000 + Math.floor(Math.random() * 9999999)) }),
      expect: /Ana Prueba/,
    },
  },
  {
    id: "CP-18-02",
    cu: "CU-18",
    title: "Documento duplicado",
    rf: ["RF-USR-001"],
    kind: "negativo",
    actor: "admin",
    priority: "media",
    precondition: "Existe un usuario con ese documento.",
    steps: ["Dar de alta otro usuario con el mismo documento"],
    expected: "Se rechaza por unicidad.",
    api: async (t) => {
      const u = await t.newUser();
      await (await t.as("admin")).fails(CREATE_USER, {
        input: { name: "Duplicado Prueba", dni: u.dni, email: `dup${u.dni}@iti.edu.uy`, password: "QaPass-dup", role: "solicitante" },
      });
    },
  },
  {
    id: "CP-18-03",
    cu: "CU-18",
    title: "Cambio de rol",
    rf: ["RF-USR-002"],
    kind: "positivo",
    actor: "admin",
    priority: "media",
    precondition: "Existe la cuenta.",
    steps: ["Editar el usuario y cambiar el rol a técnico"],
    expected: "El rol cambia y las restricciones nuevas se aplican.",
    api: async (t) => {
      const u = await t.newUser();
      const d = await (await t.as("admin")).ok<{ updateUser: { role: string } }>(UPDATE_USER, {
        id: u.id,
        input: { name: "Usuario Prueba", dni: u.dni, email: `qa${u.dni}@iti.edu.uy`, role: "tecnico" },
      });
      check(d.updateUser.role === "tecnico", `rol: ${d.updateUser.role}`);
    },
  },
  {
    id: "CP-18-04",
    cu: "CU-18",
    title: "Técnico no gestiona usuarios",
    rf: ["RF-USR-001", "RF-AUTH-006"],
    kind: "negativo",
    actor: "tecnico",
    priority: "media",
    precondition: "Sesión de técnico.",
    steps: ["Intentar dar de alta un usuario"],
    expected: "Se rechaza por permisos.",
    api: async (t) => {
      await (await t.as("tecnico")).fails(CREATE_USER, {
        input: { name: "No Corresponde", dni: "80000001", email: "no@iti.edu.uy", password: "x", role: "admin" },
      }, "permisos");
    },
  },
  {
    id: "CP-25-01",
    cu: "CU-25",
    title: "El usuario raíz no se puede eliminar",
    rf: ["RF-USR-005"],
    kind: "negativo",
    actor: "admin",
    priority: "alta",
    precondition: "Sesión de administrador.",
    steps: ["Intentar eliminar al usuario raíz"],
    expected: "Se rechaza.",
    api: async (t) => {
      await (await t.as("admin")).fails(`mutation Q($id: ID!) { deleteUser(id: $id) }`, { id: seedUserId("root_admin") }, "No se puede eliminar");
    },
  },
  {
    id: "CP-25-02",
    cu: "CU-25",
    title: "Un administrador no degrada al usuario raíz",
    rf: ["RF-USR-005"],
    kind: "negativo",
    actor: "admin",
    priority: "alta",
    precondition: "Sesión de administrador.",
    steps: ["Editar al usuario raíz y cambiarle el rol a solicitante"],
    expected: "Se rechaza: solo la cuenta raíz administra cuentas administrativas.",
    api: async (t) => {
      const root = await (await t.as("admin")).ok<{ user: { name: string; dni: string; email: string } }>(
        `query Q($id: ID!) { user(id: $id) { name dni email } }`,
        { id: seedUserId("root_admin") },
      );
      const admin = await t.as("admin");
      const r = await admin.gql(UPDATE_USER, { id: seedUserId("root_admin"), input: { ...root.user, role: "solicitante" } });
      if (r.errors.length === 0) {
        // El bug degradó al root: se restaura antes de fallar para no romper el entorno.
        await admin.gql(UPDATE_USER, { id: seedUserId("root_admin"), input: { ...root.user, role: "root_admin" } });
        check(false, "un administrador degradó al usuario raíz (rol restaurado por la suite)");
      }
    },
  },
  {
    id: "CP-22-01",
    cu: "CU-22",
    title: "Consultar indicadores y reportes",
    rf: ["RF-DASH-002", "RF-DASH-003", "RF-DASH-004"],
    kind: "positivo",
    actor: "admin",
    priority: "media",
    precondition: "Hay tickets y solicitudes registrados.",
    steps: ["Abrir el panel de administración", "Abrir reportes"],
    expected: "Se ven tickets por estado, tiempo promedio de resolución y solicitudes por período.",
    api: async (t) => {
      const d = await (await t.as("admin")).ok<{ dashboardStats: { ticketsByStatus: unknown[]; servicesByPeriod: unknown[] }; reports: { resolution: { resolvedCount: number } } }>(
        `query { dashboardStats(period: "month") { ticketsByStatus { status count } servicesByPeriod { date count } } reports { resolution { resolvedCount averageHours } } }`,
      );
      check(d.dashboardStats.ticketsByStatus.length > 0, "sin tickets por estado");
      check(typeof d.reports.resolution.resolvedCount === "number", "sin métrica de resolución");
    },
    ui: { as: "admin", start: "/admin/reports", goal: "Abrir los reportes y descargar el CSV de préstamos vencidos", success: "Se ve la tabla de reportes y el botón de descarga CSV" },
  },
  {
    id: "CP-22-02",
    cu: "CU-22",
    title: "Exportar el informe en PDF y XLSX",
    rf: ["RF-DASH-005"],
    kind: "positivo",
    actor: "admin",
    priority: "baja",
    precondition: "Panel con datos.",
    steps: ["Exportar en PDF", "Exportar en XLSX"],
    expected: "Los archivos reflejan los datos visibles.",
    knownGap: "Solo hay exportación CSV en reportes; faltan PDF y XLSX",
  },
  {
    id: "CP-24-01",
    cu: "CU-24",
    title: "Consultar auditoría filtrada por fechas",
    rf: ["RF-TRZ-002", "RF-TRZ-003"],
    kind: "positivo",
    actor: "root_admin",
    priority: "media",
    precondition: "Existen registros de auditoría.",
    steps: ["Abrir el registro de actividad", "Filtrar por los últimos 30 días"],
    expected: "Se listan solo los registros del rango.",
    api: async (t) => {
      const start = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const d = await (await t.as("root_admin")).ok<{ activityLogs: { timestamp: string }[] }>(LOGS, { startDate: start });
      check(d.activityLogs.every((l) => l.timestamp >= start), "el filtro devolvió registros fuera del rango");
    },
  },
  {
    id: "CP-24-02",
    cu: "CU-24",
    title: "Los registros de auditoría son inmutables",
    rf: ["RF-TRZ-005"],
    kind: "negativo",
    actor: "root_admin",
    priority: "alta",
    precondition: "Sesión raíz.",
    steps: ["Intentar borrar o editar un registro de auditoría"],
    expected: "No existe operación que lo permita.",
    api: async (t) => {
      const root = await t.as("root_admin");
      await root.fails(`mutation { deleteActivityLog(id: "x") }`, {}, "Cannot query field");
      await root.fails(`mutation { updateActivityLog(id: "x") }`, {}, "Cannot query field");
    },
  },
  {
    id: "CP-24-03",
    cu: "CU-24",
    title: "Exportar la auditoría filtrada en CSV",
    rf: ["RF-TRZ-004"],
    kind: "positivo",
    actor: "root_admin",
    priority: "baja",
    precondition: "Registro filtrado en pantalla.",
    steps: ["Exportar a CSV"],
    expected: "Se descarga el CSV con los registros filtrados.",
    knownGap: "El registro de actividad no tiene exportación",
  },
  {
    id: "CP-R-01",
    cu: "CU-R",
    title: "Toda escritura deja traza de auditoría",
    rf: ["RF-TRZ-001", "RF-INV-006"],
    kind: "positivo",
    actor: "solicitante",
    priority: "alta",
    precondition: "Sesión de solicitante.",
    steps: ["Crear una incidencia", "Buscarla en el registro de auditoría como raíz"],
    expected: "Existe un registro con entidad, identificador, acción, usuario y momento.",
    api: async (t) => {
      const id = await t.newTicket();
      const d = await (await t.as("root_admin")).ok<{ activityLogs: { entityId: string }[] }>(LOGS, {});
      check(d.activityLogs.some((l) => l.entityId === id), "la creación del ticket no quedó en auditoría");
    },
  },
  {
    id: "CP-23-01",
    cu: "CU-23",
    title: "Afectar un equipo de forma permanente a una persona",
    rf: ["RF-INV-004", "RF-PRES-006"],
    kind: "positivo",
    actor: "admin",
    priority: "baja",
    precondition: "Equipo disponible.",
    steps: ["Asignar el equipo a un funcionario de forma permanente"],
    expected: "El equipo figura afectado y CU-V lo considera no prestable.",
    knownGap: "CU-23 no implementado: no existe la entidad afectación",
  },
];
